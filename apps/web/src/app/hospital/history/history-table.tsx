'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { buttonClass, inputClass, secondaryButtonClass } from '@/components/ui';
import { canEditDirectly } from '@/lib/reports';
import { editReport } from '../actions';

export interface HistoryRow {
  id: string;
  reportDate: string;
  disease: string;
  newCases: number;
  suspectedCases: number;
  notes: string | null;
  status: 'submitted' | 'verified' | 'rejected';
  flagged: boolean;
  createdAt: string;
  editPending: boolean;
}

const STATUS = {
  submitted: { label: 'Submitted', className: 'text-neutral-700 dark:text-neutral-300', icon: '○' },
  verified: { label: 'Verified', className: 'text-green-700 dark:text-green-400', icon: '✓' },
  rejected: { label: 'Rejected', className: 'text-red-700 dark:text-red-400', icon: '✕' },
} as const;

export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (rows.length === 0)
    return <p className="text-sm text-neutral-600">No reports in the last 60 days.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-neutral-600 dark:text-neutral-400">
          <tr>
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Disease</th>
            <th className="pb-2 text-right font-medium">Confirmed</th>
            <th className="pb-2 text-right font-medium">Suspected</th>
            <th className="pb-2 font-medium">Notes</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            editing === r.id ? (
              <EditRow key={r.id} row={r} onDone={() => setEditing(null)} />
            ) : (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-2 whitespace-nowrap">{r.reportDate}</td>
                <td className="py-2">{r.disease}</td>
                <td className="py-2 text-right tabular-nums">{r.newCases}</td>
                <td className="py-2 text-right tabular-nums">{r.suspectedCases}</td>
                <td className="max-w-56 truncate py-2 text-neutral-600 dark:text-neutral-400">
                  {r.notes}
                </td>
                <td className="py-2 whitespace-nowrap">
                  <span className={STATUS[r.status].className}>
                    {STATUS[r.status].icon} {STATUS[r.status].label}
                  </span>
                  {r.flagged && r.status === 'submitted' && (
                    <span className="ml-2 text-amber-700 dark:text-amber-400">▲ Flagged</span>
                  )}
                  {r.editPending && (
                    <span className="ml-2 text-cyan-800 dark:text-cyan-300">Change requested</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {!r.editPending && r.status !== 'rejected' && (
                    <button
                      className="text-pink-800 hover:underline dark:text-pink-300"
                      onClick={() => setEditing(r.id)}
                    >
                      {r.status === 'submitted' && canEditDirectly(r.createdAt)
                        ? 'Edit'
                        : 'Request change'}
                    </button>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({ row, onDone }: { row: HistoryRow; onDone: () => void }) {
  const router = useRouter();
  const direct = row.status === 'submitted' && canEditDirectly(row.createdAt);
  const [newCases, setNewCases] = useState(String(row.newCases));
  const [suspected, setSuspected] = useState(String(row.suspectedCases));
  const [notes, setNotes] = useState(row.notes ?? '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <tr className="border-t border-neutral-100 bg-pink-50/50 dark:border-neutral-900 dark:bg-pink-950/30">
      <td colSpan={7} className="py-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await editReport(
                row.id,
                { newCases, suspectedCases: suspected, notes },
                reason,
              );
              setMessage(res.message);
              if (res.ok) {
                router.refresh();
                setTimeout(onDone, 800);
              }
            });
          }}
        >
          <span className="text-sm font-medium">
            {row.reportDate} · {row.disease}
          </span>
          <label className="flex w-28 flex-col gap-1 text-xs">
            Confirmed
            <input
              type="number"
              min={0}
              step={1}
              value={newCases}
              onChange={(e) => setNewCases(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-xs">
            Suspected
            <input
              type="number"
              min={0}
              step={1}
              value={suspected}
              onChange={(e) => setSuspected(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
            Notes
            <input
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </label>
          {!direct && (
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
              Reason for the change (sent to an admin)
              <input
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputClass}
              />
            </label>
          )}
          <button className={buttonClass} disabled={pending}>
            {direct ? 'Save' : 'Send for approval'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onDone}>
            Cancel
          </button>
          {message && (
            <p role="status" className="w-full text-sm">
              {message}
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}
