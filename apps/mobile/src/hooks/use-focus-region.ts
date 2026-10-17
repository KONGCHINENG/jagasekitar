import { useLocalSearchParams } from 'expo-router';

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Map region from ?lat=&lon= (a hazard map opened from an alert), else the screen's default. */
export function useFocusRegion(fallback: Region): Region {
  const params = useLocalSearchParams<{ lat?: string; lon?: string }>();
  const lat = Number(params.lat);
  const lon = Number(params.lon);
  return params.lat && params.lon && Number.isFinite(lat) && Number.isFinite(lon)
    ? { latitude: lat, longitude: lon, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : fallback;
}
