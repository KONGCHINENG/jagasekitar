import { describe, expect, it } from 'vitest';
import { DEFAULT_DISEASE, DEFAULT_FLOOD, DEFAULT_HAZE, fromSettings } from './config';

// Shapes copied from supabase/seed.sql: if a key is renamed there, admin edits would silently
// stop reaching the engines, so these must keep mapping.
const SEED = {
  haze: {
    cluster_radius_km: 12,
    wind_blend_850: 0.6,
    time_slices_h: [0, 24],
    score_thresholds: { low: 1, moderate: 3, high: 6, severe: 12 },
    step_hours: 1,
  },
  flood: {
    high_3h_mm: 55,
    severe_3h_mm: 70,
    high_forecast_24h_mm: 90,
    high_cumulative_3d_mm: 140,
    buffer_km: { low: 2, moderate: 3, high: 5, severe: 7 },
    official_alert_min_level: 'moderate',
  },
  disease: {
    outbreak_min_count: 3,
    outbreak_ratio: 1.5,
    flood_linked: ['LEPTO'],
    spike_warning_multiplier: 5,
  },
};

describe('fromSettings', () => {
  it('maps snake_case settings onto engine config', () => {
    const haze = fromSettings(DEFAULT_HAZE, SEED.haze);
    expect(haze).toMatchObject({
      clusterRadiusKm: 12,
      windBlend850: 0.6,
      timeSlicesH: [0, 24],
      scoreThresholds: { low: 1 },
    });
    const flood = fromSettings(DEFAULT_FLOOD, SEED.flood);
    expect(flood).toMatchObject({
      high3hMm: 55,
      severe3hMm: 70,
      highForecast24hMm: 90,
      highCumulative3dMm: 140,
      officialAlertMinLevel: 'moderate',
    });
    const disease = fromSettings(DEFAULT_DISEASE, SEED.disease);
    expect(disease).toMatchObject({
      outbreakMinCount: 3,
      outbreakRatio: 1.5,
      floodLinked: ['LEPTO'],
    });
  });

  it('ignores unknown keys and keeps defaults for missing ones', () => {
    const haze = fromSettings(DEFAULT_HAZE, SEED.haze);
    expect(haze).not.toHaveProperty('stepHours');
    expect(haze.decayHours).toBe(DEFAULT_HAZE.decayHours);
    expect(fromSettings(DEFAULT_FLOOD, null)).toBe(DEFAULT_FLOOD);
  });
});
