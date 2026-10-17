// Fetch with an offline cache: shows the last saved copy immediately, refreshes in the background,
// and keeps the saved copy (flagged) if the network fails.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Cached<T> {
  data: T;
  savedAt: number;
}

export interface RemoteState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** When the shown data was fetched (ms). */
  updatedAt: number | null;
  /** True when showing the saved copy because the network failed (or hasn't answered yet). */
  fromCache: boolean;
  reload: () => void;
}

export function useRemote<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { refreshMs?: number } = {},
): RemoteState<T> {
  const [state, setState] = useState<Omit<RemoteState<T>, 'reload'>>({
    data: undefined,
    error: null,
    loading: key != null,
    updatedAt: null,
    fromCache: false,
  });
  const fetcherRef = useRef(fetcher);
  // Declared before the fetch effect, so it runs first in the same commit.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (key == null) return;
    let cancelled = false;
    const storageKey = `cache:${key}`;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw && !cancelled) {
          const saved = JSON.parse(raw) as Cached<T>;
          setState((s) =>
            s.data === undefined
              ? { ...s, data: saved.data, updatedAt: saved.savedAt, fromCache: true }
              : s,
          );
        }
      } catch {
        // No cache available.
      }
      try {
        const data = await fetcherRef.current();
        if (cancelled) return;
        const savedAt = Date.now();
        setState({ data, error: null, loading: false, updatedAt: savedAt, fromCache: false });
        AsyncStorage.setItem(
          storageKey,
          JSON.stringify({ data, savedAt } satisfies Cached<T>),
        ).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    const timer = opts.refreshMs ? setInterval(() => setNonce((n) => n + 1), opts.refreshMs) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [key, nonce, opts.refreshMs]);

  return { ...state, reload };
}
