// Illness map: district choropleth by risk, disease filter, facility pins, per-district trends.
import { HAZARD_PALETTES, maxRisk, riskRank, type RiskLevel } from '@jagasekitar/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, RiskLegend, StatusLine } from '@/components/map/overlays';
import { WebMap, type MapMarker, type MapPolygon } from '@/components/map/web-map';
import { polygonParts } from '@/components/map/zone-layer';
import { RiskBadge, zoneFill } from '@/components/risk';
import { Sheet } from '@/components/sheet';
import { Sparkline } from '@/components/sparkline';
import { sheetStyles } from '@/components/zone-sheet';
import { useFocusRegion } from '@/hooks/use-focus-region';
import { useRemote } from '@/hooks/use-remote';
import { useZones } from '@/hooks/use-zones';
import { useLang } from '@/i18n';
import {
  fetchDiseaseSummary,
  fetchDiseaseTypes,
  fetchDistricts,
  fetchFacilities,
  type DistrictShape,
} from '@/lib/data';

const ACCENT = HAZARD_PALETTES.disease.base;
const HOUR = 3600_000;

export default function IllnessMap() {
  const { t, lang, pick } = useLang();
  const insets = useSafeAreaInsets();
  const [disease, setDisease] = useState<string | null>(null);
  const [district, setDistrict] = useState<DistrictShape | null>(null);

  const zones = useZones('disease');
  const region = useFocusRegion({
    latitude: 4.65,
    longitude: 101.0,
    latitudeDelta: 2.4,
    longitudeDelta: 2.4,
  });
  const districts = useRemote('districts', fetchDistricts);
  const types = useRemote('disease-types', fetchDiseaseTypes);
  const summary = useRemote('disease-summary', fetchDiseaseSummary, { refreshMs: HOUR });
  const facilities = useRemote('facilities', fetchFacilities, { refreshMs: HOUR });

  const visibleZones = useMemo(
    () => (zones.data ?? []).filter((z) => !disease || z.diseaseCode === disease),
    [zones.data, disease],
  );
  const levelOf = (name: string): RiskLevel =>
    maxRisk(...visibleZones.filter((z) => z.district === name).map((z) => z.level));

  const polygons: MapPolygon[] = (districts.data ?? []).flatMap((d) => {
    if (!d.geometry) return [];
    const level = levelOf(d.name);
    return polygonParts(d.geometry).map((part) => ({
      id: `district:${d.name}`,
      rings: [part.outer, ...part.holes],
      fill: level === 'none' ? '#ffffff22' : zoneFill('disease', level, '99'),
      stroke: '#9D174D',
      width: 1,
    }));
  });
  const markers: MapMarker[] = (facilities.data ?? []).map((f) => ({
    id: `facility:${f.facility_id}`,
    latitude: f.lat,
    longitude: f.lon,
    size: 34,
    popup: `${f.name}
${t('illness.reports', { count: f.reports_7d })}`,
    html:
      `<div style="display:flex;flex-direction:column;align-items:center">` +
      `<div style="font-size:20px;line-height:1">${f.type === 'hospital' ? '🏥' : '🩺'}</div>` +
      (f.reports_7d > 0
        ? `<div style="margin-top:-4px;font:800 11px system-ui,sans-serif;color:#fff;background:${ACCENT};border-radius:8px;padding:0 5px">${f.reports_7d}</div>`
        : '') +
      '</div>',
  }));
  const onMapPress = (id: string) => {
    const name = id.startsWith('district:') ? id.slice('district:'.length) : null;
    const hit = name ? districts.data?.find((d) => d.name === name) : undefined;
    if (hit) setDistrict(hit);
  };

  const districtZones = district
    ? visibleZones
        .filter((z) => z.district === district.name)
        .sort((a, b) => riskRank(b.level) - riskRank(a.level))
    : [];
  const districtRows = district
    ? (summary.data ?? []).filter(
        (s) => s.district === district.name && (!disease || s.disease_code === disease),
      )
    : [];

  return (
    <View style={styles.root}>
      <WebMap
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        polygons={polygons}
        markers={markers}
        onPress={onMapPress}
      />

      <View style={styles.top} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {[
            { code: null as string | null, name: t('illness.all') },
            ...(types.data ?? []).map((d) => ({ code: d.code, name: pick(d.name_en, d.name_ms) })),
          ].map((d) => {
            const active = disease === d.code;
            return (
              <Pressable
                key={d.code ?? 'all'}
                onPress={() => setDisease(d.code)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && { backgroundColor: ACCENT, borderColor: ACCENT }]}
              >
                <Text style={[styles.chipText, active && { color: '#fff' }]}>{d.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <RiskLegend
          hazard="disease"
          extra={
            <>
              <Text style={styles.note}>
                🏥 🩺 {t('illness.facilities')} · {t('illness.note')}
              </Text>
              <StatusLine
                updatedAt={zones.updatedAt}
                fromCache={zones.fromCache}
                error={zones.error}
              />
            </>
          }
        />
      </View>

      <Sheet visible={!!district} onClose={() => setDistrict(null)}>
        {district && (
          <>
            <Text style={sheetStyles.title}>🦠 {district.name}</Text>
            <RiskBadge level={levelOf(district.name)} size="lg" />
            {districtRows.length === 0 && (
              <Text style={sheetStyles.body}>{t('illness.noReports')}</Text>
            )}
            {districtRows.map((s) => (
              <Card key={s.disease_code} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={sheetStyles.heading}>
                    {lang === 'ms' ? s.disease_name_ms : s.disease_name_en}
                  </Text>
                  <Text style={sheetStyles.meta}>
                    {t('illness.cases7d', { count: s.cases_7d })}
                    {s.baseline_ratio != null ? ` · ${Number(s.baseline_ratio).toFixed(1)}×` : ''}
                    {s.per_100k != null ? ` · ${Number(s.per_100k).toFixed(1)}/100k` : ''}
                  </Text>
                </View>
                <View style={styles.spark}>
                  <Sparkline values={s.trend_14d} color={ACCENT} />
                  <Text style={styles.sparkLabel}>{t('illness.trend')}</Text>
                </View>
              </Card>
            ))}
            {districtZones.length > 0 && <Text style={sheetStyles.heading}>{t('zone.why')}</Text>}
            {districtZones.map((z) => (
              <View key={z.dbId} style={styles.reason}>
                <RiskBadge level={z.level} size="sm" />
                <Text style={sheetStyles.body}>{pick(z.reason, z.reasonMs)}</Text>
              </View>
            ))}
            <Text style={sheetStyles.disclaimer}>
              {t('illness.note')} {t('common.disclaimer')}
            </Text>
          </>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fdf2f8' },
  top: { position: 'absolute', top: 10, left: 0, right: 0 },
  chips: { paddingHorizontal: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#F9A8D4',
  },
  chipText: { fontSize: 14, fontWeight: '600', color: '#831843' },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0 },
  note: { fontSize: 12, color: '#555' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 0,
    shadowOpacity: 0,
    backgroundColor: '#fdf2f8',
  },
  rowText: { flex: 1, gap: 2 },
  spark: { alignItems: 'flex-end' },
  sparkLabel: { fontSize: 10, color: '#777' },
  reason: { gap: 4 },
});
