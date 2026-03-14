'use server'

import { AuthService } from '@/services/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function signIn(email: string, password: string) {
  try {
    const result = await AuthService.signIn(email, password);

    if (result.success && result.userId) {
      // Portal-only employees have no RBAC roles. Route them to the portal
      // rather than /dashboard which they cannot use.
      const admin = createAdminClient();
      const { data: roles } = await admin
        .from('user_roles')
        .select('role_id')
        .eq('user_id', result.userId)
        .limit(1);

      if (!roles || roles.length === 0) {
        return { success: true as const, redirectTo: '/portal/shifts' };
      }
    }

    return { success: true as const };
  } catch (error: any) {
    if (error.message.includes('Too many requests')) {
      return { error: 'Too many login attempts. Please try again later.' };
    }
    console.error('Sign in error:', error);
    return { error: error.message || 'An error occurred during sign in' };
  }
}

// Self-registration is disabled. This application is invite-only.
// Users must be invited by an administrator via the invite flow.
export async function signUp(
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
  } catch (error: any) {
    console.error('Sign out error:', error);
    return { error: 'An error occurred during sign out' };
  }
}
