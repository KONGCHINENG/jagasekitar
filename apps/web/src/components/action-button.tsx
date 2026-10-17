'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

type Result = { ok: boolean; message?: string };

/** Runs a Server Action, shows its message, and refreshes the page's server data on success. */
export function ActionButton({
  action,
  children,
  className = 'rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900',
  confirm,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await action();
            setMsg(res);
            if (res.ok) router.refresh();
          });
        }}
      >
        {pending ? '…' : children}
      </button>
      {msg?.message && (
        <span
          role="status"
          className={`text-xs ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
        >
          {msg.message}
        </span>
      )}
    </span>
  );
}
