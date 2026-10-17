import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  DISCLAIMER,
  HAZARD_PALETTES,
  HAZARDS,
  RISK_COLORS,
  RISK_ICONS,
  RISK_LABELS,
} from '@jagasekitar/shared';

// Placeholder home. The full-screen map, "Your area" card and hazard maps arrive in Phase 5.
export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          JagaSekitar
        </ThemedText>
        <ThemedText style={styles.center}>
          Haze, flood and disease early warning for your area.
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">Your area</ThemedText>
          <View style={styles.chips}>
            {HAZARDS.map((hazard) => (
              <View
                key={hazard}
                style={[styles.chip, { borderColor: HAZARD_PALETTES[hazard].base }]}
              >
                <ThemedText>
                  {HAZARD_PALETTES[hazard].icon} {hazard}
                </ThemedText>
                <ThemedText type="small" style={{ color: RISK_COLORS.none }}>
                  {RISK_ICONS.none} {RISK_LABELS.none.en}
                </ThemedText>
              </View>
            ))}
          </View>
        </ThemedView>

        <ThemedText type="small" style={styles.center}>
          {DISCLAIMER.en}
        </ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  title: {
    textAlign: 'center',
  },
  center: {
    textAlign: 'center',
  },
  card: {
    alignSelf: 'stretch',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
  chips: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  chip: {
    flex: 1,
    gap: Spacing.one,
    padding: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
  },
});
