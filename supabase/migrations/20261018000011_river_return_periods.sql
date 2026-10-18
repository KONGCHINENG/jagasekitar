-- GloFAS: judge forecast flow against each river's own return periods (from ~30 years of GloFAS
-- reanalysis), as GloFAS's own warnings do. A ratio to the recent median flagged every river at
-- the start of the monsoon, because the previous three months were the dry season.
alter table public.river_flow_forecasts
  add column rp2 real,                    -- m³/s reached in a typical year (2-year return period)
  add column rp5 real,
  add column rp20 real,
  add column record_years smallint,       -- years of record behind the thresholds
  add column exceeded smallint not null default 0;  -- highest return period the peak reaches: 0, 2, 5 or 20

comment on column public.river_flow_forecasts.ratio is 'peak / rp2 (or / baseline_median when rp2 is unknown)';
