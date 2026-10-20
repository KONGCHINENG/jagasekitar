// Haze map: smoky palette, fire hotspots, wind, time slider and the "why".
import {
  PM25_BAND_LABELS,
  assessPoint,
  haversineKm,
  pm25Band,
  vectorToBearing,
  windToBearing,
  windVector,
} from '@jagasekitar/engine';
import { riskRank } from '@jagasekitar/shared';
import { Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, LegendRow, RiskLegend, StatusLine, TimeSlider } from '@/components/map/overlays';
import { RefreshHeaderButton, useRefreshAll } from '@/components/map/refresh-button';
import { WebMap, type MapMarker } from '@/components/map/web-map';
import { WindParticles } from '@/components/map/wind-particles';
import { zoneForId, zonePolygons } from '@/components/map/zone-layer';
import { RiskBadge } from '@/components/risk';
import { ZoneSheet } from '@/components/zone-sheet';
import { useFocusRegion } from '@/hooks/use-focus-region';
import { useRemote } from '@/hooks/use-remote';
import { useApp } from '@/providers/app-provider';
import { useZones } from '@/hooks/use-zones';
import { useNow } from '@/hooks/use-now';
import { useLang } from '@/i18n';
import {
  fetchAirStations,
  fetchHotspotCells,
  fetchPm25,
  fetchWind,
  type AppZone,
} from '@/lib/data';

const SLICES = [0, 12, 24, 48, 72];
const ACCENT = '#6D28D9';
const BAND_COLORS = {
  good: '#16A34A',
  moderate: '#CA8A04',
  unhealthy: '#EA580C',
  very_unhealthy: '#B91C1C',
  hazardous: '#581C87',
} as const;

export default function HazeMap() {
  const { t, lang, pick } = useLang();
  const insets = useSafeAreaInsets();
  const { coords, status, simulated: sim } = useApp().location;
  const region = useFocusRegion({
    latitude: 2.6,
    longitude: 101.0,
    latitudeDelta: 7,
    longitudeDelta: 7,
  });
  const [slice, setSlice] = useState(0);
  const [selected, setSelected] = useState<AppZone | null>(null);
  const [center, setCenter] = useState({ latitude: 2.6, longitude: 101.0 });

  const zones = useZones('haze', slice);
  const fires = useRemote('hotspot-cells', fetchHotspotCells, { refreshMs: 15 * 60_000 });
  const wind = useRemote(`wind:+${slice}h`, () =>
    fetchWind(new Date(Date.now() + slice * 3600_000)),
  );
  const air = useRemote('air-stations', fetchAirStations, { refreshMs: 30 * 60_000 });
  const pm25 = useRemote(
    `pm25:${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}:+${slice}h`,
    () => fetchPm25(coords.latitude, coords.longitude, new Date(Date.now() + slice * 3600_000)),
  );

  // Dominant transport near the map centre drives the particle animation.
  const drift = useMemo(() => {
    const near = (wind.data ?? []).filter(
      (w) => Math.abs(w.lat - center.latitude) <= 3 && Math.abs(w.lon - center.longitude) <= 3,
    );
    if (!near.length) return null;
    const sum = near.reduce(
      (acc, w) => {
        const v = windVector(w.speed, w.dir_from);
        return { u: acc.u + v.u, v: acc.v + v.v };
      },
      { u: 0, v: 0 },
    );
    return vectorToBearing({ u: sum.u / near.length, v: sum.v / near.length });
  }, [wind.data, center]);

  const { refresh, loading: refreshing } = useRefreshAll([zones, fires, wind, air, pm25]);
  const polygons = useMemo(() => zonePolygons(zones.data ?? []), [zones.data]);
  const markers = useMemo<MapMarker[]>(() => {
    const fireMarkers = (fires.data ?? []).slice(0, 200).map((f) => {
      const size = Math.round(Math.min(26, 12 + Math.sqrt(f.frp_sum)));
      return {
        id: `fire:${f.lat},${f.lon}`,
        latitude: f.lat,
        longitude: f.lon,
        size: size + 4,
        html: `<div style="font-size:${size}px;line-height:1">🔥</div>`,
      };
    });
    // ➤ points east; rotate to the direction the air travels.
    const windMarkers = (wind.data ?? []).map((w) => ({
      id: `wind:${w.lat},${w.lon}`,
      latitude: w.lat,
      longitude: w.lon,
      size: 22,
      html: `<div style="font-size:18px;line-height:1;color:#4B4453;opacity:${Math.min(1, 0.35 + w.speed / 40).toFixed(2)};transform:rotate(${Math.round(windToBearing(w.dir_from) - 90)}deg)">➤</div>`,
    }));
    // Measured readings are for "now" only.
    const airMarkers =
      slice === 0
        ? (air.data ?? [])
            .filter((a) => a.pm25 != null)
            .map((a) => {
              const b = pm25Band(a.pm25!);
              const value = Math.round(a.pm25!);
              return {
                id: `air:${a.uid}`,
                latitude: a.lat,
                longitude: a.lon,
                size: 34,
                popup: [
                  a.name,
                  t('haze.measured', { value }),
                  a.official ? '' : t('haze.sensor'),
                  a.simulated ? t('common.simulated') : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
                // Community sensors: round and dashed, so they don't read as official monitors.
                html: `<div style="min-width:26px;padding:2px 4px;border-radius:${a.official ? 6 : 13}px;border:2px ${a.official ? 'solid' : 'dashed'} #fff;box-shadow:0 1px 3px #0006;background:${BAND_COLORS[b]};color:#fff;font:800 12px system-ui,sans-serif;text-align:center${a.simulated ? ';opacity:.7' : ''}">${value}</div>`,
              };
            })
        : [];
    return [...fireMarkers, ...windMarkers, ...airMarkers];
  }, [fires.data, wind.data, air.data, slice, t]);

  const now = useNow();
  const at = new Date(now + slice * 3600_000);
  const here = assessPoint(coords.latitude, coords.longitude, zones.data ?? [], { time: at });
  // "Why" panel: the zone over you, else the most severe zone on the map.
  const focus =
    here.zones.find((z) => z.hazard === 'haze') ??
    [...(zones.data ?? [])].sort((a, b) => riskRank(b.level) - riskRank(a.level))[0];
  const band = pm25.data != null ? pm25Band(pm25.data) : null;
  // Nearest measured station within 30 km, shown next to the model's estimate.
  const nearest = (air.data ?? [])
    .filter((a) => a.pm25 != null && a.official)
    .map((a) => ({ a, km: haversineKm(coords.latitude, coords.longitude, a.lat, a.lon) }))
    .filter((x) => x.km <= 30)
    .sort((x, y) => x.km - y.km)[0]?.a;
  const measuredBand = nearest ? pm25Band(nearest.pm25!) : null;
  const simulated = fires.data?.some((f) => f.simulated);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerRight: () => <RefreshHeaderButton onPress={refresh} loading={refreshing} />,
        }}
      />
      <WebMap
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={setCenter}
        user={status === 'granted' && !sim ? coords : null}
        polygons={polygons}
        markers={markers}
        onPress={(id) => setSelected(zoneForId(zones.data, id) ?? null)}
      />

      <LinearGradient
        pointerEvents="none"
        colors={['#6B728059', '#F59E0B1A', '#7C3AED26']}
        style={StyleSheet.absoluteFill}
      />
      {drift && <WindParticles bearing={drift.bearing} speedKmh={drift.speed} />}

      <View style={[styles.top]} pointerEvents="box-none">
        <TimeSlider slices={SLICES} value={slice} onChange={setSlice} accent={ACCENT} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Card style={styles.why}>
          <View style={styles.whyHeader}>
            <Text style={styles.whyTitle}>{t('zone.why')}</Text>
            <RiskBadge level={here.haze} size="sm" />
          </View>
          <Text style={styles.whyText}>
            {focus ? pick(focus.reason, focus.reasonMs) : t('haze.noHaze')}
          </Text>
          <Text style={[styles.pm, band && { color: BAND_COLORS[band] }]}>
            {band
              ? t('haze.pm25', {
                  value: Math.round(pm25.data!),
                  band: lang === 'ms' ? PM25_BAND_LABELS[band].ms : PM25_BAND_LABELS[band].en,
                })
              : t('haze.pm25Unknown')}
          </Text>
          {slice === 0 && nearest && measuredBand && (
            <Text style={[styles.pm, { color: BAND_COLORS[measuredBand] }]}>
              {t('haze.measuredAt', {
                value: Math.round(nearest.pm25!),
                band:
                  lang === 'ms'
                    ? PM25_BAND_LABELS[measuredBand].ms
                    : PM25_BAND_LABELS[measuredBand].en,
                name: nearest.name,
              })}
              {nearest.simulated ? ` · ${t('common.simulated')}` : ''}
            </Text>
          )}
          <StatusLine
            updatedAt={zones.updatedAt}
            fromCache={zones.fromCache}
            error={zones.error}
            simulated={simulated}
          />
        </Card>
        <RiskLegend
          hazard="haze"
          extra={
            <LegendRow
              items={[
                ...(['good', 'moderate', 'unhealthy', 'very_unhealthy', 'hazardous'] as const).map(
                  (b) => ({
                    color: BAND_COLORS[b],
                    label: t(`haze.bands.${b}`),
                    shape: 'dot' as const,
                  }),
                ),
              ]}
            />
          }
        />
        <Text style={styles.footnote}>
          🔥 {t('haze.fires')} · ➤ {t('haze.wind')} · ▢ {t('haze.stations')}
        </Text>
      </View>

      <ZoneSheet zone={selected} updatedAt={zones.updatedAt} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#3f3a44' },
  top: { position: 'absolute', top: 10, left: 12, right: 12 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0, gap: 8 },
  why: { gap: 6, borderLeftWidth: 4, borderLeftColor: ACCENT },
  whyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  whyTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  whyText: { fontSize: 15, lineHeight: 21, color: '#222' },
  pm: { fontSize: 14, fontWeight: '700', color: '#444' },
  footnote: { fontSize: 12, color: '#fff', textShadowColor: '#000', textShadowRadius: 3 },
});
