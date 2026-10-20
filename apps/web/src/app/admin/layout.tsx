import Link from 'next/link';
import { Suspense } from 'react';
import { getPortalUser } from '@/lib/auth';
import { signOut } from '../login/actions';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/sources', label: 'Data sources' },
  { href: '/admin/thresholds', label: 'Thresholds' },
  { href: '/admin/calibration', label: 'Calibration' },
  { href: '/admin/briefing', label: 'AI briefing' },
  { href: '/admin/stations', label: 'Stations' },
  { href: '/admin/facilities', label: 'Facilities & staff' },
  { href: '/admin/reports', label: 'Case reports' },
  { href: '/admin/broadcast', label: 'Broadcast alert' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/demo', label: 'Demo mode' },
  { href: '/admin/audit', label: 'Audit log' },
] as const;

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-4 px-6 py-3">
          <Link href="/admin" className="font-semibold text-cyan-800 dark:text-cyan-300">
            🛡️ JagaSekitar · Admin
          </Link>
          <div className="ml-auto text-sm">
            <Suspense fallback={<span className="text-neutral-400">…</span>}>
              <AdminBadge />
            </Suspense>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Admin"
          className="border-b border-neutral-200 px-4 py-3 md:w-56 md:border-r md:border-b-0 dark:border-neutral-800"
        >
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm md:flex-col">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="block rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

async function AdminBadge() {
  const user = await getPortalUser();
  if (!user) return null;
  return (
    <form action={signOut} className="flex items-center gap-3">
      <span className="text-neutral-600 dark:text-neutral-400">{user.fullName ?? user.email}</span>
      <button className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
        Sign out
      </button>
    </form>
  );
}
