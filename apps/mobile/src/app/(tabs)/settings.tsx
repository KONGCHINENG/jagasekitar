import { RISK_LEVELS, type RiskLevel } from '@jagasekitar/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Toggle } from '@/components/map/overlays';
import { Paragraph, Screen } from '@/components/screen';
import { useRemote } from '@/hooks/use-remote';
import { useTheme } from '@/hooks/use-theme';
import { setLanguage, useLang, type Language } from '@/i18n';
import { setBackgroundLocation } from '@/lib/background-location';
import { fetchDistricts } from '@/lib/data';
import { IS_EXPO_GO, setupNotificationChannel } from '@/lib/device';
import { useApp } from '@/providers/app-provider';

const ACCENT = '#0E7490';
const QUIET_PRESETS = [
  { value: 'off', start: null, end: null },
  { value: '22-07', start: '22:00', end: '07:00' },
  { value: '23-06', start: '23:00', end: '06:00' },
] as const;

export default function SettingsScreen() {
  const { t, lang } = useLang();
  const theme = useTheme();
  const { prefs, setPrefs, pushStatus, refreshPush, resetAll, location, setSimulated } = useApp();
  const [bgNote, setBgNote] = useState<string | null>(null);
  const [devTaps, setDevTaps] = useState(0);
  const districts = useRemote(devTaps >= 5 ? 'districts' : null, fetchDistricts);
  const text = { color: theme.text };

  const quietValue = QUIET_PRESETS.find((p) => p.start === prefs.quiet_start)?.value ?? 'off';

  const toggleBackground = async (on: boolean) => {
    const result = await setBackgroundLocation(on);
    if (result === 'unsupported') setBgNote(t('settings.backgroundUnsupported'));
    else if (result === 'denied') setBgNote(t('settings.backgroundDenied'));
    else setBgNote(null);
    setPrefs({ ...prefs, background_location: result === 'on' });
  };

  const enableNotifications = async () => {
    await setupNotificationChannel().catch(() => {});
    await Notifications.requestPermissionsAsync();
    await refreshPush();
  };

  const confirmDelete = () =>
    Alert.alert(t('settings.deleteConfirmTitle'), t('settings.deleteConfirmBody'), [
      { text: t('settings.cancel'), style: 'cancel' },
      { text: t('settings.delete'), style: 'destructive', onPress: () => void resetAll() },
    ]);

  return (
    <Screen title={t('tabs.settings')}>
      <Section title={t('settings.language')}>
        <Toggle<Language>
          options={[
            { value: 'en', label: 'English' },
            { value: 'ms', label: 'Bahasa Melayu' },
          ]}
          value={lang}
          onChange={(l) => void setLanguage(l)}
          accent={ACCENT}
        />
      </Section>

      <Section title={t('settings.delivery')}>
        <Paragraph>
          {pushStatus === 'push'
            ? t('settings.deliveryPush')
            : pushStatus === 'in_app'
              ? t('settings.deliveryInApp')
              : t('settings.deliveryDenied')}
        </Paragraph>
        {pushStatus === 'denied' && (
          <Pressable
            style={styles.button}
            onPress={() => void enableNotifications()}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{t('settings.enableNotifications')}</Text>
          </Pressable>
        )}
      </Section>

      <Section title={t('settings.hazards')}>
        {(['haze', 'flood', 'disease'] as const).map((h) => {
          const key = `notify_${h}` as const;
          return (
            <Row key={h} label={t(`hazard.${h}`)}>
              <Switch value={prefs[key]} onValueChange={(v) => setPrefs({ ...prefs, [key]: v })} />
            </Row>
          );
        })}
        <Row label={t('settings.savedPlaceAlerts')}>
          <Switch
            value={prefs.notify_saved_places}
            onValueChange={(v) => setPrefs({ ...prefs, notify_saved_places: v })}
          />
        </Row>
      </Section>

      <Section title={t('settings.minLevel')}>
        <Toggle<RiskLevel>
          options={RISK_LEVELS.filter((l) => l !== 'none').map((l) => ({
            value: l,
            label: t(`risk.${l}`),
          }))}
          value={prefs.min_level}
          onChange={(l) => setPrefs({ ...prefs, min_level: l })}
          accent={ACCENT}
        />
      </Section>

      <Section title={t('settings.quietHours')}>
        <Toggle
          options={QUIET_PRESETS.map((p) => ({
            value: p.value,
            label: p.start ? `${p.start}–${p.end}` : t('settings.quietOff'),
          }))}
          value={quietValue}
          onChange={(v) => {
            const p = QUIET_PRESETS.find((x) => x.value === v)!;
            setPrefs({ ...prefs, quiet_start: p.start, quiet_end: p.end });
          }}
          accent={ACCENT}
        />
      </Section>

      <Section title={t('settings.background')}>
        <Row label={t('settings.backgroundHelp')}>
          <Switch
            value={prefs.background_location}
            onValueChange={(v) => void toggleBackground(v)}
          />
        </Row>
        {(bgNote || IS_EXPO_GO) && (
          <Paragraph>{bgNote ?? t('settings.backgroundUnsupported')}</Paragraph>
        )}
      </Section>

      <Section title={t('settings.privacy')}>
        <Paragraph>{t('settings.privacyText')}</Paragraph>
        <Pressable
          style={[styles.button, styles.danger]}
          onPress={confirmDelete}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, styles.dangerText]}>{t('settings.deleteData')}</Text>
        </Pressable>
      </Section>

      <Section title={t('settings.about')}>
        <Paragraph>{t('common.disclaimer')}</Paragraph>
        <Pressable onPress={() => setDevTaps((n) => n + 1)}>
          <Text style={[styles.version, text]}>
            {t('settings.version', { v: Constants.expoConfig?.version ?? '1.0.0' })}
          </Text>
        </Pressable>
      </Section>

      {devTaps >= 5 && (
        <Section title={`${t('settings.developer')} · ${t('settings.simulate')}`}>
          {location.simulated && (
            <Paragraph>{t('settings.simulating', { name: location.simulated.name })}</Paragraph>
          )}
          <View style={styles.chips}>
            <Chip label={t('settings.simulateOff')} onPress={() => setSimulated(null)} />
            {(districts.data ?? []).map((d) => (
              <Chip
                key={d.name}
                label={d.name}
                onPress={() =>
                  setSimulated({
                    name: d.name,
                    latitude: d.centroid_lat,
                    longitude: d.centroid_lon,
                  })
                }
              />
            ))}
          </View>
        </Section>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={onPress} accessibilityRole="button">
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 16, flex: 1 },
  button: {
    borderWidth: 2,
    borderColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: ACCENT },
  danger: { borderColor: '#b91c1c' },
  dangerText: { color: '#b91c1c' },
  version: { fontSize: 13, opacity: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#e0f2fe',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: '#0c4a6e' },
});
