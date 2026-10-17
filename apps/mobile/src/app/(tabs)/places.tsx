// Saved places (Home, Work, Kampung…) with their current risk and per-place alerts.
import { assessPoint } from '@jagasekitar/engine';
import { HAZARD_PALETTES } from '@jagasekitar/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { RiskBadge } from '@/components/risk';
import { Paragraph, Screen } from '@/components/screen';
import { useRemote } from '@/hooks/use-remote';
import { useZones } from '@/hooks/use-zones';
import { useLang } from '@/i18n';
import { deletePlace, fetchMyPlaces, setPlaceNotify } from '@/lib/places';
import { useApp } from '@/providers/app-provider';

export default function PlacesScreen() {
  const { t } = useLang();
  const router = useRouter();
  const { userId } = useApp();
  const zones = useZones();
  const places = useRemote(userId ? `places:${userId}` : null, fetchMyPlaces);
  const { reload } = places;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <Screen title={t('tabs.places')}>
      {places.data?.length === 0 && <Paragraph>{t('places.empty')}</Paragraph>}
      {places.data?.map((p) => {
        const a = assessPoint(p.lat, p.lon, zones.data ?? []);
        return (
          <View key={p.id} style={styles.card}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/destination',
                  params: { lat: String(p.lat), lon: String(p.lon), label: p.label },
                })
              }
              accessibilityRole="button"
              style={styles.header}
            >
              <Text style={styles.label}>📍 {p.label}</Text>
              <RiskBadge level={a.overall} />
            </Pressable>
            <Text style={styles.levels}>
              {(['haze', 'flood', 'disease'] as const)
                .map((h) => `${HAZARD_PALETTES[h].icon} ${t(`risk.${a[h]}`)}`)
                .join('   ')}
            </Text>
            <View style={styles.row}>
              <Text style={styles.small}>
                {p.notify ? t('places.alertsOn') : t('places.alertsOff')}
              </Text>
              <Switch
                value={p.notify}
                onValueChange={(v) => void setPlaceNotify(p.id, v).then(reload)}
                accessibilityLabel={`${p.label}: ${t('settings.savedPlaceAlerts')}`}
              />
              <Pressable
                onPress={() => void deletePlace(p.id).then(reload)}
                accessibilityRole="button"
                style={styles.remove}
              >
                <Text style={styles.removeText}>{t('places.remove')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <Pressable
        style={styles.add}
        onPress={() => router.push('/destination')}
        accessibilityRole="button"
      >
        <Text style={styles.addText}>＋ {t('places.add')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: { fontSize: 18, fontWeight: '700', color: '#111', flexShrink: 1 },
  levels: { fontSize: 15, color: '#333' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  small: { fontSize: 14, color: '#555', flex: 1 },
  remove: { paddingHorizontal: 10, paddingVertical: 6 },
  removeText: { fontSize: 14, fontWeight: '600', color: '#b91c1c' },
  add: {
    borderWidth: 2,
    borderColor: '#0E7490',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addText: { fontSize: 16, fontWeight: '700', color: '#0E7490' },
});
