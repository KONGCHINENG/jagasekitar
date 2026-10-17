// Creates (or updates) the demo admin and hospital-staff accounts in your Supabase project.
// Run: npm run seed:accounts
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the DEMO_* variables in the root .env.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
}

async function upsertAccount(email: string, password: string, fullName: string): Promise<string> {
  const existing = await findUserId(email);
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing, { password });
    if (error) throw error;
    return existing;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

const adminId = await upsertAccount(
  env('DEMO_ADMIN_EMAIL'),
  env('DEMO_ADMIN_PASSWORD'),
  'Demo Admin',
);
{
  const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', adminId);
  if (error) throw error;
}

const facilityName = process.env.DEMO_STAFF_FACILITY?.trim() || 'Hospital Raja Permaisuri Bainun';
const { data: facility, error: facilityError } = await supabase
  .from('facilities')
  .select('id')
  .eq('name', facilityName)
  .single();
if (facilityError) throw new Error(`Facility "${facilityName}" not found. Run the seed first.`);

const staffId = await upsertAccount(
  env('DEMO_STAFF_EMAIL'),
  env('DEMO_STAFF_PASSWORD'),
  'Demo Hospital Staff',
);
{
  const { error } = await supabase
    .from('profiles')
    .update({ role: 'hospital_staff', facility_id: facility.id })
    .eq('id', staffId);
  if (error) throw error;
}

console.log(`admin account ready: ${env('DEMO_ADMIN_EMAIL')}`);
console.log(`hospital staff account ready: ${env('DEMO_STAFF_EMAIL')} (${facilityName})`);
