'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addFloodEvent } from '../actions';

const input =
  'rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** A real past flood an admin checked (it's saved as verified). */
export function AddEventForm({ districts }: { districts: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message?: string } | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      action={(form) =>
        start(async () => {
          const res = await addFloodEvent({
            district: form.get('district'),
            startDate: form.get('startDate'),
            endDate: form.get('endDate'),
            description: form.get('description'),
            sourceUrl: form.get('sourceUrl'),
          });
          setMsg(res);
          if (res.ok) router.refresh();
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        District
        <select name="district" required className={input} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {districts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        First day
        <input type="date" name="startDate" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Last day
        <input type="date" name="endDate" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm lg:col-span-2">
        Source link
        <input type="url" name="sourceUrl" placeholder="https://…" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-4">
        What happened
        <input
          name="description"
          maxLength={300}
          placeholder="e.g. 300 evacuees in Bagan Serai relief centres"
          className={input}
        />
      </label>
      <div className="flex items-end gap-3">
        <button
          disabled={pending}
          className="rounded-md bg-cyan-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-900 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Add event'}
        </button>
      </div>
      {msg?.message && (
        <p
          className={`text-sm sm:col-span-2 lg:col-span-5 ${msg.ok ? 'text-green-700' : 'text-red-700'}`}
        >
          {msg.message}
        </p>
      )}
    </form>
  );
}
