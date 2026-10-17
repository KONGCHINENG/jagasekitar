// Destination check: search a place → risk there at arrival time → risk along the route.
import { assessPoint, riskAlongRoute } from '@jagasekitar/engine';
import { HAZARD_PALETTES, RISK_COLORS, type RiskLevel } from '@jagasekitar/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toggle } from '@/components/map/overlays';
import { RiskBadge } from '@/components/risk';
import { useNow } from '@/hooks/use-now';
import { useRemote } from '@/hooks/use-remote';
import { useLang } from '@/i18n';
import { fetchDistricts, fetchZones, PENINSULA } from '@/lib/data';
import { fetchRoute, savePlace, searchPlaces, type PlaceResult } from '@/lib/places';
import { useApp } from '@/providers/app-provider';

const ARRIVAL_HOURS = [0, 1, 3, 6, 12, 24, 48];
const ACCENT = '#0E7490';
const ROUTE_CLEAR = '#2563EB';

export default function Destination() {
  const { t, lang } = useLang();
  const insets = useSafeAreaInsets();
  const { location } = useApp();
  const params = useLocalSearchParams<{ lat?: string; lon?: string; label?: string }>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dest, setDest] = useState<PlaceResult | null>(
    params.lat && params.lon
      ? {
          id: 'param',
          name: params.label ?? '',
          detail: '',
          lat: Number(params.lat),
          lon: Number(params.lon),
        }
      : null,
  );
  const [arrivalH, setArrivalH] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  // Debounced search (Nominatim asks for ≤ 1 request per second).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const id = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, lang)
        .then((r) => {
          setResults(r);
          setSearchError(null);
        })
        .catch((e: Error) => setSearchError(e.message))
        .finally(() => setSearching(false));
    }, 700);
    return () => clearTimeout(id);
  }, [query, lang]);

  // Results only apply to a query long enough to have been searched.
  const shownResults = query.trim().length >= 3 ? results : null;
  const now = useNow();
  const arrival = new Date(now + arrivalH * 3600_000);
  const zonesNow = useRemote(dest ? 'zones:all:+0h' : null, () =>
    fetchZones(PENINSULA, new Date()),
  );
  const zonesAtArrival = useRemote(dest ? `zones:all:+${arrivalH}h` : null, () =>
    fetchZones(PENINSULA, new Date(Date.now() + arrivalH * 3600_000)),
  );
  const districts = useRemote('districts', fetchDistricts);
  const from = location.coords;
  const route = useRemote(
    dest
      ? `route:${from.latitude.toFixed(3)},${from.longitude.toFixed(3)}->${dest.lat.toFixed(4)},${dest.lon.toFixed(4)}`
      : null,
    () => fetchRoute(from, dest!),
  );

  const atDest = dest
    ? assessPoint(dest.lat, dest.lon, zonesAtArrival.data ?? [], { time: arrival })
    : null;
  const places = useMemo(
    () =>
      (districts.data ?? []).map((d) => ({
        name: d.name,
        lat: d.centroid_lat,
        lon: d.centroid_lon,
      })),
    [districts.data],
  );
  const along = useMemo(
    () => (route.data ? riskAlongRoute(route.data.coords, zonesNow.data ?? [], { places }) : null),
    [route.data, zonesNow.data, places],
  );

  const save = async (notify: boolean) => {
    if (!dest) return;
    try {
      await savePlace(dest.name || t('destination.labels.home'), dest.lat, dest.lon, notify);
      setSaved(t('destination.saved'));
    } catch (e) {
      setSaved((e as Error).message);
    }
  };

  if (!dest) {
    return (
      <View style={[styles.root, { paddingBottom: insets.bottom }]}>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={t('destination.placeholder')}
          style={styles.input}
          returnKeyType="search"
          accessibilityLabel={t('destination.placeholder')}
        />
        {searching && <Text style={styles.muted}>{t('destination.searching')}</Text>}
        {searchError && <Text style={styles.error}>{searchError}</Text>}
        {shownResults?.length === 0 && (
          <Text style={styles.muted}>{t('destination.noResults')}</Text>
        )}
        <ScrollView keyboardShouldPersistTaps="handled">
          {shownResults?.map((r) => (
            <Pressable
              key={r.id}
              style={styles.result}
              onPress={() => setDest(r)}
              accessibilityRole="button"
            >
              <Text style={styles.resultName}>{r.name}</Text>
              <Text style={styles.resultDetail} numberOfLines={2}>
                {r.detail}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.attribution}>{t('destination.attribution')}</Text>
      </View>
    );
  }

  const fit = route.data?.coords ?? [
    [from.longitude, from.latitude],
    [dest.lon, dest.lat],
  ];
  const lats = [...fit.map((c) => c[1]), dest.lat, from.latitude];
  const lons = [...fit.map((c) => c[0]), dest.lon, from.longitude];
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    latitudeDelta: Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 1.4),
    longitudeDelta: Math.max(0.05, (Math.max(...lons) - Math.min(...lons)) * 1.4),
  };
  const levelColor = (l: RiskLevel) => (l === 'none' ? ROUTE_CLEAR : RISK_COLORS[l]);

  return (
    <View style={styles.root}>
      <MapView style={styles.map} region={region} toolbarEnabled={false}>
        {along?.segments.map((s, i) => (
          <Polyline
            key={i}
            coordinates={s.coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))}
            strokeColor={levelColor(s.level)}
            strokeWidth={s.level === 'none' ? 4 : 7}
          />
        ))}
        <Marker
          coordinate={{ latitude: from.latitude, longitude: from.longitude }}
          pinColor="#2563EB"
        />
        <Marker coordinate={{ latitude: dest.lat, longitude: dest.lon }} title={dest.name} />
      </MapView>

      <ScrollView contentContainerStyle={[styles.panel, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable onPress={() => setDest(null)} accessibilityRole="button">
          <Text style={styles.destName}>📍 {dest.name}</Text>
          {dest.detail ? (
            <Text style={styles.resultDetail} numberOfLines={1}>
              {dest.detail}
            </Text>
          ) : null}
        </Pressable>

        <Text style={styles.heading}>{t('destination.arrival')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Toggle
            options={ARRIVAL_HOURS.map((h) => ({
              value: String(h),
              label: h === 0 ? t('destination.now') : t('destination.inHours', { h }),
            }))}
            value={String(arrivalH)}
            onChange={(v) => setArrivalH(Number(v))}
            accent={ACCENT}
          />
        </ScrollView>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.heading}>{t('destination.atDestination')}</Text>
            {atDest && <RiskBadge level={atDest.overall} />}
          </View>
          {zonesAtArrival.loading && !zonesAtArrival.data ? (
            <ActivityIndicator />
          ) : (
            atDest && (
              <>
                <Text style={styles.body}>
                  {(['haze', 'flood', 'disease'] as const)
                    .map(
                      (h) =>
                        `${HAZARD_PALETTES[h].icon} ${t(`hazard.${h}`)}: ${t(`risk.${atDest[h]}`)}`,
                    )
                    .join('   ')}
                </Text>
                {atDest.advice.slice(0, 3).map((a) => (
                  <Text key={a.en} style={styles.body}>
                    • {lang === 'ms' ? a.ms : a.en}
                  </Text>
                ))}
              </>
            )
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>{t('destination.route')}</Text>
          {route.data && (
            <Text style={styles.muted}>
              {t('destination.duration', {
                km: Math.round(route.data.km),
                min: Math.round(route.data.minutes),
              })}
            </Text>
          )}
          {route.loading && !route.data && <ActivityIndicator />}
          {route.error && !route.data && (
            <Text style={styles.muted}>{t('destination.routeUnavailable')}</Text>
          )}
          {along && along.hits.length === 0 && (
            <Text style={styles.body}>{t('destination.routeClear')}</Text>
          )}
          {along?.hits.map((h) => (
            <Text
              key={`${h.hazard}${h.near}`}
              style={[styles.body, { color: RISK_COLORS[h.level] }]}
            >
              {HAZARD_PALETTES[h.hazard].icon}{' '}
              {t('destination.near', {
                hazard: t(`hazard.${h.hazard}`),
                place: h.near,
                level: t(`risk.${h.level}`),
              })}
            </Text>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            style={styles.secondary}
            onPress={() => void save(false)}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>☆ {t('destination.save')}</Text>
          </Pressable>
          <Pressable
            style={styles.primary}
            onPress={() => void save(true)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>🔔 {t('destination.notify')}</Text>
          </Pressable>
        </View>
        {saved && <Text style={styles.muted}>{saved}</Text>}
        <Text style={styles.attribution}>
          {t('destination.attribution')} · {t('common.disclaimer')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  input: {
    margin: 16,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 17,
  },
  result: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  resultName: { fontSize: 17, fontWeight: '600', color: '#111' },
  resultDetail: { fontSize: 13, color: '#6b7280' },
  muted: { fontSize: 14, color: '#6b7280', paddingHorizontal: 4 },
  error: { fontSize: 14, color: '#b91c1c', paddingHorizontal: 20 },
  attribution: { fontSize: 11, color: '#9ca3af', padding: 12 },
  map: { height: '42%' },
  panel: { padding: 16, gap: 12 },
  destName: { fontSize: 20, fontWeight: '800', color: '#111' },
  heading: { fontSize: 16, fontWeight: '700', color: '#111' },
  body: { fontSize: 15, lineHeight: 22, color: '#222' },
  card: { backgroundColor: '#f8fafc', borderRadius: 14, padding: 12, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  secondary: {
    flex: 1,
    borderWidth: 2,
    borderColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 15, fontWeight: '700', color: ACCENT },
  primary: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
