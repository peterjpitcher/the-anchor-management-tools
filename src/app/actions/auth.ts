'use server'

import { AuthService } from '@/services/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getErrorMessage } from '@/lib/errors';
import { safePortalNextPath } from '@/lib/portal/next-path';

const PORTAL_ONLY_ROLES = new Set(['portal_shift_manager']);

type UserRoleRow = {
  roles: { name: string | null } | { name: string | null }[] | null;
};

function roleNameFromRow(row: UserRoleRow): string | null {
  if (Array.isArray(row.roles)) return row.roles[0]?.name ?? null;
  return row.roles?.name ?? null;
}

/** Where a portal-only user lands when they did not arrive from a saved portal link. */
const PORTAL_HOME = '/portal/shifts';

/**
 * Signs in with email and password. `next` is the page the person was trying to open before
 * they were asked to sign in (the login screen passes it on). A portal-only user goes back to
 * it when it is a safe link inside the portal (an emailed `/portal/training/...` link, say),
 * and to My Shifts otherwise. Everyone else is sent on by the login screen as before.
 */
export async function signIn(email: string, password: string, next?: string | null) {
  try {
    const result = await AuthService.signIn(email, password);

    if (result.success && result.userId) {
      // Portal-only employees have no management permissions. Route them to the
      // portal rather than /dashboard which they cannot use.
      const admin = createAdminClient();
      const { data: roles } = await admin
        .from('user_roles')
        .select('roles(name)')
        .eq('user_id', result.userId)
        .returns<UserRoleRow[]>();

      const roleNames = (roles ?? [])
        .map(roleNameFromRow)
        .filter((roleName): roleName is string => Boolean(roleName));

      if (roleNames.length === 0 || roleNames.every(roleName => PORTAL_ONLY_ROLES.has(roleName))) {
        // `next` comes from the browser, so it is checked strictly: a relative path inside
        // /portal/ only, never another site.
        return { success: true as const, redirectTo: safePortalNextPath(next) ?? PORTAL_HOME };
      }
    }

    return { success: true as const };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('Too many requests')) {
      return { error: 'Too many login attempts. Please try again later.' };
    }
    console.error('Sign in error:', error);
    return { error: message || 'An error occurred during sign in' };
  }
}

// Self-registration is disabled. This application is invite-only.
// Users must be invited by an administrator via the invite flow.
async function signUp(
  _email: string,
  _password: string,
  _firstName: string,
  _lastName: string
) {
  return { error: 'Registration is not available. Please contact an administrator.' };
}

export async function signOut() {
  try {
    return await AuthService.signOut();
  } catch (error: unknown) {
    console.error('Sign out error:', error);
    return { error: 'An error occurred during sign out' };
  }
}
