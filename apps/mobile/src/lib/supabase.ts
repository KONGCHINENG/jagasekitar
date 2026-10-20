import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.supabaseUrl || '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.supabaseAnonKey || '';

// AsyncStorage's web version uses window.localStorage. Expo can evaluate the screens in Node at build
// time (no window), so only persist the session where storage exists; the phone always has it.
const canPersist = Platform.OS !== 'web' || typeof window !== 'undefined';

/** Null when the app was started without Supabase settings; screens then show cached data only. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: canPersist ? AsyncStorage : undefined,
          autoRefreshToken: canPersist,
          persistSession: canPersist,
          detectSessionInUrl: false,
        },
      })
    : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the root .env',
    );
  }
  return supabase;
}
