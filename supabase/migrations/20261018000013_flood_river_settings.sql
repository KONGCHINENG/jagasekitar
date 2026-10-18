-- Make the GloFAS rules admin-editable (Admin → Thresholds → flood). Values match the engine
-- defaults; existing installs get the keys added without touching anything already tuned.
update public.settings
set value = value || '{
  "river_flow_levels": {"rp2": "moderate", "rp5": "high", "rp20": "high"},
  "river_flow_min_rp2": 2
}'::jsonb
where key = 'flood' and not (value ? 'river_flow_levels');
