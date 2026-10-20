-- AI briefing agent (Admin → AI briefing). The worker runs an LLM that reads current data through
-- read-only tools and drafts a situation summary (EN + BM) plus suggested broadcasts. Drafts
-- only: an admin reviews and sends through the normal Broadcast page.
set search_path = public, extensions;

create table public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users (id),   -- null when scheduled
  trigger text not null default 'manual',         -- manual | scheduled
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  model text,
  summary_en text,
  summary_ms text,
  -- [{ districts, level, title_en, title_ms, body_en, body_ms, why }]
  suggestions jsonb not null default '[]'::jsonb,
  -- which tools the agent called and how many rows each returned (what the draft is based on)
  tools_used jsonb not null default '[]'::jsonb,
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_briefings_status_idx on public.ai_briefings (status, created_at);

alter table public.ai_briefings enable row level security;
create policy admin_all on public.ai_briefings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create trigger audit_changes after insert or update or delete on public.ai_briefings
  for each row execute function public.audit_changes();

insert into public.settings (key, value, description) values
  ('ai', '{"daily_briefing": true, "briefing_hour_myt": 7, "daily_limit": 20}',
   'AI briefing agent: automatic morning briefing, its hour (Malaysia time) and a daily cap')
on conflict (key) do nothing;
