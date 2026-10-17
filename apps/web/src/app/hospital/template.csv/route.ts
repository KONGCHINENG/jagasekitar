import { getPortalUser } from '@/lib/auth';
import { csvTemplate, todayMyt } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  if (!(await getPortalUser())) return new Response('Sign in first', { status: 401 });
  const supabase = await createClient();
  const { data } = await supabase
    .from('disease_types')
    .select('code')
    .eq('active', true)
    .order('name_en');
  return new Response(
    csvTemplate(
      (data ?? []).map((d) => d.code),
      todayMyt(),
    ),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="jagasekitar-cases-template.csv"',
      },
    },
  );
}
