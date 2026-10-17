'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type AuthState = { error?: string; info?: string } | undefined;

// Sign-in accepts any existing password (accounts created elsewhere may follow Supabase's
// 6-character default); the 8-character rule applies only to new accounts.
const credentials = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
const newPassword = z.string().min(8, 'Password must be at least 8 characters');

/** Only allow redirects within the portal. */
function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === 'string' ? next : '';
  return n.startsWith('/hospital') || n.startsWith('/admin') ? n : '/hospital';
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Email or password is incorrect' };
  const { data } = await supabase.rpc('my_portal_profile').maybeSingle<{ role: string }>();
  const next = safeNext(formData.get('next'));
  redirect(data?.role === 'admin' && next === '/hospital' ? '/admin' : next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials
    .extend({ password: newPassword, fullName: z.string().trim().min(2, 'Enter your name') })
    .safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      fullName: formData.get('fullName'),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });
  if (error) return { error: error.message };
  if (!data.session) return { info: 'Check your email to confirm your account, then sign in.' };
  redirect('/hospital');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
