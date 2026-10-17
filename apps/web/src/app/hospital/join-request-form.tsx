'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { buttonClass, inputClass } from '@/components/ui';
import { requestFacilityAccess } from './actions';

export function JoinRequestForm({
  facilities,
  districts,
}: {
  facilities: { id: string; name: string; district: string; type: string }[];
  districts: string[];
}) {
  const router = useRouter();
  const [facilityId, setFacilityId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      action={(fd) =>
        start(async () => {
          const res = await requestFacilityAccess(fd);
          if (res.ok) router.refresh();
          else setError(res.message);
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Facility
        <select
          name="facility_id"
          value={facilityId}
          onChange={(e) => setFacilityId(e.target.value)}
          className={inputClass}
        >
          <option value="">My facility is not listed</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.district})
            </option>
          ))}
        </select>
      </label>

      {facilityId === '' && (
        <fieldset className="grid gap-3 rounded-lg border border-dashed border-neutral-300 p-4 sm:grid-cols-2 dark:border-neutral-700">
          <legend className="px-1 text-sm font-medium">New facility details</legend>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Name
            <input
              name="new_name"
              className={inputClass}
              placeholder="e.g. Klinik Kesihatan Sungai Siput"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select name="new_type" className={inputClass} defaultValue="clinic">
              <option value="hospital">Hospital</option>
              <option value="clinic">Clinic</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            District
            <select name="new_district" className={inputClass} defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {districts.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Facility phone or office email
            <input name="new_contact" className={inputClass} />
          </label>
        </fieldset>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Your role at the facility (optional)
        <input
          name="message"
          maxLength={500}
          className={inputClass}
          placeholder="e.g. Public health nurse, surveillance unit"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <button className={`${buttonClass} self-start`} disabled={pending}>
        {pending ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
