import type { TFunction } from 'i18next';

const TZ = 'Asia/Kuala_Lumpur';

export function formatTime(iso: string, lang: 'en' | 'ms'): string {
  try {
    return new Date(iso).toLocaleString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
      timeZone: TZ,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function timeAgo(ms: number, t: TFunction, now: number): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 2) return t('common.justNow');
  if (minutes < 120) return t('common.minutesAgo', { count: minutes });
  return t('common.hoursAgo', { count: Math.round(minutes / 60) });
}

/** JPS hourly rainfall intensity bands (mm/h). */
export function rainBand(
  mm: number | null,
): 'none' | 'light' | 'moderate' | 'heavy' | 'very_heavy' {
  if (mm == null || mm < 1) return 'none';
  if (mm <= 10) return 'light';
  if (mm <= 30) return 'moderate';
  if (mm <= 60) return 'heavy';
  return 'very_heavy';
}

/** 24-hour totals use wider bands (monsoon rain can exceed several hundred mm a day). */
export function rain24Band(mm: number | null): ReturnType<typeof rainBand> {
  if (mm == null || mm < 1) return 'none';
  if (mm <= 20) return 'light';
  if (mm <= 60) return 'moderate';
  if (mm <= 100) return 'heavy';
  return 'very_heavy';
}

/**
 * Display-only: fan out markers that share a coordinate (e.g. stations placed at a district
 * centre until they are geocoded) into a small ring so each stays visible and tappable.
 */
export function spreadDuplicates<T extends { lat: number; lon: number }>(
  items: T[],
  radiusDeg = 0.012,
): T[] {
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    const key = `${it.lat.toFixed(4)},${it.lon.toFixed(4)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out = [...items];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    idx.forEach((i, k) => {
      const angle = (2 * Math.PI * k) / idx.length;
      const r = radiusDeg * (1 + Math.floor(k / 8) * 0.8);
      out[i] = {
        ...items[i]!,
        lat: items[i]!.lat + r * Math.sin(angle),
        lon: items[i]!.lon + r * Math.cos(angle),
      };
    });
  }
  return out;
}
