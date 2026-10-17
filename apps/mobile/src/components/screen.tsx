import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Simple scrolling page for the non-map tabs. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + BottomTabInset + 24 },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </ScrollView>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.paragraph, { color: theme.textSecondary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 32, fontWeight: '700' },
  paragraph: { fontSize: 16, lineHeight: 24 },
});
