import { requireSupabase } from '@/lib/supabase';
import { useRemote } from './use-remote';

interface DemoMode {
  enabled: boolean;
  scenario: string | null;
}

async function fetchDemoMode(): Promise<DemoMode> {
  const { data, error } = await requireSupabase()
    .from('settings')
    .select('value')
    .eq('key', 'demo_mode')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data?.value ?? {}) as Partial<DemoMode>;
  return { enabled: !!v.enabled, scenario: v.scenario ?? null };
}

/** Whether the system is replaying a demo scenario (shown so nobody mistakes it for a real warning). */
export function useDemoMode() {
  return useRemote('demo-mode', fetchDemoMode, { refreshMs: 60_000 }).data;
}
