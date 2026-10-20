// Flood map: water palette, rain stations by intensity, river gauges by status, flood zones.
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, LegendRow, RiskLegend, StatusLine, Toggle } from '@/components/map/overlays';
import { RefreshHeaderButton, useRefreshAll } from '@/components/map/refresh-button';
import { WebMap, escapeHtml, type MapMarker } from '@/components/map/web-map';
import { zoneForId, zonePolygons } from '@/components/map/zone-layer';
import { Sheet } from '@/components/sheet';
import { ZoneSheet, sheetStyles } from '@/components/zone-sheet';
import { useFocusRegion } from '@/hooks/use-focus-region';
import { useRemote } from '@/hooks/use-remote';
import { useZones } from '@/hooks/use-zones';
import { useApp } from '@/providers/app-provider';
import { useLang } from '@/i18n';
import {
  fetchRainStations,
  fetchWaterStations,
  type AppZone,
  type RainStation,
  type WaterStation,
} from '@/lib/data';
import { formatTime, rain24Band, rainBand, spreadDuplicates } from '@/lib/format';

const JPS_ALERTS_URL = 'https://publicinfobanjir.water.gov.my/cerapan/amaran-semasa/?lang=en';
const ACCENT = '#0E7490';
const RAIN_COLORS = {
  none: '#CBD5E1',
  light: '#A5F3FC',
  moderate: '#22D3EE',
  heavy: '#0369A1',
  very_heavy: '#1E3A8A',
} as const;
// JPS's own water-level colours.
const WATER_COLORS = {
  normal: '#16A34A',
  alert: '#EAB308',
  warning: '#F97316',
  danger: '#DC2626',
} as const;
const TREND_ARROW = { rising: '▲', falling: '▼', steady: '■' } as const;
const FIFTEEN_MIN = 15 * 60_000;

type Selected =
  { kind: 'rain'; station: RainStation } | { kind: 'water'; station: WaterStation } | null;

export default function FloodMap() {
  const { t, lang } = useLang();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<'1h' | '24h'>('1h');
  const [zone, setZone] = useState<AppZone | null>(null);
  const [station, setStation] = useState<Selected>(null);

  const { coords, status, simulated: sim } = useApp().location;
  const zones = useZones('flood');
  const region = useFocusRegion({
    latitude: 4.6,
    longitude: 100.95,
    latitudeDelta: 2,
    longitudeDelta: 2,
  });
  const rain = useRemote('rain-stations', fetchRainStations, { refreshMs: FIFTEEN_MIN });
  const water = useRemote('water-stations', fetchWaterStations, { refreshMs: FIFTEEN_MIN });
  const rainPins = useMemo(() => spreadDuplicates(rain.data ?? []), [rain.data]);
  const waterPins = useMemo(() => spreadDuplicates(water.data ?? []), [water.data]);
  const simulated = rain.data?.some((r) => r.simulated) || water.data?.some((w) => w.simulated);

  const rainValue = (r: RainStation) => (period === '1h' ? r.rain_1h : r.rain_24h);
  const bandOf = (r: RainStation) =>
    period === '1h' ? rainBand(r.rain_1h) : rain24Band(r.rain_24h);

  const { refresh, loading: refreshing } = useRefreshAll([zones, rain, water]);
  const polygons = useMemo(() => zonePolygons(zones.data ?? []), [zones.data]);
  const markers: MapMarker[] = [
    ...rainPins.map((r) => {
      const band = bandOf(r);
      const dark = band === 'light' || band === 'moderate';
      const value = band === 'none' ? '' : String(Math.round(rainValue(r) ?? 0));
      return {
        id: `rain:${r.station_id}`,
        latitude: r.lat,
        longitude: r.lon,
        size: 30,
        pressable: true,
        html: `<div style="min-width:22px;height:22px;border-radius:11px;border:1.5px solid #fff;box-sizing:border-box;padding:0 3px;display:flex;align-items:center;justify-content:center;background:${RAIN_COLORS[band]};font:800 11px system-ui,sans-serif;color:${dark ? '#0C4A6E' : '#fff'}">${value}</div>`,
      };
    }),
    ...waterPins.map((w) => ({
      id: `water:${w.station_id}`,
      latitude: w.lat,
      longitude: w.lon,
      size: 32,
      pressable: true,
      html: `<div style="background:#fff;border:2.5px solid ${WATER_COLORS[w.status]};border-radius:6px;padding:1px 3px;font:800 12px system-ui,sans-serif;color:${WATER_COLORS[w.status]};white-space:nowrap">🌊${w.trend ? escapeHtml(TREND_ARROW[w.trend]) : ''}</div>`,
    })),
  ];
  const onMapPress = (id: string) => {
    const hit = zoneForId(zones.data, id);
    if (hit) return setZone(hit);
    const [kind, sid] = id.split(':');
    if (kind === 'rain') {
      const r = rainPins.find((p) => `${p.station_id}` === sid);
      if (r) setStation({ kind: 'rain', station: r });
    } else if (kind === 'water') {
      const w = waterPins.find((p) => `${p.station_id}` === sid);
      if (w) setStation({ kind: 'water', station: w });
    }
  };

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
        user={status === 'granted' && !sim ? coords : null}
        polygons={polygons}
        markers={markers}
        onPress={onMapPress}
      />

      <WaterTint />

      <View style={styles.top} pointerEvents="box-none">
        <Card style={styles.topCard}>
          <Toggle
            options={[
              { value: '1h', label: t('flood.rain1h') },
              { value: '24h', label: t('flood.rain24h') },
            ]}
            value={period}
            onChange={setPeriod}
            accent={ACCENT}
          />
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(JPS_ALERTS_URL)}
            accessibilityRole="link"
            style={styles.link}
          >
            <Text style={styles.linkText}>↗ {t('flood.officialAlerts')}</Text>
          </Pressable>
        </Card>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {(zones.data?.length ?? 0) === 0 && !zones.loading && (
          <Card>
            <Text style={styles.empty}>{t('flood.noZones')}</Text>
          </Card>
        )}
        <RiskLegend
          hazard="flood"
          extra={
            <>
              <LegendRow
                items={(['light', 'moderate', 'heavy', 'very_heavy'] as const).map((b) => ({
                  color: RAIN_COLORS[b],
                  label: t(`flood.intensity.${b}`),
                  shape: 'dot' as const,
                }))}
              />
              <LegendRow
                items={(['normal', 'alert', 'warning', 'danger'] as const).map((s) => ({
                  color: WATER_COLORS[s],
                  label: `🌊 ${t(`flood.water.${s}`)}`,
                  shape: 'square' as const,
                }))}
              />
              <StatusLine
                updatedAt={rain.updatedAt}
                fromCache={rain.fromCache}
                error={rain.error}
                simulated={simulated}
              />
            </>
          }
        />
      </View>

      <ZoneSheet zone={zone} updatedAt={zones.updatedAt} onClose={() => setZone(null)} />
      <Sheet visible={!!station} onClose={() => setStation(null)}>
        {station?.kind === 'rain' && (
          <>
            <Text style={sheetStyles.title}>☔ {station.station.name}</Text>
            <Text style={sheetStyles.meta}>{station.station.district}</Text>
            <Text style={sheetStyles.body}>
              {t('flood.rain1h')}: {station.station.rain_1h ?? '–'} mm (
              {t(`flood.intensity.${rainBand(station.station.rain_1h)}`)})
            </Text>
            <Text style={sheetStyles.body}>3 h: {station.station.rain_3h ?? '–'} mm</Text>
            <Text style={sheetStyles.body}>
              {t('flood.rain24h')}: {station.station.rain_24h ?? '–'} mm
            </Text>
            <Text style={sheetStyles.meta}>
              {t('flood.observed', { time: formatTime(station.station.observed_at, lang) })}
            </Text>
          </>
        )}
        {station?.kind === 'water' && (
          <>
            <Text style={sheetStyles.title}>
              🌊 {station.station.river ?? station.station.name}
            </Text>
            <Text style={sheetStyles.meta}>
              {station.station.name} · {station.station.district}
            </Text>
            <Text
              style={[
                sheetStyles.body,
                { color: WATER_COLORS[station.station.status], fontWeight: '700' },
              ]}
            >
              {t(`flood.water.${station.station.status}`)}
              {station.station.trend
                ? ` · ${TREND_ARROW[station.station.trend]} ${t(`flood.trend.${station.station.trend}`)}`
                : ''}
            </Text>
            <Text style={sheetStyles.body}>
              {t('flood.level', { level: station.station.level.toFixed(2) })}
            </Text>
            <Text style={sheetStyles.meta}>
              {t('flood.thresholds', {
                alert: station.station.alert_level ?? '–',
                warning: station.station.warning_level ?? '–',
                danger: station.station.danger_level ?? '–',
              })}
            </Text>
            <Text style={sheetStyles.meta}>
              {t('flood.observed', { time: formatTime(station.station.observed_at, lang) })}
            </Text>
          </>
        )}
        <Text style={sheetStyles.disclaimer}>{t('common.disclaimer')}</Text>
      </Sheet>
    </View>
  );
}

/** Faint water tint so the flood map reads as its own place. */
function WaterTint() {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#0891B214' }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e0f2fe' },
  top: { position: 'absolute', top: 10, left: 12, right: 12 },
  topCard: { gap: 8 },
  link: { alignSelf: 'flex-start', paddingVertical: 4 },
  linkText: { fontSize: 15, fontWeight: '700', color: ACCENT },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0, gap: 8 },
  empty: { fontSize: 15, color: '#0c4a6e' },
});
