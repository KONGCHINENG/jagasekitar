import { StyleSheet, Text, View } from 'react-native';
import { Toggle } from '@/components/map/overlays';
import { Paragraph, Screen } from '@/components/screen';
import { useTheme } from '@/hooks/use-theme';
import { setLanguage, useLang, type Language } from '@/i18n';

export default function SettingsScreen() {
  const { t, lang } = useLang();
  const theme = useTheme();
  return (
    <Screen title={t('tabs.settings')}>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: theme.text }]}>{t('settings.language')}</Text>
        <Toggle<Language>
          options={[
            { value: 'en', label: 'English' },
            { value: 'ms', label: 'Bahasa Melayu' },
          ]}
          value={lang}
          onChange={(l) => void setLanguage(l)}
          accent="#0E7490"
        />
      </View>
      <Paragraph>{t('settings.comingSoon')}</Paragraph>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: theme.text }]}>{t('settings.about')}</Text>
        <Paragraph>{t('common.disclaimer')}</Paragraph>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { fontSize: 18, fontWeight: '700' },
});
