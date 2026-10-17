import { diseaseAdvice, floodAdvice, hazeAdvice } from '@jagasekitar/engine';
import { HAZARD_PALETTES } from '@jagasekitar/shared';
import { StyleSheet, Text, View } from 'react-native';
import { useLang } from '@/i18n';
import type { AppZone } from '@/lib/data';
import { useNow } from '@/hooks/use-now';
import { formatTime, timeAgo } from '@/lib/format';
import { RiskBadge } from './risk';
import { Sheet } from './sheet';

function adviceFor(zone: AppZone) {
  if (zone.hazard === 'haze') return hazeAdvice(zone.level);
  if (zone.hazard === 'flood') return floodAdvice(zone.level);
  return zone.diseaseCode ? diseaseAdvice([zone.diseaseCode]) : [];
}

export function ZoneSheet({
  zone,
  updatedAt,
  onClose,
}: {
  zone: AppZone | null;
  updatedAt: number | null;
  onClose: () => void;
}) {
  const { t, lang, pick } = useLang();
  const now = useNow();
  return (
    <Sheet visible={!!zone} onClose={onClose}>
      {zone && (
        <>
          <Text style={styles.title} accessibilityRole="header">
            {HAZARD_PALETTES[zone.hazard].icon} {t(`hazard.${zone.hazard}`)}
            {zone.district ? ` · ${zone.district}` : ''}
          </Text>
          <RiskBadge level={zone.level} size="lg" />
          <Text style={styles.meta}>
            {t('zone.valid', {
              from: formatTime(zone.validFrom, lang),
              to: formatTime(zone.validTo, lang),
            })}
          </Text>
          <Text style={styles.meta}>
            {t('zone.confidence', { pct: Math.round(zone.confidence * 100) })}
          </Text>

          <Text style={styles.heading}>{t('zone.why')}</Text>
          <Text style={styles.body}>{pick(zone.reason, zone.reasonMs)}</Text>

          {adviceFor(zone).length > 0 && (
            <>
              <Text style={styles.heading}>{t('zone.advice')}</Text>
              {adviceFor(zone).map((a) => (
                <View key={a.en} style={styles.adviceRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.body}>{lang === 'ms' ? a.ms : a.en}</Text>
                </View>
              ))}
            </>
          )}

          <Text style={styles.heading}>{t('zone.sources')}</Text>
          <Text style={styles.meta}>
            {zone.sourceRefs.join(' · ')}
            {updatedAt ? ` · ${t('common.updated', { ago: timeAgo(updatedAt, t, now) })}` : ''}
          </Text>
          <Text style={styles.disclaimer}>{t('common.disclaimer')}</Text>
        </>
      )}
    </Sheet>
  );
}

export const sheetStyles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  heading: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 4 },
  body: { fontSize: 16, lineHeight: 23, color: '#222', flexShrink: 1 },
  meta: { fontSize: 14, color: '#555' },
  disclaimer: { fontSize: 12, color: '#777', marginTop: 8 },
});

const styles = StyleSheet.create({
  ...sheetStyles,
  adviceRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 16, lineHeight: 23, color: '#222' },
});
