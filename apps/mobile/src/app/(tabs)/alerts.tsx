import { Paragraph, Screen } from '@/components/screen';
import { useLang } from '@/i18n';

// Notification history and official alerts arrive with notifications (Phase 6).
export default function AlertsScreen() {
  const { t } = useLang();
  return (
    <Screen title={t('tabs.alerts')}>
      <Paragraph>{t('placeholder.alerts')}</Paragraph>
    </Screen>
  );
}
