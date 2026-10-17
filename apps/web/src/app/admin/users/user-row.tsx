'use client';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { setUser } from '../actions';

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'user' | 'hospital_staff' | 'admin';
  active: boolean;
  facility_id: string | null;
  facility_name: string | null;
  is_anonymous: boolean;
  last_sign_in_at: string | null;
}

const select =
  'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

export function UserRow({
  user,
  facilities,
  isSelf,
}: {
  user: AdminUser;
  facilities: { id: string; name: string }[];
  isSelf: boolean;
}) {
  const [role, setRole] = useState(user.role);
  const [facility, setFacility] = useState(user.facility_id ?? '');
  const [active, setActive] = useState(user.active);
  const dirty =
    role !== user.role || facility !== (user.facility_id ?? '') || active !== user.active;

  return (
    <tr
      className={`border-t border-neutral-100 dark:border-neutral-900 ${user.active ? '' : 'opacity-60'}`}
    >
      <td className="py-2">
        <div className="font-medium">{user.full_name ?? '—'}</div>
        <div className="text-xs text-neutral-500">{user.email}</div>
      </td>
      <td className="py-2">
        <select
          className={select}
          value={role}
          disabled={isSelf}
          onChange={(e) => setRole(e.target.value as AdminUser['role'])}
          aria-label="Role"
        >
          <option value="user">User</option>
          <option value="hospital_staff">Hospital staff</option>
          <option value="admin">Admin</option>
        </select>
      </td>
      <td className="py-2">
        {role === 'hospital_staff' ? (
          <select
            className={select}
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            aria-label="Facility"
          >
            <option value="">Choose…</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </td>
      <td className="py-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            disabled={isSelf}
            onChange={(e) => setActive(e.target.checked)}
          />
          {active ? 'Active' : 'Deactivated'}
        </label>
      </td>
      <td className="py-2 text-xs text-neutral-500">
        {user.last_sign_in_at
          ? new Date(user.last_sign_in_at).toLocaleString('en-MY', {
              timeZone: 'Asia/Kuala_Lumpur',
            })
          : '—'}
      </td>
      <td className="py-2 text-right">
        {dirty && (
          <ActionButton
            action={() =>
              setUser(user.id, role, role === 'hospital_staff' ? facility || null : null, active)
            }
            confirm={!active ? 'Deactivate this account? They will lose portal access.' : undefined}
          >
            Save
          </ActionButton>
        )}
        {isSelf && <span className="text-xs text-neutral-500">You</span>}
      </td>
    </tr>
  );
}
