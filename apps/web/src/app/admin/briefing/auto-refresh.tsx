'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-fetch the page's server data on an interval while a briefing is being written. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
