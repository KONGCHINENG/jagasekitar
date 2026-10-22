import Link from 'next/link';
import { DISCLAIMER } from '@jagasekitar/shared';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold">JagaSekitar Portal</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Multi-hazard early warning for haze, floods and disease outbreaks.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/hospital"
          className="rounded-xl border border-neutral-200 p-6 hover:border-pink-500 dark:border-neutral-800"
        >
          <h2 className="text-lg font-medium">Hospital portal</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Submit daily aggregate case counts for your facility.
          </p>
        </Link>
        <Link
          href="/admin"
          className="rounded-xl border border-neutral-200 p-6 hover:border-cyan-600 dark:border-neutral-800"
        >
          <h2 className="text-lg font-medium">Admin panel</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Manage data sources, thresholds, facilities, alerts and broadcasts.
          </p>
        </Link>
      </div>
      <p className="text-xs text-neutral-500">{DISCLAIMER.en}</p>
    </main>
  );
}
