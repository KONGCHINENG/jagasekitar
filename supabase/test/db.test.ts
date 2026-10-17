import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_FILES, asRole, createDb, createUser, readSql } from './harness';

let db: PGlite;
let staffId: string;
let userA: string;
let userB: string;
let adminId: string;
let bainunId: string;
let taipingId: string;

const ZONE_SQUARE = `st_geogfromtext('MULTIPOLYGON(((101.0 4.5, 101.2 4.5, 101.2 4.7, 101.0 4.7, 101.0 4.5)))')`;

beforeAll(async () => {
  db = await createDb();
  staffId = await createUser(db, 'staff@example.test');
  userA = await createUser(db, 'a@example.test');
  userB = await createUser(db, 'b@example.test');
  adminId = await createUser(db, 'admin@example.test');

  const fac = await db.query<{ id: string; name: string }>(
    `select id, name from facilities where name in ('Hospital Raja Permaisuri Bainun', 'Hospital Taiping')`,
  );
  bainunId = fac.rows.find((r) => r.name.includes('Bainun'))!.id;
  taipingId = fac.rows.find((r) => r.name.includes('Taiping'))!.id;

  await db.query(`update profiles set role = 'hospital_staff', facility_id = $1 where id = $2`, [
    bainunId,
    staffId,
  ]);
  await db.query(`update profiles set role = 'admin' where id = $1`, [adminId]);
}, 120_000);

describe('migrations and seed', () => {
  it('seeds Perak reference data', async () => {
    const counts = await db.query<{ t: string; n: number }>(`
      select 'districts' t, count(*)::int n from districts union all
      select 'disease_types', count(*)::int from disease_types union all
      select 'facilities', count(*)::int from facilities union all
      select 'rain_stations', count(*)::int from rain_stations union all
      select 'water_level_stations', count(*)::int from water_level_stations union all
      select 'settings', count(*)::int from settings
    `);
    const byTable = Object.fromEntries(counts.rows.map((r) => [r.t, r.n]));
    expect(byTable).toMatchObject({
      districts: 12,
      disease_types: 10,
      facilities: 12,
      rain_stations: 18,
      water_level_stations: 8,
      settings: 8,
    });
  });

  it('seed is idempotent', async () => {
    for (const file of SEED_FILES) await db.exec(readSql(file));
    const res = await db.query<{ n: number }>('select count(*)::int n from facilities');
    expect(res.rows[0]!.n).toBe(12);
  });

  it('creates a profile for each new auth user', async () => {
    const res = await db.query<{ role: string }>('select role from profiles where id = $1', [
      userA,
    ]);
    expect(res.rows[0]!.role).toBe('user');
  });

  it('loads valid polygons for all 12 Perak districts', async () => {
    const res = await db.query<{ n: number }>(
      `select count(*)::int n from districts
       where state = 'PRK' and geom is not null and st_isvalid(geom::geometry)`,
    );
    expect(res.rows[0]!.n).toBe(12);
  });

  it('district_at uses polygons (Selama is part of Larut Matang dan Selama)', async () => {
    const selama = await db.query<{ name: string }>('select name from district_at(5.22, 100.70)');
    expect(selama.rows[0]!.name).toBe('Larut Matang dan Selama');
    const bota = await db.query<{ name: string }>('select name from district_at(4.348, 100.886)');
    expect(bota.rows[0]!.name).toBe('Perak Tengah');
  });

  it('district_at falls back to nearest centroid', async () => {
    const res = await db.query<{ name: string }>('select name from district_at(4.59, 101.08)');
    expect(res.rows[0]!.name).toBe('Kinta');
  });
});

describe('RLS: public data', () => {
  it('anon can read hazard data and stations', async () => {
    const res = await asRole(db, 'anon', null, () =>
      db.query<{ n: number }>('select count(*)::int n from rain_stations'),
    );
    expect(res.rows[0]!.n).toBe(18);
  });

  it('anon cannot read raw case reports, audit log or devices', async () => {
    await db.query(
      `insert into case_reports (facility_id, disease_code, report_date, new_cases) values ($1, 'DENGUE', current_date, 3)`,
      [taipingId],
    );
    for (const table of ['case_reports', 'audit_log', 'user_devices', 'data_source_status']) {
      const res = await asRole(db, 'anon', null, () =>
        db.query<{ n: number }>(`select count(*)::int n from ${table}`),
      );
      expect(res.rows[0]!.n, table).toBe(0);
    }
  });

  it('anon cannot write hazard zones or settings', async () => {
    await expect(
      asRole(db, 'anon', null, () =>
        db.query(`update settings set value = '{}' where key = 'haze'`).then((r) => r.affectedRows),
      ),
    ).resolves.toBe(0);
  });
});

describe('RLS: hospital staff', () => {
  it('can insert reports for own verified facility only', async () => {
    await asRole(db, 'authenticated', staffId, () =>
      db.query(
        `insert into case_reports (facility_id, disease_code, report_date, new_cases, submitted_by)
         values ($1, 'LEPTO', current_date, 2, $2)`,
        [bainunId, staffId],
      ),
    );
    await expect(
      asRole(db, 'authenticated', staffId, () =>
        db.query(
          `insert into case_reports (facility_id, disease_code, report_date, new_cases, submitted_by)
           values ($1, 'LEPTO', current_date, 2, $2)`,
          [taipingId, staffId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("sees only own facility's reports", async () => {
    const res = await asRole(db, 'authenticated', staffId, () =>
      db.query<{ facility_id: string }>('select facility_id from case_reports'),
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.facility_id === bainunId)).toBe(true);
  });

  it('cannot change their own role', async () => {
    await expect(
      asRole(db, 'authenticated', staffId, () =>
        db.query(`update profiles set role = 'admin' where id = $1`, [staffId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects IC numbers in notes', async () => {
    await expect(
      db.query(
        `insert into case_reports (facility_id, disease_code, report_date, new_cases, notes)
         values ($1, 'ILI', current_date, 1, 'patient 850101-08-1234')`,
        [bainunId],
      ),
    ).rejects.toThrow(/case_reports_notes_no_ic/);
  });

  it('records changes in the audit log with the actor', async () => {
    const res = await db.query<{ n: number }>(
      `select count(*)::int n from audit_log where entity = 'case_reports' and actor = $1`,
      [staffId],
    );
    expect(res.rows[0]!.n).toBe(1);
  });
});

describe('RLS: user-owned data', () => {
  it('users see only their own devices', async () => {
    await asRole(db, 'authenticated', userA, () =>
      db.query(
        `insert into user_devices (user_id, expo_push_token, last_lat, last_lon) values ($1, 'ExponentPushToken[a]', 4.6, 101.09)`,
        [userA],
      ),
    );
    const seenByB = await asRole(db, 'authenticated', userB, () =>
      db.query('select id from user_devices'),
    );
    expect(seenByB.rows).toHaveLength(0);
    await expect(
      asRole(db, 'authenticated', userB, () =>
        db.query(
          `insert into user_devices (user_id, expo_push_token) values ($1, 'ExponentPushToken[x]')`,
          [userA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('delete_my_data removes only the caller data', async () => {
    await asRole(db, 'authenticated', userA, () => db.query('select delete_my_data()'));
    const res = await db.query<{ n: number }>('select count(*)::int n from user_devices');
    expect(res.rows[0]!.n).toBe(0);
  });

  it('admins can read everything', async () => {
    const res = await asRole(db, 'authenticated', adminId, () =>
      db.query<{ n: number }>('select count(*)::int n from case_reports'),
    );
    expect(res.rows[0]!.n).toBe(2);
  });
});

describe('views and RPCs', () => {
  it('v_disease_district_summary computes 7-day count, baseline ratio and per-100k', async () => {
    // Kinta dengue: 4 cases/week baseline for the previous 28 days, 12 cases this week.
    for (let d = 8; d <= 35; d += 7) {
      await db.query(
        `insert into case_reports (facility_id, disease_code, report_date, new_cases) values ($1, 'DENGUE', current_date - $2::int, 4)`,
        [bainunId, d],
      );
    }
    await db.query(
      `insert into case_reports (facility_id, disease_code, report_date, new_cases) values ($1, 'DENGUE', current_date - 1, 12)`,
      [bainunId],
    );
    const res = await asRole(db, 'anon', null, () =>
      db.query<{ cases_7d: number; baseline_ratio: string; per_100k: string; trend_14d: number[] }>(
        `select cases_7d, baseline_ratio, per_100k, trend_14d from v_disease_district_summary
         where district = 'Kinta' and disease_code = 'DENGUE'`,
      ),
    );
    const row = res.rows[0]!;
    expect(row.cases_7d).toBe(12);
    expect(Number(row.baseline_ratio)).toBe(3);
    expect(Number(row.per_100k)).toBeCloseTo((12 * 100000) / 840000, 2);
    expect(row.trend_14d).toHaveLength(14);
  });

  it('zones_in_bbox returns active zones intersecting the viewport as GeoJSON', async () => {
    await db.query(`
      insert into hazard_zones (hazard, level, geom, valid_from, valid_to, confidence, reason_en)
      values
        ('flood', 'high', ${ZONE_SQUARE}, now() - interval '1 hour', now() + interval '6 hours', 0.8, 'test'),
        ('haze', 'moderate', ${ZONE_SQUARE}, now() - interval '9 hours', now() - interval '1 hour', 0.5, 'expired')
    `);
    const res = await asRole(db, 'anon', null, () =>
      db.query<{ hazard: string; geometry: { type: string } }>(
        'select hazard, geometry from zones_in_bbox(100.9, 4.4, 101.3, 4.8)',
      ),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.hazard).toBe('flood');
    expect(res.rows[0]!.geometry.type).toMatch(/Polygon/);

    const outside = await db.query('select 1 from zones_in_bbox(110, 1, 111, 2)');
    expect(outside.rows).toHaveLength(0);
  });
});
