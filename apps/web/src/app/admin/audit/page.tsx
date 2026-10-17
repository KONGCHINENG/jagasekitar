import Link from 'next/link';
import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Audit log · Admin' };

const ENTITIES = [
  'case_reports',
  'case_report_edits',
  'facility_join_requests',
  'facilities',
  'profiles',
  'settings',
  'admin_broadcasts',
  'rain_stations',
  'water_level_stations',
  'disease_types',
];
const PAGE = 50;

export default function AuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  return (
    <>
      <PageTitle sub="Every change to reports, facilities, users, settings, broadcasts and stations, with who made it.">
        Audit log
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[500px]" />}>
        <AuditBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AuditBody({
  searchParams,
}: {
  searchParams: PageProps<'/admin/audit'>['searchParams'];
}) {
  await requireAdmin();
  const params = await searchParams;
  const entity =
    typeof params.entity === 'string' && ENTITIES.includes(params.entity) ? params.entity : null;
  const page = Math.max(0, Number(params.page) || 0);
  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select('id, actor, action, entity, entity_id, diff, at')
    .order('at', { ascending: false });
  if (entity) query = query.eq('entity', entity);
  const [{ data: rows }, { data: users }] = await Promise.all([
    query.range(page * PAGE, page * PAGE + PAGE - 1),
    supabase.rpc('admin_list_users'),
  ]);
  const who = new Map(
    ((users ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]),
  );
  const href = (e: string | null, p = 0) =>
    `/admin/audit?${new URLSearchParams({ ...(e ? { entity: e } : {}), ...(p ? { page: String(p) } : {}) })}`;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          href={href(null)}
          className={`rounded-full px-3 py-1 ${!entity ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}
        >
          All
        </Link>
        {ENTITIES.map((e) => (
          <Link
            key={e}
            href={href(e)}
            className={`rounded-full px-3 py-1 ${entity === e ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}
          >
            {e}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium">When</th>
              <th className="pb-2 font-medium">Who</th>
              <th className="pb-2 font-medium">Action</th>
              <th className="pb-2 font-medium">Entity</th>
              <th className="pb-2 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr
                key={r.id}
                className="border-t border-neutral-100 align-top dark:border-neutral-900"
              >
                <td className="py-1.5 whitespace-nowrap">
                  {new Date(r.at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
                </td>
                <td className="py-1.5">{r.actor ? (who.get(r.actor) ?? 'app user') : 'system'}</td>
                <td className="py-1.5">{r.action}</td>
                <td className="py-1.5 font-mono text-xs">
                  {r.entity}
                  <span className="block text-neutral-500">{r.entity_id}</span>
                </td>
                <td className="py-1.5">
                  <details>
                    <summary className="cursor-pointer text-neutral-600">
                      {changedFields(r.diff)}
                    </summary>
                    <pre className="mt-1 max-h-60 max-w-xl overflow-auto rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-900">
                      {JSON.stringify(r.diff, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-3 text-sm">
        {page > 0 && (
          <Link
            className="text-cyan-800 underline dark:text-cyan-300"
            href={href(entity, page - 1)}
          >
            ← Newer
          </Link>
        )}
        {(rows?.length ?? 0) === PAGE && (
          <Link
            className="text-cyan-800 underline dark:text-cyan-300"
            href={href(entity, page + 1)}
          >
            Older →
          </Link>
        )}
      </div>
    </Card>
  );
}

/** "status, flagged" for updates; "created" / "deleted" otherwise. */
function changedFields(diff: unknown): string {
  const d = diff as { old?: Record<string, unknown>; new?: Record<string, unknown> } | null;
  if (!d?.old) return 'created';
  if (!d.new) return 'deleted';
  const keys = Object.keys(d.new).filter(
    (k) => k !== 'updated_at' && JSON.stringify(d.new![k]) !== JSON.stringify(d.old![k]),
  );
  return keys.length ? keys.join(', ') : 'no field changes';
}
