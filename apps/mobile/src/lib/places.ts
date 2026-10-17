// Geocoding (Nominatim), routing (OSRM) and saved places.
import Constants from 'expo-constants';
import type { LonLat } from '@jagasekitar/engine';
import { requireSupabase } from './supabase';

const extra = (Constants.expoConfig?.extra ?? {}) as { osrmBaseUrl?: string };
const OSRM = (extra.osrmBaseUrl || 'https://router.project-osrm.org').replace(/\/$/, '');
// Nominatim policy: identify the application; no heavy use (we debounce and cache).
const APP_HEADERS = { 'User-Agent': 'JagaSekitar-App/1.0', Accept: 'application/json' };

export interface PlaceResult {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

const searchCache = new Map<string, PlaceResult[]>();

export async function searchPlaces(query: string, lang: 'en' | 'ms'): Promise<PlaceResult[]> {
  const q = query.trim();
  const key = `${lang}:${q.toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    countrycodes: 'my',
    limit: '6',
    addressdetails: '0',
    'accept-language': lang === 'ms' ? 'ms,en' : 'en',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: APP_HEADERS,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const rows = (await res.json()) as {
    place_id: number;
    name: string;
    display_name: string;
    lat: string;
    lon: string;
  }[];
  const results = rows.map((r) => ({
    id: String(r.place_id),
    name: r.name || r.display_name.split(',')[0]!,
    detail: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
  searchCache.set(key, results);
  return results;
}

export interface Route {
  coords: LonLat[];
  km: number;
  minutes: number;
}

export async function fetchRoute(
  from: { latitude: number; longitude: number },
  to: { lat: number; lon: number },
): Promise<Route> {
  const url = `${OSRM}/route/v1/driving/${from.longitude},${from.latitude};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: APP_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const json = (await res.json()) as {
    code: string;
    routes?: { distance: number; duration: number; geometry: { coordinates: LonLat[] } }[];
  };
  const route = json.routes?.[0];
  if (json.code !== 'Ok' || !route) throw new Error(`No route (${json.code})`);
  return {
    coords: route.geometry.coordinates,
    km: route.distance / 1000,
    minutes: route.duration / 60,
  };
}

export interface SavedPlace {
  id: string;
  label: string;
  notify: boolean;
  lat: number;
  lon: number;
}

export const fetchMyPlaces = async (): Promise<SavedPlace[]> => {
  const { data, error } = await requireSupabase()
    .from('v_my_places')
    .select('id, label, notify, lat, lon')
    .order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
};

export async function savePlace(
  label: string,
  lat: number,
  lon: number,
  notify: boolean,
): Promise<void> {
  const { error } = await requireSupabase().rpc('save_place', {
    p_label: label,
    p_lat: lat,
    p_lon: lon,
    p_notify: notify,
  });
  if (error) throw new Error(error.message);
}

export async function setPlaceNotify(id: string, notify: boolean): Promise<void> {
  const { error } = await requireSupabase().from('saved_places').update({ notify }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePlace(id: string): Promise<void> {
  const { error } = await requireSupabase().from('saved_places').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
