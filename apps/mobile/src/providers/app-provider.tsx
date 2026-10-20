// App-wide state: onboarding, anonymous session, device registration, location (real or
// simulated for demos), alert preferences, push/in-app delivery and notification deep links.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HAZARDS, type Hazard } from '@jagasekitar/shared';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { parseVisibleHazards, VISIBLE_HAZARDS_KEY } from '@/lib/hazards';
import { useUserLocation, type LocationStatus } from '@/hooks/use-user-location';
import { useLang } from '@/i18n';
import {
  DEFAULT_PREFS,
  ONBOARDED_KEY,
  ensureSession,
  getPushToken,
  loadPrefs,
  registerDevice,
  savePrefs,
  setupNotificationChannel,
  type AlertPrefs,
  type PushStatus,
} from '@/lib/device';
import { supabase } from '@/lib/supabase';

const SIMULATED_KEY = 'jagasekitar:simulated-location';

// Show alerts as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface SimulatedLocation {
  name: string;
  latitude: number;
  longitude: number;
}

interface AppContextValue {
  onboarded: boolean | null; // null while loading
  completeOnboarding: () => Promise<void>;
  userId: string | null;
  deviceId: string | null;
  location: {
    coords: { latitude: number; longitude: number };
    status: LocationStatus;
    simulated: SimulatedLocation | null;
  };
  setSimulated: (s: SimulatedLocation | null) => void;
  prefs: AlertPrefs;
  setPrefs: (p: AlertPrefs) => void;
  /** Hazards the user chose to see (Settings → Hazards to show); never empty. */
  visibleHazards: Hazard[];
  setVisibleHazards: (h: Hazard[]) => void;
  pushStatus: PushStatus;
  /** Expo push token of this install, when push is available. */
  pushToken: string | null;
  refreshPush: () => Promise<void>;
  error: string | null;
  resetAll: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

type LinkData = { screen?: string; lat?: number; lon?: number; notificationId?: string };

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { lang } = useLang();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<AlertPrefs>(DEFAULT_PREFS);
  const [simulated, setSimulatedState] = useState<SimulatedLocation | null>(null);
  const [visibleHazards, setVisibleHazardsState] = useState<Hazard[]>([...HAZARDS]);
  const [push, setPush] = useState<{ token: string | null; status: PushStatus }>({
    token: null,
    status: 'denied',
  });
  const [error, setError] = useState<string | null>(null);
  const [foregroundTick, setForegroundTick] = useState(0);
  const real = useUserLocation(onboarded === true);

  // Load local state.
  useEffect(() => {
    (async () => {
      const [flag, loaded, sim, shown] = await Promise.all([
        AsyncStorage.getItem(ONBOARDED_KEY).catch(() => null),
        loadPrefs(),
        AsyncStorage.getItem(SIMULATED_KEY).catch(() => null),
        AsyncStorage.getItem(VISIBLE_HAZARDS_KEY).catch(() => null),
      ]);
      setPrefsState(loaded);
      setVisibleHazardsState(parseVisibleHazards(shown));
      if (sim) setSimulatedState(JSON.parse(sim) as SimulatedLocation);
      setOnboarded(flag === '1');
    })();
  }, []);

  // Anonymous session once onboarded.
  useEffect(() => {
    if (onboarded !== true) return;
    ensureSession()
      .then(setUserId)
      .catch((e: Error) => setError(e.message));
  }, [onboarded]);

  const refreshPush = useCallback(async () => {
    await setupNotificationChannel().catch(() => {});
    setPush(await getPushToken());
  }, []);
  useEffect(() => {
    if (onboarded !== true) return;
    setupNotificationChannel()
      .catch(() => {})
      .then(getPushToken)
      .then(setPush)
      .catch(() => {});
  }, [onboarded]);

  // Re-register when the app comes back to the foreground (keeps last_seen_at fresh).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setForegroundTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const coords = simulated ?? real.coords;
  // Round to ~100 m so small GPS jitter doesn't trigger a write.
  const latKey = coords.latitude.toFixed(3);
  const lonKey = coords.longitude.toFixed(3);
  useEffect(() => {
    if (!userId || (real.status === 'locating' && !simulated)) return;
    registerDevice(userId, {
      lat: Number(latKey),
      lon: Number(lonKey),
      token: push.token,
      prefs,
      language: lang,
    })
      .then((id) => {
        setDeviceId(id);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [userId, latKey, lonKey, push.token, prefs, lang, real.status, simulated, foregroundTick]);

  // In-app alerts: new rows for this user that weren't delivered by push → local notification.
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            title: string;
            body: string;
            delivery: string;
            data: LinkData;
          };
          if (row.delivery !== 'in_app') return;
          void Notifications.scheduleNotificationAsync({
            content: {
              title: row.title,
              body: row.body,
              data: { ...row.data, notificationId: row.id },
            },
            trigger: null,
          });
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [userId]);

  // Tapping an alert opens the hazard map centred on the zone.
  const openFromNotification = useRef((data: LinkData) => {
    if (!data?.screen) return;
    if (data.notificationId && supabase) {
      void supabase
        .from('notifications')
        .update({ opened_at: new Date().toISOString() })
        .eq('id', data.notificationId);
    }
    router.push({
      pathname: data.screen as '/haze',
      params: { lat: String(data.lat ?? ''), lon: String(data.lon ?? '') },
    });
  });
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      openFromNotification.current(r.notification.request.content.data as LinkData),
    );
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) openFromNotification.current(r.notification.request.content.data as LinkData);
    });
    return () => sub.remove();
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      onboarded,
      completeOnboarding: async () => {
        await AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => {});
        setOnboarded(true);
      },
      userId,
      deviceId,
      location: { coords, status: simulated ? 'granted' : real.status, simulated },
      setSimulated: (s) => {
        setSimulatedState(s);
        if (s) void AsyncStorage.setItem(SIMULATED_KEY, JSON.stringify(s)).catch(() => {});
        else void AsyncStorage.removeItem(SIMULATED_KEY).catch(() => {});
      },
      prefs,
      setPrefs: (p) => {
        setPrefsState(p);
        void savePrefs(p);
      },
      visibleHazards,
      setVisibleHazards: (h) => {
        const clean = parseVisibleHazards(JSON.stringify(h));
        setVisibleHazardsState(clean);
        void AsyncStorage.setItem(VISIBLE_HAZARDS_KEY, JSON.stringify(clean)).catch(() => {});
      },
      pushStatus: push.status,
      pushToken: push.token,
      refreshPush,
      error,
      resetAll: async () => {
        // "Delete my data": server rows, session, then everything stored on the phone.
        if (supabase) {
          await supabase.rpc('delete_my_data');
          await supabase.auth.signOut();
        }
        await AsyncStorage.clear().catch(() => {});
        setUserId(null);
        setDeviceId(null);
        setPrefsState(DEFAULT_PREFS);
        setSimulatedState(null);
        setVisibleHazardsState([...HAZARDS]);
        setOnboarded(false);
      },
    }),
    [
      onboarded,
      userId,
      deviceId,
      coords,
      simulated,
      real.status,
      prefs,
      visibleHazards,
      push.status,
      push.token,
      refreshPush,
      error,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
