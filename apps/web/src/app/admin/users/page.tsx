import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { UserRow, type AdminUser } from './user-row';

export const metadata = { title: 'Users · Admin' };

export default function UsersPage() {
  return (
    <>
      <PageTitle sub="Change roles, assign hospital staff to a facility, or deactivate accounts. App users are anonymous unless they signed up.">
        Users
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[500px]" />}>
        <UsersBody />
      </Suspense>
    </>
  );
}

async function UsersBody() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: users }, { data: facilities }] = await Promise.all([
    supabase.rpc('admin_list_users'),
    supabase.from('facilities').select('id, name').eq('verified', true).order('name'),
  ]);
  const all = (users ?? []) as AdminUser[];
  const named = all.filter((u) => !u.is_anonymous);
  const anonymous = all.length - named.length;
  return (
    <Card title={`${named.length} signed-up users · ${anonymous} anonymous app users`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium">User</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Facility</th>
              <th className="pb-2 font-medium">Active</th>
              <th className="pb-2 font-medium">Last sign-in</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {named.map((u) => (
              <UserRow key={u.id} user={u} facilities={facilities ?? []} isSelf={u.id === me.id} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
