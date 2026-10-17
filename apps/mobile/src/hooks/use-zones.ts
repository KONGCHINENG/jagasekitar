import type { Hazard } from '@jagasekitar/shared';
import { fetchZones, PENINSULA, type AppZone } from '@/lib/data';
import { useRemote } from './use-remote';

const FIVE_MIN = 5 * 60_000;

/**
 * Active zones within the map area (Peninsular Malaysia + the Strait), optionally for one hazard
 * and at a future time (haze time slider). Cached for offline use.
 */
export function useZones(hazard?: Hazard, hoursAhead = 0) {
  return useRemote<AppZone[]>(
    `zones:${hazard ?? 'all'}:+${hoursAhead}h`,
    () => fetchZones(PENINSULA, new Date(Date.now() + hoursAhead * 3600_000), hazard),
    { refreshMs: FIVE_MIN },
  );
}
