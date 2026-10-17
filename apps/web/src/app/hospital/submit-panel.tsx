'use client';
// Shared submit flow for the entry grid and CSV upload: issues per row, spike confirmation, result.
import { useState, useTransition } from 'react';
import { buttonClass } from '@/components/ui';
import { submitReports, type SubmitResult } from './actions';

export function useSubmitReports() {
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, start] = useTransition();
  const submit = (rows: unknown[], confirmSpikes = false) =>
    start(async () => {
      setResult(await submitReports(rows, confirmSpikes));
    });
  return { result, pending, submit, reset: () => setResult(null) };
}

export function SubmitFeedback({
  result,
  pending,
  onConfirmSpikes,
  diseaseNames,
}: {
  result: SubmitResult | null;
  pending: boolean;
  onConfirmSpikes: () => void;
  diseaseNames: Record<string, string>;
}) {
  if (!result) return null;
  if (result.status === 'saved') {
    return (
      <p
        role="status"
        className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-100"
      >
        ✓ Saved: {result.inserted} new, {result.updated} updated.
        {result.flagged > 0 && ` ${result.flagged} flagged as unusual for admin review.`}
      </p>
    );
  }
  if (result.status === 'confirm-spikes') {
    return (
      <div
        role="alertdialog"
        aria-labelledby="spike-title"
        className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
      >
        <p id="spike-title" className="font-semibold">
          ▲ These numbers are much higher than usual for your facility. Please double-check them.
        </p>
        <ul className="mt-2 list-disc pl-5">
          {result.spikes.map((s) => (
            <li key={s.diseaseCode}>
              {diseaseNames[s.diseaseCode] ?? s.diseaseCode}: {s.newCases} cases (usually about{' '}
              {s.usual.toFixed(1)} a day)
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={onConfirmSpikes}
            disabled={pending}
          >
            The numbers are correct, submit
          </button>
        </div>
        <p className="mt-2 text-xs">Confirmed spikes are flagged for an admin to verify.</p>
      </div>
    );
  }
  if (result.status === 'invalid') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      >
        <p className="font-semibold">Please fix these and submit again:</p>
        <ul className="mt-1 list-disc pl-5">
          {result.issues.map((i, k) => (
            <li key={k}>
              {i.row > 0 ? `Row ${i.row}: ` : ''}
              {i.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p role="alert" className="text-sm text-red-700">
      {result.message}
    </p>
  );
}
