// Three swipes: what the app does → permissions (with the background-location explanation) → language.
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toggle } from '@/components/map/overlays';
import { setLanguage, useLang, type Language } from '@/i18n';
import { setupNotificationChannel } from '@/lib/device';
import { useApp } from '@/providers/app-provider';

const ACCENT = '#0E7490';

export default function Onboarding() {
  const { t, lang } = useLang();
  const { completeOnboarding, refreshPush } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [locationOk, setLocationOk] = useState(false);
  const [notifyOk, setNotifyOk] = useState(false);

  const goTo = (p: number) => {
    scroller.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };

  const askLocation = async () => {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    setLocationOk(granted);
  };
  const askNotifications = async () => {
    // Android 13+: a channel must exist before the permission prompt appears.
    await setupNotificationChannel().catch(() => {});
    const { granted } = await Notifications.requestPermissionsAsync();
    setNotifyOk(granted);
    await refreshPush();
  };

  const pages = [
    <View key="p1" style={[styles.page, { width }]}>
      <Text style={styles.emoji}>🌫️🌊🦠</Text>
      <Text style={styles.title}>{t('onboarding.p1Title')}</Text>
      <Text style={styles.body}>{t('onboarding.p1Body')}</Text>
      <Text style={styles.points}>{t('onboarding.p1Points')}</Text>
    </View>,
    <View key="p2" style={[styles.page, { width }]}>
      <Text style={styles.emoji}>📍🔔</Text>
      <Text style={styles.title}>{t('onboarding.p2Title')}</Text>
      <Text style={styles.body}>{t('onboarding.p2Body')}</Text>
      <Pressable
        style={[styles.button, locationOk && styles.done]}
        onPress={askLocation}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>
          {locationOk ? t('onboarding.granted') : t('onboarding.allowLocation')}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.button, notifyOk && styles.done]}
        onPress={askNotifications}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>
          {notifyOk ? t('onboarding.granted') : t('onboarding.allowNotifications')}
        </Text>
      </Pressable>
    </View>,
    <View key="p3" style={[styles.page, { width }]}>
      <Text style={styles.emoji}>🇲🇾</Text>
      <Text style={styles.title}>{t('onboarding.p3Title')}</Text>
      <Toggle<Language>
        options={[
          { value: 'en', label: 'English' },
          { value: 'ms', label: 'Bahasa Melayu' },
        ]}
        value={lang}
        onChange={(l) => void setLanguage(l)}
        accent={ACCENT}
      />
      <Text style={styles.body}>{t('onboarding.p3Body')}</Text>
      <Text style={styles.small}>{t('common.disclaimer')}</Text>
    </View>,
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {pages}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.dots}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Pressable
          style={styles.primary}
          accessibilityRole="button"
          onPress={() => (page < pages.length - 1 ? goTo(page + 1) : void completeOnboarding())}
        >
          <Text style={styles.primaryText}>
            {page < pages.length - 1 ? t('onboarding.next') : t('onboarding.start')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F0F9FF' },
  page: { paddingHorizontal: 28, justifyContent: 'center', gap: 16 },
  emoji: { fontSize: 48 },
  title: { fontSize: 28, fontWeight: '800', color: '#0C4A6E' },
  body: { fontSize: 17, lineHeight: 25, color: '#1f2937' },
  points: { fontSize: 17, lineHeight: 30, color: '#1f2937' },
  small: { fontSize: 13, color: '#4b5563' },
  button: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  done: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#0C4A6E' },
  footer: { paddingHorizontal: 28, gap: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#BAE6FD' },
  dotActive: { backgroundColor: ACCENT, width: 24 },
  primary: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  primaryText: { fontSize: 18, fontWeight: '800', color: '#fff' },
});
