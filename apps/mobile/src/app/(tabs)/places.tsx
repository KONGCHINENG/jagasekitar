import { Paragraph, Screen } from '@/components/screen';
import { useLang } from '@/i18n';

// Saved places with their current risk arrive in Phase 6.
export default function PlacesScreen() {
  const { t } = useLang();
  return (
    <Screen title={t('tabs.places')}>
      <Paragraph>{t('placeholder.places')}</Paragraph>
    </Screen>
  );
}
