import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './en';
import ms from './ms';

export type Language = 'en' | 'ms';
const STORAGE_KEY = 'jagasekitar:language';

const deviceLanguage = (): Language => (getLocales()[0]?.languageCode === 'ms' ? 'ms' : 'en');

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ms: { translation: ms } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Apply the language the user picked last time (falls back to the device language). */
export async function restoreLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ms') await i18n.changeLanguage(saved);
  } catch {
    // Storage unavailable: keep the device language.
  }
}

export async function setLanguage(lang: Language): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not persisted; still applied for this session.
  }
}

/** Current language plus a picker for bilingual DB fields (reason_en / reason_ms). */
export function useLang() {
  const { t, i18n: instance } = useTranslation();
  const lang: Language = instance.language === 'ms' ? 'ms' : 'en';
  const pick = <T>(en: T, msValue: T | null | undefined): T =>
    lang === 'ms' && msValue ? msValue : en;
  return { t, lang, pick };
}

export default i18n;
