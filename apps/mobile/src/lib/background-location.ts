// Background location for alerts (development builds only; Expo Go can't run it).
// The task must be defined at module top level, so this file is imported from the root layout.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { IS_EXPO_GO, getInstallId } from './device';
import { supabase } from './supabase';

export const BACKGROUND_TASK = 'jagasekitar-background-location';

if (!IS_EXPO_GO) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    BACKGROUND_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length || !supabase) return;
      const { coords } = data.locations.at(-1)!;
      const installId = await getInstallId();
      // Only the last known location is stored (PDPA): overwrite, never append.
      await supabase
        .from('user_devices')
        .update({
          last_lat: coords.latitude,
          last_lon: coords.longitude,
          last_seen_at: new Date().toISOString(),
        })
        .eq('install_id', installId);
    },
  );
}

export async function setBackgroundLocation(
  enabled: boolean,
): Promise<'on' | 'off' | 'unsupported' | 'denied'> {
  if (IS_EXPO_GO) return 'unsupported';
  const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK).catch(() => false);
  if (!enabled) {
    if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
    return 'off';
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return 'denied';
  if (!running) {
    await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 1000, // significant change
      timeInterval: 15 * 60_000,
      deferredUpdatesInterval: 15 * 60_000,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'JagaSekitar alerts are on',
        notificationBody: 'Checking hazards near you.',
      },
    });
  }
  return 'on';
}
