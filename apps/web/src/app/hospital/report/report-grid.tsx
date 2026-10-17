'use client';
import { useState } from 'react';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { SubmitFeedback, useSubmitReports } from '../submit-panel';

interface Row {
  key: number;
  diseaseCode: string;
  newCases: string;
  suspectedCases: string;
  notes: string;
}

let nextKey = 1;
const blank = (diseaseCode = ''): Row => ({
  key: nextKey++,
  diseaseCode,
  newCases: '',
  suspectedCases: '0',
  notes: '',
});

export function ReportGrid({
  diseases,
  today,
}: {
  diseases: { code: string; name: string }[];
  today: string;
}) {
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<Row[]>(() => [blank()]);
  const { result, pending, submit, reset } = useSubmitReports();
  const names = Object.fromEntries(diseases.map((d) => [d.code, d.name]));
  const used = new Set(rows.map((r) => r.diseaseCode));

  const update = (key: number, patch: Partial<Row>) => {
    reset();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const payload = () =>
    rows.map((r) => ({
      reportDate: date,
      diseaseCode: r.diseaseCode,
      newCases: r.newCases,
      suspectedCases: r.suspectedCases || '0',
      notes: r.notes,
    }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(payload());
      }}
    >
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Report date
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
          required
        />
      </label>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium">Disease</th>
              <th className="w-32 pb-2 font-medium">New confirmed</th>
              <th className="w-32 pb-2 font-medium">Suspected</th>
              <th className="pb-2 font-medium">Notes (optional, no personal data)</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="align-top">
                <td className="py-1 pr-2">
                  <select
                    aria-label={`Disease, row ${i + 1}`}
                    value={r.diseaseCode}
                    onChange={(e) => update(r.key, { diseaseCode: e.target.value })}
                    className={inputClass}
                    required
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {diseases.map((d) => (
                      <option
                        key={d.code}
                        value={d.code}
                        disabled={used.has(d.code) && d.code !== r.diseaseCode}
                      >
                        {d.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`New confirmed cases, row ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10000}
                    step={1}
                    required
                    value={r.newCases}
                    onChange={(e) => update(r.key, { newCases: e.target.value })}
                    className={inputClass}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Suspected cases, row ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10000}
                    step={1}
                    value={r.suspectedCases}
                    onChange={(e) => update(r.key, { suspectedCases: e.target.value })}
                    className={inputClass}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Notes, row ${i + 1}`}
                    maxLength={500}
                    value={r.notes}
                    onChange={(e) => update(r.key, { notes: e.target.value })}
                    className={inputClass}
                    placeholder="e.g. cluster in one taman"
                  />
                </td>
                <td className="py-1">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove row ${i + 1}`}
                      className="rounded-md px-2 py-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={rows.length >= diseases.length}
          onClick={() => setRows((rs) => [...rs, blank()])}
        >
          ＋ Add another disease
        </button>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Submitting…' : `Submit ${rows.length} row${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>

      <SubmitFeedback
        result={result}
        pending={pending}
        diseaseNames={names}
        onConfirmSpikes={() => submit(payload(), true)}
      />
    </form>
  );
}
