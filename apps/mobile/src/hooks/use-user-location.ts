// Foreground location for centring the map. Falls back to Ipoh when denied or unavailable.
// (Background location for alerts is requested separately, with its own explanation.)
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { IPOH } from '@/lib/data';

export type LocationStatus = 'locating' | 'granted' | 'denied';

export function useUserLocation() {
  const [coords, setCoords] = useState(IPOH);
  const [status, setStatus] = useState<LocationStatus>('locating');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') {
          if (!cancelled) setStatus('denied');
          return;
        }
        // A cached fix is fast; a fresh one follows.
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled)
          setCoords({ latitude: last.coords.latitude, longitude: last.coords.longitude });
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setStatus('granted');
        }
      } catch {
        if (!cancelled) setStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { coords, status };
}
