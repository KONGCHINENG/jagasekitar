'use client';
import { useState } from 'react';
import { parseCasesCsv, validateRows, type RowIssue } from '@/lib/reports';
import { SubmitFeedback, useSubmitReports } from '../submit-panel';
import { buttonClass } from '@/components/ui';

export function CsvUpload({ diseases }: { diseases: { code: string; name: string }[] }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<string, unknown>[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const { result, pending, submit, reset } = useSubmitReports();
  const codes = diseases.map((d) => d.code);
  const names = Object.fromEntries(diseases.map((d) => [d.code, d.name]));

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    if (file.size > 512 * 1024) {
      setIssues([{ row: 0, message: 'File is larger than 512 KB' }]);
      return;
    }
    setFileName(file.name);
    const parsed = parseCasesCsv(await file.text());
    setRaw(parsed.raw);
    // Preview validation; the server validates again on submit.
    setIssues(
      parsed.issues.length
        ? parsed.issues
        : validateRows(parsed.raw, { diseaseCodes: codes }).issues,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm font-medium">
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-pink-50 file:px-3 file:py-2 file:font-medium file:text-pink-900 dark:file:bg-pink-950 dark:file:text-pink-100"
        />
      </label>

      {fileName && raw.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">
            {fileName}: {raw.length} row{raw.length === 1 ? '' : 's'}
          </p>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-neutral-600 dark:text-neutral-400">
              <tr>
                <th className="pb-1 font-medium">#</th>
                <th className="pb-1 font-medium">Date</th>
                <th className="pb-1 font-medium">Disease</th>
                <th className="pb-1 text-right font-medium">Confirmed</th>
                <th className="pb-1 text-right font-medium">Suspected</th>
                <th className="pb-1 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {raw.slice(0, 50).map((r, i) => {
                const bad = issues.some((x) => x.row === i + 1);
                return (
                  <tr
                    key={i}
                    className={`border-t border-neutral-100 dark:border-neutral-900 ${bad ? 'bg-red-50 dark:bg-red-950' : ''}`}
                  >
                    <td className="py-1 text-neutral-500">{i + 1}</td>
                    <td className="py-1">{String(r.reportDate)}</td>
                    <td className="py-1">
                      {names[String(r.diseaseCode)] ?? String(r.diseaseCode)}
                    </td>
                    <td className="py-1 text-right tabular-nums">{String(r.newCases)}</td>
                    <td className="py-1 text-right tabular-nums">{String(r.suspectedCases)}</td>
                    <td className="max-w-48 truncate py-1">{String(r.notes ?? '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {raw.length > 50 && (
            <p className="mt-1 text-xs text-neutral-500">Showing the first 50 rows.</p>
          )}
        </div>
      )}

      {issues.length > 0 && !result && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          <p className="font-semibold">Fix these in your file and upload it again:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.slice(0, 20).map((x, k) => (
              <li key={k}>
                {x.row > 0 ? `Row ${x.row}: ` : ''}
                {x.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {raw.length > 0 && (
        <button
          className={`${buttonClass} self-start`}
          disabled={pending || issues.length > 0}
          onClick={() => submit(raw)}
        >
          {pending ? 'Submitting…' : `Submit ${raw.length} rows`}
        </button>
      )}
      <SubmitFeedback
        result={result}
        pending={pending}
        diseaseNames={names}
        onConfirmSpikes={() => submit(raw, true)}
      />
    </div>
  );
}
