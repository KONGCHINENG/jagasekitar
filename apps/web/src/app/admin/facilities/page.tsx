import { Suspense } from 'react';
import { ActionButton } from '@/components/action-button';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { reviewJoin, updateFacility } from '../actions';

export const metadata = { title: 'Facilities & staff · Admin' };

const approve =
  'rounded-md bg-green-700 px-2.5 py-1 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50';
const reject =
  'rounded-md border border-red-300 px-2.5 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400';

export default function FacilitiesPage() {
  return (
    <>
      <PageTitle sub="Approve staff access requests and verify facilities. Approving a proposed facility creates it as verified.">
        Facilities &amp; staff
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[500px]" />}>
        <FacilitiesBody />
      </Suspense>
    </>
  );
}

interface Proposed {
  name?: string;
  type?: string;
  district?: string;
  contact?: string;
}

async function FacilitiesBody() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: requests }, { data: facilities }, { data: users }, { data: staffCounts }] =
    await Promise.all([
      supabase
        .from('facility_join_requests')
        .select(
          'id, user_id, facility_id, proposed_facility, message, status, created_at, facilities(name, district)',
        )
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('facilities')
        .select('id, name, type, district, verified, active, contact')
        .order('district')
        .order('name'),
      supabase.rpc('admin_list_users'),
      supabase.from('profiles').select('facility_id').eq('role', 'hospital_staff'),
    ]);
  const userById = new Map(
    ((users ?? []) as { id: string; email: string | null; full_name: string | null }[]).map((u) => [
      u.id,
      u,
    ]),
  );
  const staffAt = (id: string) => (staffCounts ?? []).filter((p) => p.facility_id === id).length;
  const pending = (requests ?? []).filter((r) => r.status === 'pending');
  const reviewed = (requests ?? []).filter((r) => r.status !== 'pending').slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <Card title={`Access requests (${pending.length} pending)`}>
        {pending.length === 0 && <p className="text-sm text-neutral-500">No pending requests.</p>}
        <ul className="flex flex-col gap-3">
          {pending.map((r) => {
            const u = userById.get(r.user_id);
            const proposed = r.proposed_facility as Proposed | null;
            const fac = r.facilities as unknown as { name: string; district: string } | null;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="min-w-64 flex-1 text-sm">
                  <p className="font-medium">
                    {u?.full_name ?? 'Unnamed'}{' '}
                    <span className="text-neutral-500">&lt;{u?.email ?? r.user_id}&gt;</span>
                  </p>
                  {fac ? (
                    <p>
                      wants to report for <strong>{fac.name}</strong> ({fac.district})
                    </p>
                  ) : (
                    <p>
                      proposes a <strong>new {proposed?.type ?? 'facility'}</strong>:{' '}
                      {proposed?.name} ({proposed?.district})
                      {proposed?.contact && (
                        <span className="text-neutral-500"> · {proposed.contact}</span>
                      )}
                    </p>
                  )}
                  {r.message && (
                    <p className="text-neutral-600 dark:text-neutral-400">“{r.message}”</p>
                  )}
                  <p className="text-xs text-neutral-500">
                    {new Date(r.created_at).toLocaleString('en-MY', {
                      timeZone: 'Asia/Kuala_Lumpur',
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <ActionButton className={approve} action={reviewJoin.bind(null, r.id, true)}>
                    Approve
                  </ActionButton>
                  <ActionButton
                    className={reject}
                    action={reviewJoin.bind(null, r.id, false)}
                    confirm="Reject this request?"
                  >
                    Reject
                  </ActionButton>
                </div>
              </li>
            );
          })}
        </ul>
        {reviewed.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-neutral-600">Recently reviewed</summary>
            <ul className="mt-2">
              {reviewed.map((r) => (
                <li key={r.id} className="text-neutral-600 dark:text-neutral-400">
                  {userById.get(r.user_id)?.email ?? r.user_id}: {r.status}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Facilities">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-neutral-600 dark:text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">District</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Staff</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {(facilities ?? []).map((f) => (
                <tr
                  key={f.id}
                  className={`border-t border-neutral-100 dark:border-neutral-900 ${f.active ? '' : 'opacity-50'}`}
                >
                  <td className="py-1.5">{f.name}</td>
                  <td className="py-1.5">{f.district}</td>
                  <td className="py-1.5">{f.type === 'hospital' ? '🏥 Hospital' : '🩺 Clinic'}</td>
                  <td className="py-1.5 text-right tabular-nums">{staffAt(f.id)}</td>
                  <td className="py-1.5">
                    {f.verified ? (
                      <span className="text-green-700 dark:text-green-400">✓ Verified</span>
                    ) : (
                      <span className="text-amber-700">▲ Unverified</span>
                    )}
                    {!f.active && <span className="ml-2 text-neutral-500">(inactive)</span>}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <ActionButton
                      action={updateFacility.bind(null, f.id, { verified: !f.verified })}
                    >
                      {f.verified ? 'Unverify' : 'Verify'}
                    </ActionButton>{' '}
                    <ActionButton action={updateFacility.bind(null, f.id, { active: !f.active })}>
                      {f.active ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
