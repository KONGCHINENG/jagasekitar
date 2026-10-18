-- JagaSekitar seed data. Idempotent: safe to run more than once.
-- Stations come from seed/stations.sql (generated from seed/stations_perak.csv).
-- Demo accounts are created by `npm run seed:accounts` (needs the service role key).
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Perak districts. Population: approximate 2020 census figures (DOSM), adjusted for
-- the Bagan Datuk (from Hilir Perak) and Muallim (from Batang Padang) splits.
-- Centroids are approximate district-seat coordinates; polygons are loaded
-- separately by `npm run seed:districts` (geoBoundaries ADM2).
-- ---------------------------------------------------------------------------
insert into public.districts (state, name, population, centroid) values
  ('PRK', 'Bagan Datuk',             70000, st_setsrid(st_makepoint(100.7850, 3.9890), 4326)::geography),
  ('PRK', 'Batang Padang',          130000, st_setsrid(st_makepoint(101.2610, 4.1980), 4326)::geography),
  ('PRK', 'Hilir Perak',            135000, st_setsrid(st_makepoint(101.0210, 4.0250), 4326)::geography),
  ('PRK', 'Hulu Perak',              97000, st_setsrid(st_makepoint(101.1270, 5.4290), 4326)::geography),
  ('PRK', 'Kampar',                 105000, st_setsrid(st_makepoint(101.1530, 4.3080), 4326)::geography),
  ('PRK', 'Kerian',                 190000, st_setsrid(st_makepoint(100.5420, 5.0100), 4326)::geography),
  ('PRK', 'Kuala Kangsar',          165000, st_setsrid(st_makepoint(100.9370, 4.7720), 4326)::geography),
  ('PRK', 'Kinta',                  840000, st_setsrid(st_makepoint(101.0900, 4.5970), 4326)::geography),
  ('PRK', 'Larut Matang dan Selama',355000, st_setsrid(st_makepoint(100.7410, 4.8510), 4326)::geography),
  ('PRK', 'Manjung',                250000, st_setsrid(st_makepoint(100.6620, 4.2120), 4326)::geography),
  ('PRK', 'Muallim',                 75000, st_setsrid(st_makepoint(101.5180, 3.6850), 4326)::geography),
  ('PRK', 'Perak Tengah',           100000, st_setsrid(st_makepoint(100.9810, 4.3620), 4326)::geography)
on conflict (state, name) do update
  set population = excluded.population, centroid = excluded.centroid;

-- ---------------------------------------------------------------------------
-- Disease types (admin-editable)
-- ---------------------------------------------------------------------------
insert into public.disease_types (code, name_en, name_ms, category) values
  ('DENGUE',  'Dengue',                       'Denggi',                             'vector'),
  ('LEPTO',   'Leptospirosis',                'Leptospirosis',                      'water'),
  ('CHOLERA', 'Cholera',                      'Taun',                               'water'),
  ('TYPHOID', 'Typhoid',                      'Kepialu',                            'water'),
  ('HFMD',    'Hand-Foot-Mouth (HFMD)',       'Penyakit Tangan, Kaki dan Mulut',    'contact'),
  ('ILI',     'Influenza-like illness',       'Penyakit seperti influenza',         'respiratory'),
  ('ARI',     'Acute respiratory infection',  'Jangkitan saluran pernafasan akut',  'respiratory'),
  ('CONJ',    'Conjunctivitis',               'Konjunktivitis',                     'contact'),
  ('DIARR',   'Diarrhoeal disease',           'Penyakit cirit-birit',               'water'),
  ('COVID19', 'COVID-19',                     'COVID-19',                           'respiratory')
on conflict (code) do update
  set name_en = excluded.name_en, name_ms = excluded.name_ms, category = excluded.category;

-- ---------------------------------------------------------------------------
-- Sample facilities in Perak. Coordinates are approximate; admins can correct them.
-- ---------------------------------------------------------------------------
insert into public.facilities (name, type, state, district, location, verified) values
  ('Hospital Raja Permaisuri Bainun', 'hospital', 'PRK', 'Kinta',                   st_setsrid(st_makepoint(101.0905, 4.6040), 4326)::geography, true),
  ('Hospital Teluk Intan',            'hospital', 'PRK', 'Hilir Perak',             st_setsrid(st_makepoint(101.0270, 4.0210), 4326)::geography, true),
  ('Hospital Seri Manjung',           'hospital', 'PRK', 'Manjung',                 st_setsrid(st_makepoint(100.6600, 4.2070), 4326)::geography, true),
  ('Hospital Taiping',                'hospital', 'PRK', 'Larut Matang dan Selama', st_setsrid(st_makepoint(100.7380, 4.8560), 4326)::geography, true),
  ('Hospital Parit Buntar',           'hospital', 'PRK', 'Kerian',                  st_setsrid(st_makepoint(100.4930, 5.1200), 4326)::geography, true),
  ('Hospital Kuala Kangsar',          'hospital', 'PRK', 'Kuala Kangsar',           st_setsrid(st_makepoint(100.9380, 4.7720), 4326)::geography, true),
  ('Hospital Slim River',             'hospital', 'PRK', 'Muallim',                 st_setsrid(st_makepoint(101.4000, 3.8250), 4326)::geography, true),
  ('Klinik Kesihatan Greentown',      'clinic',   'PRK', 'Kinta',                   st_setsrid(st_makepoint(101.0880, 4.5960), 4326)::geography, true),
  ('Klinik Kesihatan Kampar',         'clinic',   'PRK', 'Kampar',                  st_setsrid(st_makepoint(101.1530, 4.3050), 4326)::geography, true),
  ('Klinik Kesihatan Bagan Serai',    'clinic',   'PRK', 'Kerian',                  st_setsrid(st_makepoint(100.5400, 5.0100), 4326)::geography, true),
  ('Klinik Kesihatan Lumut',          'clinic',   'PRK', 'Manjung',                 st_setsrid(st_makepoint(100.6300, 4.2330), 4326)::geography, true),
  ('Klinik Kesihatan Gerik',          'clinic',   'PRK', 'Hulu Perak',              st_setsrid(st_makepoint(101.1280, 5.4280), 4326)::geography, true)
on conflict (name, district) do nothing;

-- ---------------------------------------------------------------------------
-- Settings: every engine threshold is admin-configurable (Sections 4 and 8).
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, description) values
  ('demo_mode', '{"enabled": false, "scenario": null, "speed": 1, "started_at": null}',
    'Replay seeded scenarios instead of live data'),
  ('refresh_minutes', '{"firms": 180, "open_meteo": 60, "open_meteo_aq": 60, "infobanjir_rain": 15, "infobanjir_water_level": 15, "infobanjir_alerts": 15, "demo_predictions_seconds": 30}',
    'Data source and prediction refresh intervals'),
  ('haze', '{
      "cluster_radius_km": 10,
      "min_confidence": "n",
      "trajectory_hours": 72,
      "step_hours": 1,
      "wind_blend_850": 0.7,
      "spread_kmh": 5,
      "max_half_width_km": 150,
      "grid_km": 5,
      "time_slices_h": [0, 12, 24, 48, 72],
      "score_thresholds": {"low": 0.5, "moderate": 2, "high": 5, "severe": 10},
      "pm25_bands": {"good": 15, "moderate": 35, "unhealthy": 55, "very_unhealthy": 150}
    }', 'Haze engine parameters'),
  ('flood', '{
      "hourly_bands_mm": {"light": 1, "moderate": 11, "heavy": 31, "very_heavy": 61},
      "severe_3h_mm": 60,
      "high_3h_mm": 60,
      "high_forecast_24h_mm": 100,
      "high_cumulative_3d_mm": 150,
      "buffer_km": {"low": 3, "moderate": 4, "high": 6, "severe": 8},
      "official_alert_min_level": "high",
      "river_flow_levels": {"rp2": "moderate", "rp5": "high", "rp20": "high"},
      "river_flow_min_rp2": 2
    }', 'Flood engine rules'),
  ('disease', '{
      "outbreak_min_count": 5,
      "outbreak_ratio": 2,
      "flood_linked": ["LEPTO", "CHOLERA", "TYPHOID", "DIARR", "DENGUE"],
      "haze_linked": ["ARI", "CONJ"],
      "spike_warning_multiplier": 5,
      "edit_window_hours": 48
    }', 'Disease engine thresholds and hazard linkage'),
  ('notifications', '{"dedupe_hours": 6, "batch_size": 100, "quiet_hours_bypass_level": "severe"}',
    'Push notification behaviour'),
  ('stale_data_minutes', '120', 'Show a stale-data warning after this many minutes')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Data source registry (health shown on the admin overview)
-- ---------------------------------------------------------------------------
insert into public.data_source_status (source, refresh_minutes) values
  ('firms', 180),
  ('open_meteo', 60),
  ('open_meteo_aq', 60),
  ('infobanjir_rain', 15),
  ('infobanjir_water_level', 15),
  ('infobanjir_alerts', 15)
on conflict (source) do nothing;
