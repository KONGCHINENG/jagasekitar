'use client';
import { useSearchParams } from 'next/navigation';
import { useActionState, useState } from 'react';
import { signIn, signUp, type AuthState } from './actions';

const input =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-cyan-700 focus:ring-2 focus:ring-cyan-700/20 dark:border-neutral-700 dark:bg-neutral-900';

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '';
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [signInState, signInAction, signingIn] = useActionState<AuthState, FormData>(
    signIn,
    undefined,
  );
  const [signUpState, signUpAction, signingUp] = useActionState<AuthState, FormData>(
    signUp,
    undefined,
  );
  const state = mode === 'signin' ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        className="grid grid-cols-2 rounded-lg bg-neutral-100 p-1 text-sm font-medium dark:bg-neutral-900"
      >
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md py-2 ${mode === m ? 'bg-white shadow-sm dark:bg-neutral-800' : 'text-neutral-600 dark:text-neutral-400'}`}
          >
            {m === 'signin' ? 'Sign in' : 'New staff account'}
          </button>
        ))}
      </div>

      <form
        action={mode === 'signin' ? signInAction : signUpAction}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="next" value={next} />
        {mode === 'signup' && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Full name
            <input name="fullName" required autoComplete="name" className={input} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Work email
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className={input}
          />
        </label>
        {state?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.error}
          </p>
        )}
        {state?.info && <p className="text-sm text-cyan-800 dark:text-cyan-300">{state.info}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-lg bg-cyan-800 px-4 py-2.5 font-semibold text-white hover:bg-cyan-900 disabled:opacity-60"
        >
          {pending ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      {mode === 'signup' && (
        <p className="text-xs text-neutral-500">
          After you sign in, request access to your facility. An administrator approves it before
          you can report cases.
        </p>
      )}
    </div>
  );
}
