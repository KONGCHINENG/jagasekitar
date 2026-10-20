-- Calibration from past events (Admin → Calibration).
--  * flood_events: real past floods (district + dates + source), entered or confirmed by admins.
--    Only verified rows are used for scoring.
--  * calibration_runs: results of replaying history through the flood rules (worker
--    `src/calibrate`), with the suggested thresholds an admin can apply.
set search_path = public, extensions;

create table public.flood_events (
  id uuid primary key default gen_random_uuid(),
  state text not null default 'PRK',
  district text not null,
  start_date date not null,
  end_date date not null,
  description text,
  source_url text,
  verified boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index flood_events_district_idx on public.flood_events (state, district, start_date);

create table public.calibration_runs (
  id uuid primary key default gen_random_uuid(),
  hazard public.hazard_type not null default 'flood',
  created_at timestamptz not null default now(),
  period_from date not null,
  period_to date not null,
  events_used integer not null,
  district_days integer not null,
  -- { "params": {...}, "metrics": {...} } for the thresholds in use and the best ones found
  current jsonb not null,
  suggested jsonb not null,
  -- best-scoring parameter sets, and other checks (e.g. GloFAS 5-year flow as truth)
  details jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  applied_by uuid references auth.users (id)
);

alter table public.flood_events enable row level security;
alter table public.calibration_runs enable row level security;
create policy admin_all on public.flood_events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.calibration_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create trigger audit_changes after insert or update or delete on public.flood_events
  for each row execute function public.audit_changes();
create trigger audit_changes after insert or update or delete on public.calibration_runs
  for each row execute function public.audit_changes();

-- Draft events from public news reports (2026-10-21). Unverified until an admin checks each
-- source; dates are approximate (first and last report of evacuees).
insert into public.flood_events (district, start_date, end_date, description, source_url) values
  ('Kuala Kangsar', '2014-12-22', '2014-12-31', 'Dec 2014 floods: 5,065 evacuees in Perak, most in Kuala Kangsar', 'https://www.bharian.com.my/amp/berita/nasional/2014/12/25258/bhplus'),
  ('Hulu Perak', '2014-12-22', '2014-12-31', 'Dec 2014 floods (relief centres in Hulu Perak)', 'https://www.bharian.com.my/amp/berita/nasional/2014/12/25258/bhplus'),
  ('Perak Tengah', '2014-12-22', '2014-12-31', 'Dec 2014 floods (relief centres in Perak Tengah)', 'https://www.bharian.com.my/amp/berita/nasional/2014/12/25258/bhplus'),
  ('Kerian', '2017-11-20', '2017-12-05', 'Nov 2017 floods: Kerian highest, 259 victims at two PPS', 'https://www.ipohecho.com.my/?p=31495'),
  ('Manjung', '2017-11-29', '2017-12-05', 'Over 400 evacuated in Manjung and Muallim', 'https://www.malaymail.com/amp/news/malaysia/2017/11/30/hundreds-evacuated-as-floods-worsen-in-perak/1521857'),
  ('Muallim', '2017-11-29', '2017-12-05', 'Over 400 evacuated in Manjung and Muallim', 'https://www.malaymail.com/amp/news/malaysia/2017/11/30/hundreds-evacuated-as-floods-worsen-in-perak/1521857'),
  ('Kerian', '2019-11-01', '2019-11-04', '277 evacuees in Kerian (SK Changkat Lobak, SK Parit Haji Aman)', 'https://www.malaymail.com/news/malaysia/2019/11/03/flood-evacuees-in-perak-remain-at-512/1806396'),
  ('Hilir Perak', '2019-11-01', '2019-11-04', '153 evacuees in Hilir Perak (SK Changkat Jong)', 'https://www.malaymail.com/news/malaysia/2019/11/03/flood-evacuees-in-perak-remain-at-512/1806396'),
  ('Kuala Kangsar', '2021-09-27', '2021-09-28', 'Flooding in Kuala Kangsar, 83 displaced', 'https://reliefweb.int/report/malaysia/malaysia-flooding-kuala-kangsar-perak-baling-and-sik-kedah-27-sep-2021'),
  ('Hilir Perak', '2023-10-24', '2023-10-28', 'Oct 2023 floods: Hilir Perak and Kerian, 245 evacuees', 'https://www.thestar.com.my/news/nation/2023/10/25/perak-floods-245-evacuees-now-in-relief-centres'),
  ('Kerian', '2023-10-24', '2023-10-28', 'Oct 2023 floods: Hilir Perak and Kerian, 245 evacuees', 'https://www.thestar.com.my/news/nation/2023/10/25/perak-floods-245-evacuees-now-in-relief-centres'),
  ('Hulu Perak', '2023-10-27', '2023-10-28', 'Relief centre open in Hulu Perak', 'https://www.malaymail.com/news/malaysia/2023/10/28/number-of-flood-evacuees-in-perak-drops-to-263-this-morning/98825'),
  ('Kuala Kangsar', '2024-10-13', '2024-10-16', 'Oct 2024: 691 victims in Kuala Kangsar', 'https://www.malaymail.com/news/malaysia/2024/10/14/floods-in-pahang-perak-worsen/153631'),
  ('Kerian', '2024-10-13', '2024-10-16', 'Oct 2024: 104 victims in Kerian', 'https://www.malaymail.com/news/malaysia/2024/10/14/floods-in-pahang-perak-worsen/153631'),
  ('Kerian', '2025-10-23', '2025-10-25', 'Oct 2025: Kerian newly affected', 'https://www.tvsarawak.my/2025/10/24/4252-flood-victims-relocated-to-relief-centres-in-perak-kedah-penang/'),
  ('Perak Tengah', '2025-10-23', '2025-10-25', 'Oct 2025: Perak Tengah newly affected', 'https://www.tvsarawak.my/2025/10/24/4252-flood-victims-relocated-to-relief-centres-in-perak-kedah-penang/'),
  ('Hilir Perak', '2025-11-27', '2025-12-07', 'Nov-Dec 2025: Hilir Perak highest (1,961 evacuees on 30 Nov)', 'https://www.nst.com.my/amp/news/nation/2025/11/1326807/flood-evacuee-numbers-climb-perak-pahang-and-selangor'),
  ('Perak Tengah', '2025-11-27', '2025-12-04', 'Nov-Dec 2025: 1,254 evacuees in Perak Tengah', 'https://www.nst.com.my/amp/news/nation/2025/11/1326807/flood-evacuee-numbers-climb-perak-pahang-and-selangor'),
  ('Bagan Datuk', '2025-11-27', '2025-12-07', 'Nov-Dec 2025: 861 evacuees in Bagan Datuk', 'https://www.nst.com.my/amp/news/nation/2025/11/1326807/flood-evacuee-numbers-climb-perak-pahang-and-selangor'),
  ('Larut Matang dan Selama', '2026-10-14', '2026-10-18', 'Oct 2026 storm and floods: 407 evacuees in four LMS relief centres', 'https://www.bernama.com/en/general/news.php?id=2621890');
