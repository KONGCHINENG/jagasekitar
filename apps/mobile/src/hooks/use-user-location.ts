// Foreground location: a first fix, then updates while the app is open (300 m steps).
// Falls back to Ipoh when denied or unavailable. Background location is separate and opt-in.
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { IPOH } from '@/lib/data';

export type LocationStatus = 'locating' | 'granted' | 'denied';

export function useUserLocation(enabled = true) {
  const [coords, setCoords] = useState(IPOH);
  const [status, setStatus] = useState<LocationStatus>('locating');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') {
          if (!cancelled) setStatus('denied');
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) {
          setCoords({ latitude: last.coords.latitude, longitude: last.coords.longitude });
          setStatus('granted');
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 300, timeInterval: 60_000 },
          (pos) => {
            if (cancelled) return;
            setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            setStatus('granted');
          },
        );
        if (cancelled) sub.remove();
      } catch {
        if (!cancelled) setStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { coords, status };
}
