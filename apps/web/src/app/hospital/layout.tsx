import Link from 'next/link';
import { Suspense } from 'react';
import { getPortalUser } from '@/lib/auth';
import { signOut } from '../login/actions';

const NAV = [
  { href: '/hospital', label: 'Dashboard' },
  { href: '/hospital/report', label: 'Report cases' },
  { href: '/hospital/upload', label: 'CSV upload' },
  { href: '/hospital/history', label: 'History' },
  { href: '/hospital/map', label: 'District map' },
] as const;

export default function HospitalLayout({ children }: LayoutProps<'/hospital'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/hospital" className="font-semibold text-pink-800 dark:text-pink-300">
            🦠 JagaSekitar · Hospital portal
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-neutral-700 hover:text-pink-800 hover:underline dark:text-neutral-300"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto text-sm">
            <Suspense fallback={<span className="text-neutral-400">…</span>}>
              <UserBadge />
            </Suspense>
          </div>
        </div>
      </header>
      <div
        role="note"
        className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-center text-sm font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      >
        Enter aggregated counts only. Do not enter patient names, IC numbers, or any personal data.
      </div>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        {children}
      </main>
    </div>
  );
}

async function UserBadge() {
  const user = await getPortalUser();
  if (!user) return null;
  return (
    <form action={signOut} className="flex items-center gap-3">
      <span className="text-neutral-600 dark:text-neutral-400">{user.fullName ?? user.email}</span>
      {user.role === 'admin' && (
        <Link href="/admin" className="text-cyan-800 hover:underline dark:text-cyan-300">
          Admin
        </Link>
      )}
      <button className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
        Sign out
      </button>
    </form>
  );
}
