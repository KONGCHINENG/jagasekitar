// Main map: everything near you in one neutral view, with a "Your area" summary on top.
import { assessPoint } from '@jagasekitar/engine';
import { HAZARD_PALETTES, HAZARDS, type Hazard } from '@jagasekitar/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, LegendRow, StatusLine } from '@/components/map/overlays';
import { ZoneLayer } from '@/components/map/zone-layer';
import { HazardChip, RiskBadge } from '@/components/risk';
import { ZoneSheet } from '@/components/zone-sheet';
import { BottomTabInset } from '@/constants/theme';
import { useUserLocation } from '@/hooks/use-user-location';
import { useZones } from '@/hooks/use-zones';
import { useLang } from '@/i18n';
import type { AppZone } from '@/lib/data';

const ROUTE: Record<Hazard, '/haze' | '/flood' | '/illness'> = {
  haze: '/haze',
  flood: '/flood',
  disease: '/illness',
};

export default function HomeMap() {
  const { t } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const { coords, status } = useUserLocation();
  const zones = useZones();
  const [selected, setSelected] = useState<AppZone | null>(null);

  useEffect(() => {
    if (status === 'granted') {
      map.current?.animateToRegion({ ...coords, latitudeDelta: 0.6, longitudeDelta: 0.6 }, 600);
    }
  }, [coords, status]);

  const here = useMemo(
    () => assessPoint(coords.latitude, coords.longitude, zones.data ?? []),
    [coords, zones.data],
  );

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...coords, latitudeDelta: 0.8, longitudeDelta: 0.8 }}
        showsUserLocation={status === 'granted'}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        mapPadding={{ top: 200, bottom: BottomTabInset + 60, left: 0, right: 0 }}
      >
        <ZoneLayer zones={zones.data ?? []} mode="neutral" onPress={setSelected} />
      </MapView>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Card style={styles.areaCard}>
          <View style={styles.areaHeader}>
            <Text style={styles.areaTitle} accessibilityRole="header">
              {t('home.yourArea')}
            </Text>
            <RiskBadge level={here.overall} />
          </View>
          <View style={styles.chips}>
            {HAZARDS.map((h) => (
              <HazardChip
                key={h}
                hazard={h}
                level={here[h]}
                onPress={() => router.push(ROUTE[h])}
              />
            ))}
          </View>
          {here.overall === 'none' && <Text style={styles.hint}>{t('home.allClear')}</Text>}
          {status === 'locating' && <Text style={styles.hint}>{t('home.locating')}</Text>}
          {status === 'denied' && <Text style={styles.hint}>{t('home.defaultArea')}</Text>}
          <StatusLine updatedAt={zones.updatedAt} fromCache={zones.fromCache} error={zones.error} />
        </Card>

        <Pressable
          onPress={() => router.push('/destination')}
          accessibilityRole="search"
          style={({ pressed }) => [styles.search, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.searchText}>🔍 {t('home.search')}</Text>
        </Pressable>
      </View>

      <View
        style={[styles.bottom, { bottom: BottomTabInset + insets.bottom + 8 }]}
        pointerEvents="box-none"
      >
        <Card>
          <Text style={styles.legendTitle}>{t('home.legend')}</Text>
          <LegendRow
            items={HAZARDS.map((h) => ({
              color: HAZARD_PALETTES[h].scale[3]!,
              label: `${HAZARD_PALETTES[h].icon} ${t(`hazard.${h}`)}`,
            }))}
          />
          <Text style={styles.disclaimer}>{t('common.disclaimer')}</Text>
        </Card>
      </View>

      <ZoneSheet zone={selected} updatedAt={zones.updatedAt} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { position: 'absolute', left: 12, right: 12, top: 0, gap: 10 },
  areaCard: { gap: 10 },
  areaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  areaTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  chips: { flexDirection: 'row', gap: 8 },
  hint: { fontSize: 13, color: '#444' },
  search: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  searchText: { fontSize: 16, color: '#555' },
  bottom: { position: 'absolute', left: 12, right: 12 },
  legendTitle: { fontSize: 13, fontWeight: '700', color: '#333', marginBottom: 4 },
  disclaimer: { fontSize: 11, color: '#666', marginTop: 6 },
});
