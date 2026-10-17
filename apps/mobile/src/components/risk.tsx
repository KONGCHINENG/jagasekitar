// Risk is always shown as colour + icon + text (colour-blind friendly).
import {
  HAZARD_PALETTES,
  RISK_COLORS,
  RISK_ICONS,
  riskRank,
  type Hazard,
  type RiskLevel,
} from '@jagasekitar/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLang } from '@/i18n';

export function RiskBadge({ level, size = 'md' }: { level: RiskLevel; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useLang();
  const color = RISK_COLORS[level];
  const big = size === 'lg';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${t('zone.level')}: ${t(`risk.${level}`)}`}
      style={[
        styles.badge,
        { backgroundColor: color },
        big && styles.badgeLg,
        size === 'sm' && styles.badgeSm,
      ]}
    >
      <Text
        style={[styles.badgeText, big && styles.badgeTextLg, size === 'sm' && styles.badgeTextSm]}
      >
        {RISK_ICONS[level]} {t(`risk.${level}`)}
      </Text>
    </View>
  );
}

export function HazardChip({
  hazard,
  level,
  onPress,
}: {
  hazard: Hazard;
  level: RiskLevel;
  onPress?: () => void;
}) {
  const { t } = useLang();
  const palette = HAZARD_PALETTES[hazard];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t(`hazard.${hazard}`)}: ${t(`risk.${level}`)}`}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: palette.base },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={styles.chipTitle} maxFontSizeMultiplier={1.6}>
        {palette.icon} {t(`hazard.${hazard}`)}
      </Text>
      <Text style={[styles.chipLevel, { color: RISK_COLORS[level] }]} maxFontSizeMultiplier={1.6}>
        {RISK_ICONS[level]} {t(`risk.${level}`)}
      </Text>
    </Pressable>
  );
}

/** Fill colour for a zone on a hazard map: the hazard's own palette, darker for higher risk. */
export function zoneFill(hazard: Hazard, level: RiskLevel, alpha = '66'): string {
  const scale = HAZARD_PALETTES[hazard].scale;
  return `${scale[Math.min(riskRank(level), scale.length - 1)]}${alpha}`;
}

export function zoneStroke(hazard: Hazard, level: RiskLevel): string {
  return zoneFill(hazard, level, 'CC');
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeLg: { paddingHorizontal: 14, paddingVertical: 6 },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  badgeTextLg: { fontSize: 18 },
  badgeTextSm: { fontSize: 12 },
  chip: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#ffffffee',
    gap: 2,
  },
  chipTitle: { fontSize: 14, fontWeight: '600', color: '#111' },
  chipLevel: { fontSize: 14, fontWeight: '700' },
});
