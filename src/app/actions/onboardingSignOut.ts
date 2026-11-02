'use server'

import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from './audit';

const SIGN_OUT_FAILED_MESSAGE = 'We could not sign you out. Please try again.';

/**
 * Sign out in this browser only, for the onboarding pages.
 *
 * The staff app's signOut (src/app/actions/auth.ts) uses Supabase's default scope, which ends the
 * account's sessions on every device. The onboarding Sign Out buttons are pressed on someone
 * else's browser (the "Signed In as Someone Else" card, often a manager's computer) or on a shared
 * venue device after a starter finishes, so that would also sign the manager out on their phone,
 * or the starter out on their own. This ends the session here and leaves every other one alone.
 */
export async function signOutOnThisDevice(): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.error('[onboarding] Could not sign out on this device:', { code: error.code, message: error.message });
      return { error: SIGN_OUT_FAILED_MESSAGE };
    }

    if (user) {
      try {
        await logAuditEvent({
          user_id: user.id,
          user_email: user.email ?? undefined,
          operation_type: 'logout',
          resource_type: 'auth',
          operation_status: 'success',
          additional_info: { scope: 'local', source: 'onboarding' },
        });
      } catch (auditError) {
        console.error('[onboarding] Sign out audit log failed:', auditError);
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[onboarding] Could not sign out on this device:', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: SIGN_OUT_FAILED_MESSAGE };
  }
}
