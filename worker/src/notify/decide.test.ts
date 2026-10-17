import { describe, expect, it } from 'vitest';
import {
  composeMessage,
  decideNotifications,
  inQuietHours,
  malaysiaMinutes,
  type Candidate,
  type RecentNotification,
} from './decide';

// 2026-10-17 14:00 MYT
const NOW = new Date('2026-10-17T06:00:00Z');
const RULES = { now: NOW, dedupeHours: 6, quietBypassLevel: 'severe' as const };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  device_id: 'd1',
  user_id: 'u1',
  expo_push_token: null,
  language: 'en',
  min_level: 'moderate',
  quiet_start: null,
  quiet_end: null,
  notify_haze: true,
  notify_flood: true,
  notify_disease: true,
  place_id: null,
  place_label: null,
  zone_id: 'z1',
  zone_key: 'flood:Kuala Kangsar:high',
  hazard: 'flood',
  level: 'high',
  valid_from: hoursAgo(1),
  district: 'Kuala Kangsar',
  reason_en: 'Flood risk high (Kuala Kangsar): 72 mm rain in 3 hours at Kuala Kangsar.',
  reason_ms: 'Risiko banjir tinggi (Kuala Kangsar): 72 mm hujan dalam 3 jam di Kuala Kangsar.',
  lat: 4.77,
  lon: 100.94,
  ...over,
});
const sent = (over: Partial<RecentNotification> = {}): RecentNotification => ({
  device_id: 'd1',
  hazard: 'flood',
  level: 'high',
  place_id: null,
  sent_at: hoursAgo(1),
  ...over,
});

describe('decideNotifications', () => {
  it('sends a new alert at or above the user minimum level', () => {
    expect(decideNotifications([cand()], [], RULES)).toEqual([
      { candidate: cand(), reason: 'new' },
    ]);
    expect(decideNotifications([cand({ level: 'low' })], [], RULES)).toEqual([]);
  });

  it('respects per-hazard switches', () => {
    expect(decideNotifications([cand({ notify_flood: false })], [], RULES)).toEqual([]);
  });

  it('does not repeat the same hazard and level within 6 hours', () => {
    expect(decideNotifications([cand()], [sent()], RULES)).toEqual([]);
    expect(decideNotifications([cand({ level: 'moderate' })], [sent()], RULES)).toEqual([]); // lower: skip
    expect(decideNotifications([cand()], [sent({ sent_at: hoursAgo(7) })], RULES)).toHaveLength(1); // expired
  });

  it('sends again when the level increases', () => {
    expect(decideNotifications([cand({ level: 'severe' })], [sent()], RULES)[0]?.reason).toBe(
      'upgraded',
    );
  });

  it('dedupes per target: a saved place is separate from where the phone is', () => {
    const atHome = cand({ place_id: 'p1', place_label: 'Home' });
    expect(decideNotifications([atHome], [sent()], RULES)).toHaveLength(1);
  });

  it('sends one alert per device and hazard, the most severe', () => {
    const out = decideNotifications(
      [
        cand({ level: 'moderate', zone_id: 'a' }),
        cand({ level: 'severe', zone_id: 'b', place_id: 'p1' }),
        cand({ hazard: 'haze', zone_id: 'c' }),
      ],
      [],
      RULES,
    );
    expect(out.map((d) => d.candidate.zone_id).sort()).toEqual(['b', 'c']);
  });

  it('holds non-severe alerts during quiet hours, but not severe ones', () => {
    const quiet = { quiet_start: '13:00:00', quiet_end: '15:00:00' }; // NOW is 14:00 MYT
    expect(decideNotifications([cand(quiet)], [], RULES)).toEqual([]);
    expect(decideNotifications([cand({ ...quiet, level: 'severe' })], [], RULES)).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  it('uses Malaysia time and handles windows across midnight', () => {
    expect(malaysiaMinutes(NOW)).toBe(14 * 60);
    expect(inQuietHours(new Date('2026-10-17T15:30:00Z'), '22:00', '07:00')).toBe(true); // 23:30 MYT
    expect(inQuietHours(new Date('2026-10-17T22:30:00Z'), '22:00', '07:00')).toBe(true); // 06:30 MYT
    expect(inQuietHours(NOW, '22:00', '07:00')).toBe(false);
    expect(inQuietHours(NOW, null, '07:00')).toBe(false);
  });
});

describe('composeMessage', () => {
  it('writes the spec-style flood alert', () => {
    expect(composeMessage(cand(), NOW).title).toBe('🌊 Flood risk HIGH near Kuala Kangsar');
  });

  it('says when haze is expected, using the saved place name, in Malay', () => {
    const msg = composeMessage(
      cand({
        hazard: 'haze',
        level: 'moderate',
        valid_from: new Date(NOW.getTime() + 18 * 3600_000).toISOString(),
        place_label: 'Ipoh',
        language: 'ms',
        reason_ms: 'Asap daripada Riau.',
      }),
      NOW,
    );
    expect(msg.title).toBe('🌫️ Jerebu dijangka di Ipoh dalam 18 jam (Sederhana)');
    expect(msg.body).toBe('Asap daripada Riau. Sediakan pelitup N95.');
  });
});
