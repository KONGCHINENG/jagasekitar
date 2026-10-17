import { StyleSheet, Text, View } from 'react-native';
import { useLang } from '@/i18n';

// Destination search and route risk arrive in Phase 6.
export default function DestinationScreen() {
  const { t } = useLang();
  return (
    <View style={styles.root}>
      <Text style={styles.text}>{t('placeholder.destination')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, backgroundColor: '#fff' },
  text: { fontSize: 16, lineHeight: 24, color: '#444' },
});
