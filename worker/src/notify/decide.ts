// Pure notification rules (Section 7). No I/O, so every rule is unit-tested.
import { RISK_LABELS, atLeast, riskRank, type Hazard, type RiskLevel } from '@jagasekitar/shared';

export interface Candidate {
  device_id: string;
  user_id: string;
  expo_push_token: string | null;
  language: 'en' | 'ms';
  min_level: RiskLevel;
  quiet_start: string | null; // "22:00:00"
  quiet_end: string | null;
  notify_haze: boolean;
  notify_flood: boolean;
  notify_disease: boolean;
  place_id: string | null;
  place_label: string | null;
  zone_id: string;
  zone_key: string | null;
  hazard: Hazard;
  level: RiskLevel;
  valid_from: string;
  district: string | null;
  reason_en: string;
  reason_ms: string | null;
  lat: number;
  lon: number;
}

export interface RecentNotification {
  device_id: string;
  hazard: Hazard | null;
  level: RiskLevel;
  place_id: string | null;
  sent_at: string;
}

export interface NotifyRules {
  now: Date;
  dedupeHours: number;
  quietBypassLevel: RiskLevel;
}

export interface Decision {
  candidate: Candidate;
  reason: 'new' | 'upgraded';
}

const MYT_OFFSET_MIN = 8 * 60;

/** Minutes since midnight in Malaysia time. */
export function malaysiaMinutes(d: Date): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + MYT_OFFSET_MIN) % 1440;
}

const toMinutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** True if `now` falls in [start, end), handling windows that cross midnight (22:00–07:00). */
export function inQuietHours(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const t = malaysiaMinutes(now);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

const wants = (c: Candidate) =>
  (c.hazard === 'haze' && c.notify_haze) ||
  (c.hazard === 'flood' && c.notify_flood) ||
  (c.hazard === 'disease' && c.notify_disease);

/** Where the alert is about: a saved place, or "where the phone is". */
const targetKey = (placeId: string | null) => placeId ?? 'here';

export function decideNotifications(
  candidates: Candidate[],
  recent: RecentNotification[],
  rules: NotifyRules,
): Decision[] {
  const cutoff = rules.now.getTime() - rules.dedupeHours * 3600_000;

  // Best candidate per device × hazard × target: highest level, then soonest, then "here" first.
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!wants(c) || !atLeast(c.level, c.min_level)) continue;
    const key = `${c.device_id}|${c.hazard}|${targetKey(c.place_id)}`;
    const cur = best.get(key);
    if (
      !cur ||
      riskRank(c.level) > riskRank(cur.level) ||
      (c.level === cur.level && Date.parse(c.valid_from) < Date.parse(cur.valid_from))
    ) {
      best.set(key, c);
    }
  }

  // Never more than one alert per device × hazard per run: the most severe target wins.
  const perHazard = new Map<string, Candidate>();
  for (const c of best.values()) {
    const key = `${c.device_id}|${c.hazard}`;
    const cur = perHazard.get(key);
    if (
      !cur ||
      riskRank(c.level) > riskRank(cur.level) ||
      (c.level === cur.level && c.place_id === null)
    ) {
      perHazard.set(key, c);
    }
  }

  const out: Decision[] = [];
  for (const c of perHazard.values()) {
    const previous = recent.filter(
      (r) =>
        r.device_id === c.device_id &&
        r.hazard === c.hazard &&
        targetKey(r.place_id) === targetKey(c.place_id) &&
        Date.parse(r.sent_at) >= cutoff,
    );
    const maxPrevious = previous.reduce((m, r) => Math.max(m, riskRank(r.level)), -1);
    // Same or lower level already sent recently: skip. A higher level always goes out.
    if (maxPrevious >= riskRank(c.level)) continue;
    if (
      inQuietHours(rules.now, c.quiet_start, c.quiet_end) &&
      !atLeast(c.level, rules.quietBypassLevel)
    )
      continue;
    out.push({ candidate: c, reason: maxPrevious >= 0 ? 'upgraded' : 'new' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Message text
// ---------------------------------------------------------------------------
export interface Message {
  title: string;
  body: string;
}

export function composeMessage(c: Candidate, now: Date): Message {
  const ms = c.language === 'ms';
  const level = RISK_LABELS[c.level][ms ? 'ms' : 'en'];
  const place = c.place_label ?? c.district ?? (ms ? 'kawasan anda' : 'your area');
  const reason = (ms ? c.reason_ms : null) ?? c.reason_en;
  const hoursAway = Math.round((Date.parse(c.valid_from) - now.getTime()) / 3600_000);

  if (c.hazard === 'haze') {
    const title =
      hoursAway >= 1
        ? ms
          ? `🌫️ Jerebu dijangka di ${place} dalam ${hoursAway} jam (${level})`
          : `🌫️ Haze expected in ${place} within ${hoursAway} hours (${level})`
        : ms
          ? `🌫️ Jerebu di ${place} sekarang (${level})`
          : `🌫️ Haze over ${place} now (${level})`;
    const tip = ms ? 'Sediakan pelitup N95.' : 'Keep N95 masks ready.';
    return { title, body: `${reason} ${tip}` };
  }
  if (c.hazard === 'flood') {
    return {
      title: ms
        ? `🌊 Risiko banjir ${level.toUpperCase()} berhampiran ${place}`
        : `🌊 Flood risk ${level.toUpperCase()} near ${place}`,
      body: reason,
    };
  }
  return {
    title: ms
      ? `🦠 Amaran kesihatan di ${c.district ?? place} (${level})`
      : `🦠 Health alert in ${c.district ?? place} (${level})`,
    body: reason,
  };
}

/** Screen to open when the notification is tapped. */
export function deepLinkFor(c: Candidate): {
  screen: '/haze' | '/flood' | '/illness';
  lat: number;
  lon: number;
} {
  const screen = c.hazard === 'haze' ? '/haze' : c.hazard === 'flood' ? '/flood' : '/illness';
  return { screen, lat: c.lat, lon: c.lon };
}
