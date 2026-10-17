'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';

/** Fallback for unexpected errors in any portal page. Server details stay in the server log. */
export default function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        The page could not load, often because the connection to the database dropped. Your data is
        safe. Try again in a moment.
      </p>
      {digest && <p className="text-xs text-neutral-500">Reference: {digest}</p>}
      <button
        onClick={() => retry()}
        className="self-start rounded-lg bg-cyan-800 px-4 py-2 font-semibold text-white hover:bg-cyan-900"
      >
        Try again
      </button>
    </main>
  );
}
