// Main map: the map is the interface. Search floats on top; a compact "Your area" card at the
// bottom doubles as the layer switcher (tap a hazard to show only its zones, tap again for all).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { assessPoint } from '@jagasekitar/engine';
import {
  HAZARD_PALETTES,
  HAZARDS,
  RISK_COLORS,
  RISK_ICONS,
  type Hazard,
} from '@jagasekitar/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshFab, useRefreshAll } from '@/components/map/refresh-button';
import { MapCredit, WebMap, type WebMapHandle } from '@/components/map/web-map';
import { Card, RiskLegend, StatusLine } from '@/components/map/overlays';
import { zoneForId, zonePolygons } from '@/components/map/zone-layer';
import { HazardIcon, RiskBadge } from '@/components/risk';
import { ZoneSheet } from '@/components/zone-sheet';
import { BottomTabInset } from '@/constants/theme';
import { useApp } from '@/providers/app-provider';
import { useDemoMode } from '@/hooks/use-demo-mode';
import { useZones } from '@/hooks/use-zones';
import { useLang } from '@/i18n';
import type { AppZone } from '@/lib/data';

const ROUTE: Record<Hazard, '/haze' | '/flood' | '/illness'> = {
  haze: '/haze',
  flood: '/flood',
  disease: '/illness',
};
const TOP_BAR = 64; // search pill + gap, below the status bar

export default function HomeMap() {
  const { t } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const map = useRef<WebMapHandle>(null);
  const { location, error: appError } = useApp();
  const { coords, status, simulated } = location;
  const zones = useZones();
  const demo = useDemoMode();
  const [selected, setSelected] = useState<AppZone | null>(null);
  const [layer, setLayer] = useState<Hazard | null>(null);
  const [cardHeight, setCardHeight] = useState(200);

  const { refresh, loading: refreshing } = useRefreshAll([zones]);

  const recenter = () =>
    map.current?.animateToRegion({ ...coords, latitudeDelta: 0.4, longitudeDelta: 0.4 });

  useEffect(() => {
    if (status === 'granted') {
      map.current?.animateToRegion({ ...coords, latitudeDelta: 0.6, longitudeDelta: 0.6 });
    }
  }, [coords, status]);

  const here = useMemo(
    () => assessPoint(coords.latitude, coords.longitude, zones.data ?? []),
    [coords, zones.data],
  );
  const polygons = useMemo(
    () =>
      zonePolygons(
        (zones.data ?? []).filter((z) => !layer || z.hazard === layer),
        { mode: layer ? 'hazard' : 'neutral' },
      ),
    [zones.data, layer],
  );
  const user = status === 'granted' && !simulated ? coords : null;

  const bottomOffset = BottomTabInset + insets.bottom + 8;
  const notice =
    (simulated && t('settings.simulating', { name: simulated.name })) ||
    (status === 'locating' && t('home.locating')) ||
    (status === 'denied' && t('home.defaultArea')) ||
    appError;

  return (
    <View style={styles.root}>
      <WebMap
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...coords, latitudeDelta: 0.8, longitudeDelta: 0.8 }}
        user={user}
        polygons={polygons}
        onPress={(id) => setSelected(zoneForId(zones.data, id) ?? null)}
        padding={{
          top: insets.top + TOP_BAR,
          bottom: bottomOffset + cardHeight,
          left: 0,
          right: 0,
        }}
      />

      {/* Top: search, then the status pills that matter right now. */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => router.push('/destination')}
          accessibilityRole="search"
          accessibilityLabel={t('home.search')}
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="magnify" size={22} color="#374151" />
          <Text style={styles.searchText} numberOfLines={1}>
            {t('home.search')}
          </Text>
        </Pressable>
        <View style={styles.pills} pointerEvents="none">
          {demo?.enabled && <Text style={[styles.pill, styles.demoPill]}>{t('common.demo')}</Text>}
          {notice ? <Text style={[styles.pill, styles.noticePill]}>{notice}</Text> : null}
        </View>
      </View>

      {/* Right: recentre on the user (or the simulated location). */}
      <View
        style={[styles.fabs, { bottom: bottomOffset + cardHeight + 12 }]}
        pointerEvents="box-none"
      >
        <RefreshFab onPress={refresh} loading={refreshing} />
        <Pressable
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel={t('home.locate')}
          hitSlop={4}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={24} color="#0E7490" />
        </Pressable>
        <MapCredit />
      </View>

      {/* Bottom: your area + layer switcher. */}
      <View
        style={[styles.bottom, { bottom: bottomOffset }]}
        pointerEvents="box-none"
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
      >
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleBox}>
              <Text style={styles.cardTitle} accessibilityRole="header">
                {t('home.yourArea')}
              </Text>
              <StatusLine
                updatedAt={zones.updatedAt}
                fromCache={zones.fromCache}
                error={zones.error}
              />
            </View>
            <RiskBadge level={here.overall} />
          </View>

          <View style={styles.tiles} accessibilityRole="tablist">
            {HAZARDS.map((h) => {
              const active = layer === h;
              const palette = HAZARD_PALETTES[h];
              return (
                <Pressable
                  key={h}
                  onPress={() => setLayer(active ? null : h)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${t(`hazard.${h}`)}: ${t(`risk.${here[h]}`)}`}
                  style={({ pressed }) => [
                    styles.tile,
                    { borderColor: active ? palette.base : '#E5E7EB' },
                    active && { backgroundColor: `${palette.base}14` },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.tileHead}>
                    <HazardIcon hazard={h} size={18} />
                    <Text style={styles.tileName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                      {t(`hazard.${h}`)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.tileLevel, { color: RISK_COLORS[here[h]] }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.4}
                  >
                    {RISK_ICONS[here[h]]} {t(`risk.${here[h]}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {layer ? (
            <>
              <RiskLegend hazard={layer} bare credit={false} />
              <Pressable
                onPress={() => router.push(ROUTE[layer])}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.details,
                  { backgroundColor: HAZARD_PALETTES[layer].base },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.detailsText}>
                  {t('home.details', { hazard: t(`hazard.${layer}`) })}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#fff" />
              </Pressable>
            </>
          ) : (
            <Text style={styles.hint}>
              {here.overall === 'none' ? t('home.allClear') : t('home.showOnly')}
            </Text>
          )}
          <Text style={styles.disclaimer}>{t('common.disclaimer')}</Text>
        </Card>
      </View>

      <ZoneSheet zone={selected} updatedAt={zones.updatedAt} onClose={() => setSelected(null)} />
    </View>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.15,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E5E7EB' },
  pressed: { opacity: 0.75 },
  top: { position: 'absolute', left: 16, right: 16, top: 0, gap: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 18,
    ...shadow,
  },
  searchText: { flex: 1, fontSize: 16, color: '#4B5563' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    fontSize: 13,
    fontWeight: '600',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  demoPill: { color: '#92400E', backgroundColor: '#FEF3C7' },
  noticePill: { color: '#9A3412', backgroundColor: '#FFF7ED' },
  fabs: { position: 'absolute', left: 16, right: 16, alignItems: 'flex-end', gap: 8 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  bottom: { position: 'absolute', left: 12, right: 12 },
  card: { gap: 10, backgroundColor: '#fff' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitleBox: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    minHeight: 56,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 2,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tileName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  tileLevel: { fontSize: 14, fontWeight: '700' },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    borderRadius: 12,
  },
  detailsText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  hint: { fontSize: 13, color: '#4B5563' },
  disclaimer: { fontSize: 11, color: '#6B7280' },
});
