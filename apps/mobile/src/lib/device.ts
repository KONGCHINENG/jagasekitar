// Anonymous identity, per-install id, alert preferences and device registration.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RiskLevel } from '@jagasekitar/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const INSTALL_KEY = 'jagasekitar:install-id';
const PREFS_KEY = 'jagasekitar:prefs';
export const ONBOARDED_KEY = 'jagasekitar:onboarded';

export interface AlertPrefs {
  notify_haze: boolean;
  notify_flood: boolean;
  notify_disease: boolean;
  notify_saved_places: boolean;
  min_level: RiskLevel;
  quiet_start: string | null; // "22:00"
  quiet_end: string | null;
  background_location: boolean;
}

export const DEFAULT_PREFS: AlertPrefs = {
  notify_haze: true,
  notify_flood: true,
  notify_disease: true,
  notify_saved_places: true,
  min_level: 'moderate',
  quiet_start: null,
  quiet_end: null,
  background_location: false,
};

/** Expo Go can't do remote push on Android or background location anywhere. */
export const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function getInstallId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALL_KEY).catch(() => null);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await AsyncStorage.setItem(INSTALL_KEY, id).catch(() => {});
  return id;
}

export async function resetInstallId(): Promise<void> {
  await AsyncStorage.removeItem(INSTALL_KEY).catch(() => {});
}

export async function loadPrefs(): Promise<AlertPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AlertPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: AlertPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
}

/** The app works without an account: a Supabase anonymous user owns this device's data. */
export async function ensureSession(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
  return signedIn.user?.id ?? null;
}

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Hazard alerts',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 200, 300],
      lightColor: '#DC2626',
    });
  }
}

export type PushStatus = 'push' | 'in_app' | 'denied';

/**
 * Expo push token when possible. Expo Go on Android can't receive remote push (SDK 53+), and a
 * token needs an EAS projectId; otherwise alerts arrive in-app over Realtime instead.
 */
export async function getPushToken(): Promise<{ token: string | null; status: PushStatus }> {
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return { token: null, status: 'denied' };
  if (IS_EXPO_GO && Platform.OS === 'android') return { token: null, status: 'in_app' };
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return { token: null, status: 'in_app' };
  try {
    await setupNotificationChannel();
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data, status: 'push' };
  } catch {
    return { token: null, status: 'in_app' };
  }
}

export interface Registration {
  lat: number;
  lon: number;
  token: string | null;
  prefs: AlertPrefs;
  language: 'en' | 'ms';
}

/** Upsert this install's device row (last location only, never a history). */
export async function registerDevice(userId: string, r: Registration): Promise<string | null> {
  if (!supabase) return null;
  const installId = await getInstallId();
  const { data, error } = await supabase
    .from('user_devices')
    .upsert(
      {
        user_id: userId,
        install_id: installId,
        expo_push_token: r.token,
        platform: Platform.OS,
        last_lat: r.lat,
        last_lon: r.lon,
        last_seen_at: new Date().toISOString(),
        language: r.language,
        ...r.prefs,
      },
      { onConflict: 'install_id' },
    )
    .select('id')
    .single();
  if (error) {
    // The install id belongs to an older (deleted) identity: start fresh next time.
    if (/row-level security/i.test(error.message)) await resetInstallId();
    throw new Error(`Device registration failed: ${error.message}`);
  }
  return data.id as string;
}
