import { RISK_COLORS, RISK_LABELS, type RiskLevel } from '@jagasekitar/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { ActionButton } from '@/components/action-button';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { requestBriefing } from '../actions';
import { AutoRefresh } from './auto-refresh';

export const metadata = { title: 'AI briefing · Admin' };

interface Suggestion {
  districts: string[];
  level: RiskLevel;
  title_en: string;
  title_ms: string;
  body_en: string;
  body_ms: string;
  why: string;
}
interface Briefing {
  id: string;
  trigger: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  model: string | null;
  summary_en: string | null;
  summary_ms: string | null;
  suggestions: Suggestion[];
  tools_used: { tool: string; rows: number }[];
  usage: { calls?: number; ms?: number } | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const primary =
  'rounded-md bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50';
const myt = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

export default function BriefingPage() {
  return (
    <>
      <PageTitle sub="An AI agent reads the current zones, official alerts, hospital totals and data health, then drafts a summary and broadcast suggestions. Drafts only: nothing is sent until you review it on the Broadcast page.">
        AI briefing
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[600px]" />}>
        <BriefingBody />
      </Suspense>
    </>
  );
}

async function BriefingBody() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from('ai_briefings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Briefing[];
  const pending = rows.find((r) => r.status === 'queued' || r.status === 'running');
  const latest = rows.find((r) => r.status === 'done');

  return (
    <div className="flex flex-col gap-6">
      <Card title="Generate">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ActionButton className={primary} action={requestBriefing}>
            ✨ Generate briefing now
          </ActionButton>
          {pending && (
            <span className="text-violet-700 dark:text-violet-300">
              {pending.status === 'queued' ? 'Waiting for the worker…' : 'Writing…'} (requested{' '}
              {myt(pending.created_at)})
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Runs in the data worker (laptop <code>npm run worker:dev</code>, or the hourly GitHub
          run). A morning briefing is also written automatically (Thresholds → ai). Only
          district-level data is sent to the AI service; never user locations or personal data.
        </p>
        {pending && <AutoRefresh everyMs={5000} />}
      </Card>

      {latest ? (
        <BriefingCard b={latest} />
      ) : (
        <Card title="Latest briefing">
          <p className="text-sm">No briefing yet. Click Generate.</p>
        </Card>
      )}

      <Card title="History">
        <ul className="text-sm">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap gap-3 border-t border-neutral-100 py-1.5 first:border-0 dark:border-neutral-900"
            >
              <span className="tabular-nums">{myt(r.created_at)}</span>
              <span className="text-neutral-500">{r.trigger}</span>
              <span
                className={
                  r.status === 'failed'
                    ? 'text-red-700 dark:text-red-400'
                    : r.status === 'done'
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-violet-700 dark:text-violet-300'
                }
              >
                {r.status}
              </span>
              {r.error && <span className="text-xs text-red-700 dark:text-red-400">{r.error}</span>}
              {r.status === 'done' && (
                <span className="ml-auto text-neutral-500">
                  {r.suggestions.length} suggestion{r.suggestions.length === 1 ? '' : 's'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function BriefingCard({ b }: { b: Briefing }) {
  return (
    <Card title={`Latest briefing · ${myt(b.finished_at ?? b.created_at)}`}>
      <div className="flex flex-col gap-5 text-sm">
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              English
            </h3>
            <p className="leading-relaxed whitespace-pre-line">{b.summary_en}</p>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Bahasa Melayu
            </h3>
            <p className="leading-relaxed whitespace-pre-line">{b.summary_ms}</p>
          </section>
        </div>

        <section>
          <h3 className="mb-2 font-semibold">Suggested broadcasts ({b.suggestions.length})</h3>
          {!b.suggestions.length && (
            <p className="text-neutral-500">
              None: nothing high or severe that wasn&apos;t already sent.
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {b.suggestions.map((s, i) => (
              <div
                key={i}
                className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: RISK_COLORS[s.level] }}
                  >
                    {RISK_LABELS[s.level]?.en ?? s.level}
                  </span>
                  <span className="font-medium">{s.districts.join(', ')}</span>
                </div>
                <p className="font-semibold">{s.title_en}</p>
                <p>{s.body_en}</p>
                <p className="text-neutral-600 dark:text-neutral-400">
                  {s.title_ms}: {s.body_ms}
                </p>
                {s.why && <p className="text-xs text-neutral-500">Based on: {s.why}</p>}
                <Link
                  href={`/admin/broadcast?briefing=${b.id}&s=${i}`}
                  className="mt-1 self-start rounded-md border border-violet-300 px-2.5 py-1 text-violet-800 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950"
                >
                  Review &amp; send as broadcast →
                </Link>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs text-neutral-500">
          Data used:{' '}
          {b.tools_used.map((t) => `${t.tool.replace(/^get_/, '')} (${t.rows})`).join(' · ')}
          {' · '}model {b.model}
          {b.usage?.ms ? ` · ${Math.round(b.usage.ms / 1000)} s` : ''}
          {b.usage?.calls ? ` · ${b.usage.calls} model calls` : ''}. AI can make mistakes: check
          against the maps before acting.
        </p>
      </div>
    </Card>
  );
}
