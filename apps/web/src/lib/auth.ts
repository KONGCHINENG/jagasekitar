// Data Access Layer: the only place that turns the session into "who is this and what may they do".
import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export interface PortalUser {
  id: string;
  email: string | null;
  role: 'user' | 'hospital_staff' | 'admin';
  fullName: string | null;
  facility: { id: string; name: string; district: string; state: string; verified: boolean } | null;
  pendingRequest: boolean;
}

/** The signed-in portal user, or null. Reads cookies: call inside Suspense or an action. */
export async function getPortalUser(): Promise<PortalUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc('my_portal_profile').maybeSingle<{
    role: PortalUser['role'];
    full_name: string | null;
    facility_id: string | null;
    facility_name: string | null;
    facility_district: string | null;
    facility_state: string | null;
    facility_verified: boolean | null;
    pending_request: boolean;
  }>();
  if (!data) return null; // deactivated profile
  return {
    id: user.id,
    email: user.email ?? null,
    role: data.role,
    fullName: data.full_name,
    facility: data.facility_id
      ? {
          id: data.facility_id,
          name: data.facility_name!,
          district: data.facility_district!,
          state: data.facility_state!,
          verified: !!data.facility_verified,
        }
      : null,
    pendingRequest: data.pending_request,
  };
}

export async function requireUser(next = '/hospital'): Promise<PortalUser> {
  const user = await getPortalUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Staff with a verified facility (or admins). Others go to the dashboard to request access. */
export async function requireReportingStaff(): Promise<
  PortalUser & { facility: NonNullable<PortalUser['facility']> }
> {
  const user = await requireUser();
  if (user.role === 'hospital_staff' && user.facility?.verified) return user as never;
  redirect('/hospital');
}

export async function requireAdmin(): Promise<PortalUser> {
  const user = await requireUser('/admin');
  if (user.role !== 'admin') redirect('/hospital');
  return user;
}
