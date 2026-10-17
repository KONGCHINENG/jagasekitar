// Extends app.json. The monorepo keeps one .env at the repo root; Expo only reads .env files in
// this folder, so load the root one here and pass the public values through `extra`.
// Only EXPO_PUBLIC_* values go to the app: never the service role key.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    osrmBaseUrl: process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
  },
});
