import { HAZARD_PALETTES } from '@jagasekitar/shared';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { restoreLanguage, useLang } from '@/i18n';
// Registers the background-location task at module load (required by TaskManager).
import '@/lib/background-location';
import { AppProvider, useApp } from '@/providers/app-provider';

SplashScreen.preventAutoHideAsync();

const hazardHeader = (color: string) => ({
  headerShown: true,
  headerStyle: { backgroundColor: color },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' as const },
});

function RootStack() {
  const { t } = useLang();
  const { onboarded } = useApp();

  useEffect(() => {
    if (onboarded !== null) void SplashScreen.hideAsync();
  }, [onboarded]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={onboarded === false}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={onboarded === true}>
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
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    void restoreLanguage();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppProvider>
        <RootStack />
      </AppProvider>
    </ThemeProvider>
  );
}
