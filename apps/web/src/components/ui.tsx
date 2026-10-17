import type { ReactNode } from 'react';

export function Card({
  title,
  children,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950 ${className}`}
    >
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{sub}</p>}
    </div>
  );
}

export function Skeleton({ h = 'h-40' }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900`} />;
}

export const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-700 focus:ring-2 focus:ring-pink-700/20 dark:border-neutral-700 dark:bg-neutral-900';

export const buttonClass =
  'rounded-lg bg-pink-800 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-900 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900';
