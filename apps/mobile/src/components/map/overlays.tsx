// Floating map overlays: legend, time slider, status banner.
import { RISK_ICONS, RISK_LEVELS, type Hazard, type RiskLevel } from '@jagasekitar/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLang } from '@/i18n';
import { useNow } from '@/hooks/use-now';
import { timeAgo } from '@/lib/format';
import { zoneFill } from '../risk';
import { MapCredit } from './base-map';

const LEVELS = RISK_LEVELS.filter((l): l is Exclude<RiskLevel, 'none'> => l !== 'none');

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Risk legend in a hazard's palette (colour + icon + text). */
export function RiskLegend({
  hazard,
  title,
  extra,
  bare,
  credit = true,
}: {
  hazard: Hazard;
  title?: string;
  extra?: ReactNode;
  /** Without the card background, for use inside another card. */
  bare?: boolean;
  /** Show the basemap credit (Android); off where the screen shows it elsewhere. */
  credit?: boolean;
}) {
  const { t } = useLang();
  const Wrapper = bare ? View : Card;
  return (
    <Wrapper style={styles.legend}>
      {title && <Text style={styles.legendTitle}>{title}</Text>}
      <View style={styles.legendRow}>
        {LEVELS.map((level) => (
          <View key={level} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: zoneFill(hazard, level, 'CC') }]} />
            <Text style={styles.legendText}>
              {RISK_ICONS[level]} {t(`risk.${level}`)}
            </Text>
          </View>
        ))}
      </View>
      {extra}
      {credit && <MapCredit />}
    </Wrapper>
  );
}

export function LegendRow({
  items,
}: {
  items: { color: string; label: string; shape?: 'dot' | 'square' }[];
}) {
  return (
    <View style={styles.legendRow}>
      {items.map((i) => (
        <View key={i.label} style={styles.legendItem}>
          <View
            style={[i.shape === 'dot' ? styles.dot : styles.swatch, { backgroundColor: i.color }]}
          />
          <Text style={styles.legendText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function TimeSlider({
  slices,
  value,
  onChange,
  accent,
}: {
  slices: number[];
  value: number;
  onChange: (h: number) => void;
  accent: string;
}) {
  const { t } = useLang();
  return (
    <Card style={styles.slider}>
      <Text style={styles.legendTitle}>{t('haze.slider')}</Text>
      <View style={styles.segments} accessibilityRole="tablist">
        {slices.map((h) => {
          const active = h === value;
          return (
            <Pressable
              key={h}
              onPress={() => onChange(h)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segment, active && { backgroundColor: accent }]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {h === 0 ? t('haze.now') : t('haze.plus', { h })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

export function Toggle<T extends string>({
  options,
  value,
  onChange,
  accent,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent: string;
}) {
  return (
    <View style={styles.segments}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          style={[styles.segment, o.value === value && { backgroundColor: accent }]}
        >
          <Text style={[styles.segmentText, o.value === value && styles.segmentTextActive]}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** "Updated 5 min ago", offline and stale-data notices. */
export function StatusLine({
  updatedAt,
  fromCache,
  error,
  simulated,
}: {
  updatedAt: number | null;
  fromCache: boolean;
  error: string | null;
  simulated?: boolean;
}) {
  const { t } = useLang();
  const now = useNow();
  const stale = updatedAt != null && now - updatedAt > 2 * 3600_000;
  const notConfigured = error?.includes('not configured');
  return (
    <View style={styles.status}>
      {updatedAt != null && (
        <Text style={styles.statusText}>
          {t('common.updated', { ago: timeAgo(updatedAt, t, now) })}
        </Text>
      )}
      {notConfigured && (
        <Text style={[styles.statusText, styles.warn]}>{t('common.notConfigured')}</Text>
      )}
      {!notConfigured && (fromCache || error) && (
        <Text style={[styles.statusText, styles.warn]}>{t('common.offline')}</Text>
      )}
      {stale && <Text style={[styles.statusText, styles.warn]}>{t('common.stale')}</Text>}
      {simulated && <Text style={[styles.statusText, styles.info]}>{t('common.simulated')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffffee',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  legend: { gap: 6 },
  legendTitle: { fontSize: 13, fontWeight: '700', color: '#333' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: '#0004' },
  legendText: { fontSize: 13, color: '#222' },
  slider: { gap: 6 },
  segments: { flexDirection: 'row', backgroundColor: '#eceef2', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#333' },
  segmentTextActive: { color: '#fff' },
  status: { gap: 2 },
  statusText: { fontSize: 12, color: '#444' },
  warn: { color: '#9a3412', fontWeight: '600' },
  info: { color: '#1d4ed8' },
});
