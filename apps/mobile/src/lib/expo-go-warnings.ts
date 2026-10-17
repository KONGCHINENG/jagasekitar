// expo-notifications warns on every load in Expo Go that remote push is unavailable. We know: in
// Expo Go alerts arrive in-app over Realtime (see README "Notifications"), so these two messages are
// noise. Drop only them, only in Expo Go; every other warning still shows. Imported first by index.ts.
import { isRunningInExpoGo } from 'expo';

const KNOWN = [
  'Push notifications (remote notifications) are unavailable in Expo Go',
  '`expo-notifications` functionality is not fully supported in Expo Go',
];

if (isRunningInExpoGo()) {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (KNOWN.some((k) => text.includes(k))) return;
    warn(...args);
  };
}
