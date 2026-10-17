import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · JagaSekitar Portal' };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← JagaSekitar Portal
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          For hospital and clinic staff, and administrators.
        </p>
      </div>
      {/* Reads ?next= at request time, so it streams in. */}
      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
