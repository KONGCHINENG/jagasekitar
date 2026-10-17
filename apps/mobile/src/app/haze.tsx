// Haze map: smoky palette, fire hotspots, wind, time slider and the "why".
import {
  PM25_BAND_LABELS,
  assessPoint,
  pm25Band,
  vectorToBearing,
  windToBearing,
  windVector,
} from '@jagasekitar/engine';
import { riskRank } from '@jagasekitar/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, LegendRow, RiskLegend, StatusLine, TimeSlider } from '@/components/map/overlays';
import { WindParticles } from '@/components/map/wind-particles';
import { ZoneLayer } from '@/components/map/zone-layer';
import { RiskBadge } from '@/components/risk';
import { ZoneSheet } from '@/components/zone-sheet';
import { useRemote } from '@/hooks/use-remote';
import { useUserLocation } from '@/hooks/use-user-location';
import { useZones } from '@/hooks/use-zones';
import { useNow } from '@/hooks/use-now';
import { useLang } from '@/i18n';
import { fetchHotspotCells, fetchPm25, fetchWind, type AppZone } from '@/lib/data';

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
  const { coords } = useUserLocation();
  const [slice, setSlice] = useState(0);
  const [selected, setSelected] = useState<AppZone | null>(null);
  const [center, setCenter] = useState({ latitude: 2.6, longitude: 101.0 });

  const zones = useZones('haze', slice);
  const fires = useRemote('hotspot-cells', fetchHotspotCells, { refreshMs: 15 * 60_000 });
  const wind = useRemote(`wind:+${slice}h`, () =>
    fetchWind(new Date(Date.now() + slice * 3600_000)),
  );
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

  const now = useNow();
  const at = new Date(now + slice * 3600_000);
  const here = assessPoint(coords.latitude, coords.longitude, zones.data ?? [], { time: at });
  // "Why" panel: the zone over you, else the most severe zone on the map.
  const focus =
    here.zones.find((z) => z.hazard === 'haze') ??
    [...(zones.data ?? [])].sort((a, b) => riskRank(b.level) - riskRank(a.level))[0];
  const band = pm25.data != null ? pm25Band(pm25.data) : null;
  const simulated = fires.data?.some((f) => f.simulated);

  return (
    <View style={styles.root}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: 2.6, longitude: 101.0, latitudeDelta: 7, longitudeDelta: 7 }}
        onRegionChangeComplete={(r) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
        showsUserLocation
        toolbarEnabled={false}
      >
        <ZoneLayer zones={zones.data ?? []} onPress={setSelected} />
        {(fires.data ?? []).slice(0, 200).map((f) => (
          <Marker
            key={`f${f.lat},${f.lon}`}
            coordinate={{ latitude: f.lat, longitude: f.lon }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
            accessibilityLabel={`${t('haze.fires')}: ${f.hotspots}`}
          >
            <Text style={{ fontSize: Math.min(26, 12 + Math.sqrt(f.frp_sum)) }}>🔥</Text>
          </Marker>
        ))}
        {(wind.data ?? []).map((w) => (
          <Marker
            key={`w${w.lat},${w.lon}`}
            coordinate={{ latitude: w.lat, longitude: w.lon }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
          >
            {/* ➤ points east; rotate to the direction the air travels. */}
            <Text
              style={[
                styles.arrow,
                {
                  transform: [{ rotate: `${windToBearing(w.dir_from) - 90}deg` }],
                  opacity: Math.min(1, 0.35 + w.speed / 40),
                },
              ]}
            >
              ➤
            </Text>
          </Marker>
        ))}
      </MapView>

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
          🔥 {t('haze.fires')} · ➤ {t('haze.wind')}
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
  arrow: { fontSize: 18, color: '#4B4453' },
  footnote: { fontSize: 12, color: '#fff', textShadowColor: '#000', textShadowRadius: 3 },
});
