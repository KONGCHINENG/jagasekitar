// End-to-end check of the notification job against the real database, then cleans up.
// Attaches a temporary device (fake push token) to the demo admin user inside a live zone.
// Run: npx tsx scripts/e2e-notify.ts
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServiceClient } from '../src/core/db';
import { runNotifications } from '../src/notify';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const db = createServiceClient();
const INSTALL = 'e2e-notify-test';
const FAKE_TOKEN = 'ExponentPushToken[jagasekitar-e2e-test]';

const { data: admin } = await db
  .from('profiles')
  .select('id')
  .eq('role', 'admin')
  .limit(1)
  .single();
if (!admin) throw new Error('No admin profile: run npm run seed:accounts first');

const { data: zones } = await db
  .from('v_active_zones')
  .select('hazard, level, zone_key, geometry, valid_from')
  .lte('valid_from', new Date().toISOString());
const zone = (zones ?? []).find((z) => z.hazard === 'flood') ?? zones?.[0];
if (!zone) throw new Error('No active zone to test with: run npm run predict first');
// Mean of the first ring: inside for the convex buffer zones the flood engine draws.
const ring: [number, number][] =
  zone.geometry.type === 'Polygon' ? zone.geometry.coordinates[0] : zone.geometry.coordinates[0][0];
const lon = ring.reduce((a, p) => a + p[0], 0) / ring.length;
const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
console.log(
  `zone ${zone.zone_key} (${zone.level}); test device at ${lat.toFixed(3)}, ${lon.toFixed(3)}`,
);

await db.from('user_devices').delete().eq('install_id', INSTALL);
const { data: device, error } = await db
  .from('user_devices')
  .insert({
    user_id: admin.id,
    install_id: INSTALL,
    expo_push_token: FAKE_TOKEN,
    last_lat: lat,
    last_lon: lon,
    last_seen_at: new Date().toISOString(),
    min_level: 'low',
    platform: 'test',
  })
  .select('id')
  .single();
if (error) throw error;

try {
  const ctx = { db, now: new Date(), state: 'PRK', useMocks: false };
  const first = await runNotifications(ctx);
  const { data: rows } = await db
    .from('notifications')
    .select('title, body, delivery, data')
    .eq('device_id', device.id);
  const { data: after } = await db
    .from('user_devices')
    .select('expo_push_token')
    .eq('id', device.id)
    .single();
  const second = await runNotifications({ ...ctx, now: new Date() });
  const { count } = await db
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('device_id', device.id);
  console.log(
    JSON.stringify(
      {
        first,
        rowsForTestDevice: rows,
        tokenAfterPush: after?.expo_push_token ?? null,
        second,
        totalRowsForTestDevice: count,
      },
      null,
      1,
    ),
  );
} finally {
  await db.from('notifications').delete().eq('device_id', device.id);
  await db.from('user_devices').delete().eq('id', device.id);
  console.log('cleaned up test device and its notifications');
}
