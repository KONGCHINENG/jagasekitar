'use server';
// Every action re-checks the session and role and re-validates input: never trust the client.
import { requireReportingStaff, requireUser } from '@/lib/auth';
import {
  DEFAULT_SPIKE_MULTIPLIER,
  canEditDirectly,
  reportRowSchema,
  spikeWarnings,
  todayMyt,
  validateRows,
  type RowIssue,
} from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';

export type SubmitResult =
  | { status: 'saved'; inserted: number; updated: number; flagged: number }
  | { status: 'invalid'; issues: RowIssue[] }
  | { status: 'confirm-spikes'; spikes: { diseaseCode: string; newCases: number; usual: number }[] }
  | { status: 'error'; message: string };

async function activeDiseaseCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const { data } = await supabase.from('disease_types').select('code').eq('active', true);
  return (data ?? []).map((d) => d.code as string);
}

export async function submitReports(
  input: unknown[],
  confirmSpikes: boolean,
): Promise<SubmitResult> {
  const user = await requireReportingStaff();
  const supabase = await createClient();
  if (!Array.isArray(input) || input.length === 0)
    return { status: 'invalid', issues: [{ row: 0, message: 'Add at least one row' }] };
  if (input.length > 200)
    return { status: 'invalid', issues: [{ row: 0, message: 'At most 200 rows per submission' }] };

  const { rows, issues } = validateRows(input, {
    diseaseCodes: await activeDiseaseCodes(supabase),
  });
  if (issues.length) return { status: 'invalid', issues };

  // Usual daily count per disease at this facility over the 28 days before today.
  const today = todayMyt();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 28 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data: history } = await supabase
    .from('case_reports')
    .select('disease_code, new_cases, report_date')
    .eq('facility_id', user.facility.id)
    .gte('report_date', since)
    .lt('report_date', today)
    .neq('status', 'rejected');
  const usual: Record<string, number> = {};
  for (const h of history ?? [])
    usual[h.disease_code] = (usual[h.disease_code] ?? 0) + h.new_cases / 28;

  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'disease')
    .maybeSingle();
  const multiplier =
    (setting?.value as { spike_warning_multiplier?: number } | null)?.spike_warning_multiplier ??
    DEFAULT_SPIKE_MULTIPLIER;
  const spikes = spikeWarnings(rows, usual, multiplier);
  if (spikes.length && !confirmSpikes) return { status: 'confirm-spikes', spikes };
  const spikeCodes = new Set(spikes.map((s) => s.diseaseCode));

  // Existing reports for the same dates: edit if still inside the 48 h window, else refuse.
  const { data: existing } = await supabase
    .from('case_reports')
    .select('id, disease_code, report_date, created_at')
    .eq('facility_id', user.facility.id)
    .in('report_date', [...new Set(rows.map((r) => r.reportDate))]);
  const blocked: RowIssue[] = [];
  let inserted = 0;
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    const prior = existing?.find(
      (e) => e.disease_code === r.diseaseCode && e.report_date === r.reportDate,
    );
    const values = {
      new_cases: r.newCases,
      suspected_cases: r.suspectedCases,
      notes: r.notes ?? null,
      flagged: spikeCodes.has(r.diseaseCode),
    };
    if (prior) {
      if (!canEditDirectly(prior.created_at)) {
        blocked.push({
          row: i + 1,
          message: 'Already reported more than 48 hours ago: request a change from History',
        });
        continue;
      }
      const { error } = await supabase.from('case_reports').update(values).eq('id', prior.id);
      if (error) blocked.push({ row: i + 1, message: error.message });
      else updated++;
    } else {
      const { error } = await supabase.from('case_reports').insert({
        ...values,
        facility_id: user.facility.id,
        disease_code: r.diseaseCode,
        report_date: r.reportDate,
        submitted_by: user.id,
      });
      if (error) blocked.push({ row: i + 1, message: error.message });
      else inserted++;
    }
  }
  if (blocked.length && inserted + updated === 0) return { status: 'invalid', issues: blocked };
  if (blocked.length)
    return {
      status: 'invalid',
      issues: [{ row: 0, message: `${inserted + updated} rows saved; some were not:` }, ...blocked],
    };
  return { status: 'saved', inserted, updated, flagged: spikes.length };
}

export type EditResult = { ok: true; message: string } | { ok: false; message: string };

const editSchema = reportRowSchema.pick({ newCases: true, suspectedCases: true, notes: true });

/** Direct edit within 48 h of submission; otherwise the change goes to an admin for approval. */
export async function editReport(
  reportId: string,
  values: unknown,
  reason: string,
): Promise<EditResult> {
  const user = await requireReportingStaff();
  const parsed = editSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { data: report } = await supabase
    .from('case_reports')
    .select('id, created_at, status')
    .eq('id', reportId)
    .eq('facility_id', user.facility.id)
    .maybeSingle();
  if (!report) return { ok: false, message: 'Report not found' };
  const v = parsed.data;

  if (report.status === 'submitted' && canEditDirectly(report.created_at)) {
    const { error } = await supabase
      .from('case_reports')
      .update({ new_cases: v.newCases, suspected_cases: v.suspectedCases, notes: v.notes ?? null })
      .eq('id', reportId);
    return error ? { ok: false, message: error.message } : { ok: true, message: 'Report updated' };
  }
  if (reason.trim().length < 3)
    return { ok: false, message: 'Please give a reason for the change' };
  const { error } = await supabase.from('case_report_edits').insert({
    report_id: reportId,
    requested_by: user.id,
    new_cases: v.newCases,
    suspected_cases: v.suspectedCases,
    notes: v.notes ?? null,
    reason: reason.trim().slice(0, 500),
  });
  return error
    ? { ok: false, message: error.message }
    : { ok: true, message: 'Change sent to an admin for approval' };
}

export type JoinResult = { ok: true } | { ok: false; message: string };

export async function requestFacilityAccess(formData: FormData): Promise<JoinResult> {
  const user = await requireUser();
  if (user.role === 'admin') return { ok: false, message: 'Admins do not need facility access' };
  if (user.pendingRequest) return { ok: false, message: 'You already have a pending request' };
  const supabase = await createClient();
  const facilityId = String(formData.get('facility_id') ?? '');
  const message = String(formData.get('message') ?? '').slice(0, 500) || null;
  const proposed = {
    name: String(formData.get('new_name') ?? '').trim(),
    type: String(formData.get('new_type') ?? 'clinic'),
    district: String(formData.get('new_district') ?? '').trim(),
    state: 'PRK',
    contact: String(formData.get('new_contact') ?? '').trim(),
  };
  if (!facilityId && (proposed.name.length < 3 || !proposed.district)) {
    return {
      ok: false,
      message: 'Choose your facility, or enter the new facility name and district',
    };
  }
  const { error } = await supabase.from('facility_join_requests').insert({
    user_id: user.id,
    facility_id: facilityId || null,
    proposed_facility: facilityId ? null : proposed,
    message,
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}
