// Runs the real migrations and seed against an in-process Postgres (PGlite + PostGIS) with a
// minimal stand-in for Supabase's auth schema and API roles. Lets us test schema, RLS, views and
// RPCs without Docker or a cloud project.
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const SUPABASE_SHIM = `
  create schema if not exists extensions;
  create schema if not exists auth;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    is_anonymous boolean default false,
    last_sign_in_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, extensions, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  -- Mirror Supabase's default privileges for objects created in public.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export function readSql(rel: string): string {
  return readFileSync(root + rel, 'utf8');
}

export function migrationFiles(): string[] {
  return readdirSync(root + 'migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => 'migrations/' + f);
}

export const SEED_FILES = ['seed.sql', 'seed/stations.sql', 'seed/districts_geom.sql'];

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { postgis } });
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    await db.exec(readSql(file));
  }
  for (const file of SEED_FILES) {
    await db.exec(readSql(file));
  }
  await db.exec('grant select on spatial_ref_sys to anon, authenticated;');
  return db;
}

/** Run `fn` as an API role, optionally as a signed-in user. Restores superuser afterwards. */
export async function asRole<T>(
  db: PGlite,
  role: 'anon' | 'authenticated',
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return res.rows[0]!.id;
}
