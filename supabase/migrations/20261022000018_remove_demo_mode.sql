-- Demo mode (scenario replay) has been removed: drop its settings, flag and any leftover demo rows.

delete from public.settings where key in ('demo_mode', 'demo_runtime');

update public.settings
set value = value - 'demo_predictions_seconds'
where key = 'refresh_minutes';

delete from public.fire_hotspots where source = 'demo';
delete from public.rain_readings where raw ->> 'demo' = 'true';
delete from public.water_level_readings where raw ->> 'demo' = 'true';
delete from public.case_reports where notes = 'demo scenario' and submitted_by is null;

alter table public.prediction_runs drop column if exists demo;
