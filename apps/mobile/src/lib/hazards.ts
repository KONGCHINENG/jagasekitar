// Every hazard the app knows about, in display order. Users pick which ones to see in
// Settings → "Hazards to show".
//
// Adding a hazard (e.g. earthquake): add it to HAZARDS in @jagasekitar/shared and the database's
// hazard_type, build its data source and engine, give it a map screen, then set `available: true`
// here. Until then it is listed in Settings as "Coming soon".
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { HAZARDS, type Hazard } from '@jagasekitar/shared';
import type { ComponentProps } from 'react';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type FutureHazard = 'earthquake' | 'tsunami' | 'landslide';

export type HazardOption =
  | { id: Hazard; available: true; glyph: Glyph }
  | { id: FutureHazard; available: false; glyph: Glyph };

export const HAZARD_OPTIONS: HazardOption[] = [
  { id: 'haze', available: true, glyph: 'weather-fog' },
  { id: 'flood', available: true, glyph: 'waves' },
  { id: 'disease', available: true, glyph: 'virus-outline' },
  { id: 'earthquake', available: false, glyph: 'pulse' },
  { id: 'tsunami', available: false, glyph: 'tsunami' },
  { id: 'landslide', available: false, glyph: 'landslide' },
];

export const HAZARD_GLYPHS = Object.fromEntries(
  HAZARD_OPTIONS.map((o) => [o.id, o.glyph]),
) as Record<Hazard | FutureHazard, Glyph>;

export const VISIBLE_HAZARDS_KEY = 'jagasekitar:visible-hazards';

/** A saved choice, cleaned: known hazards only, in display order, never empty. */
export function parseVisibleHazards(raw: string | null): Hazard[] {
  try {
    const saved = JSON.parse(raw ?? 'null') as unknown;
    if (Array.isArray(saved)) {
      const picked = HAZARDS.filter((h) => saved.includes(h));
      if (picked.length) return picked;
    }
  } catch {
    // Fall through to the default.
  }
  return [...HAZARDS];
}
