// Reload every data feed on a map screen. Two looks: a round floating button (home map) and a
// header icon (hazard and destination screens, which have a coloured header bar).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useLang } from '@/i18n';

interface Props {
  onPress: () => void;
  loading?: boolean;
}

/** Calls reload() on each feed; `loading` while any of them is fetching. */
export function useRefreshAll(feeds: { reload: () => void; loading: boolean }[]) {
  return {
    refresh: () => feeds.forEach((f) => f.reload()),
    loading: feeds.some((f) => f.loading),
  };
}

export function RefreshFab({ onPress, loading }: Props) {
  const { t } = useLang();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={t('common.refresh')}
      accessibilityState={{ busy: !!loading }}
      hitSlop={4}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color="#0E7490" />
      ) : (
        <MaterialCommunityIcons name="refresh" size={24} color="#0E7490" />
      )}
    </Pressable>
  );
}

export function RefreshHeaderButton({
  onPress,
  loading,
  color = '#fff',
}: Props & { color?: string }) {
  const { t } = useLang();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={t('common.refresh')}
      accessibilityState={{ busy: !!loading }}
      hitSlop={8}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <MaterialCommunityIcons name="refresh" size={26} color={color} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  header: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
