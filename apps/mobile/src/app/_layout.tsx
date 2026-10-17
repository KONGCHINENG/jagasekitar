import { HAZARD_PALETTES } from '@jagasekitar/shared';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { restoreLanguage, useLang } from '@/i18n';

SplashScreen.preventAutoHideAsync();

const hazardHeader = (color: string) => ({
  headerShown: true,
  headerStyle: { backgroundColor: color },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' as const },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { t } = useLang();

  useEffect(() => {
    restoreLanguage().finally(() => SplashScreen.hideAsync());
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="haze"
          options={{ ...hazardHeader('#4B4453'), title: t('hazardMap.haze') }}
        />
        <Stack.Screen
          name="flood"
          options={{ ...hazardHeader(HAZARD_PALETTES.flood.base), title: t('hazardMap.flood') }}
        />
        <Stack.Screen
          name="illness"
          options={{ ...hazardHeader(HAZARD_PALETTES.disease.base), title: t('hazardMap.disease') }}
        />
        <Stack.Screen
          name="destination"
          options={{ presentation: 'modal', headerShown: true, title: t('home.search') }}
        />
      </Stack>
    </ThemeProvider>
  );
}
