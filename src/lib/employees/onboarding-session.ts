/**
 * Who is allowed to keep using an onboarding invite link.
 *
 * The link is sent by email, so on its own it proves only that someone has the email. Until the
 * starter sets a password it is the only credential there is. Once they have, the spec
 * (tasks/employees-section-spec-v2-2026-08-18.md) says a forwarded link must stop working, so from
 * then on the link only works alongside a session for that account.
 *
 * createEmployeeAccount signs the browser in as soon as it has made and linked the account, so the
 * normal path carries a session from the password step onwards. (It did not once, and refusing
 * "no session" then blocked every step after the password for every new starter: that is why the
 * sign-in now happens there, not why this rule is relaxed.) Anyone who comes back later, on another
 * device or after the session ended, signs in on the onboarding page itself and carries on.
 *
 * The rule:
 *
 *   - No account yet: the invite token is the credential. Allow, whoever is signed in (a manager
 *     signed in on the same browser has no account here to clash with).
 *   - Account exists, nobody signed in: refuse, and ask them to sign in to carry on.
 *   - Account exists, somebody else signed in: refuse (a link forwarded to a colleague signed in on
 *     a shared device).
 *   - Account exists, signed in as this employee: allow.
 *
 * Kept as a pure function so it can be tested without standing up Supabase.
 */
export type OnboardingAccessCode = 'sign_in_required' | 'wrong_account';

export interface OnboardingAccessProblem {
  code: OnboardingAccessCode;
  message: string;
}

export const SIGN_IN_REQUIRED_MESSAGE =
  'You have already set a password for this profile. Sign in to carry on.';

export const WRONG_ACCOUNT_MESSAGE =
  'This onboarding link belongs to a different account. Please sign out and open the link again.';

export function resolveOnboardingSessionError(params: {
  /** employees.auth_user_id, null until the starter has created a password. */
  employeeAuthUserId: string | null;
  /** The signed in user's id, null when there is no session. */
  sessionUserId: string | null;
}): OnboardingAccessProblem | null {
  const { employeeAuthUserId, sessionUserId } = params;

  if (!employeeAuthUserId) {
    // No account yet, so the token is the only credential there is.
    return null;
  }

  if (!sessionUserId) {
    return { code: 'sign_in_required', message: SIGN_IN_REQUIRED_MESSAGE };
  }

  if (sessionUserId !== employeeAuthUserId) {
    return { code: 'wrong_account', message: WRONG_ACCOUNT_MESSAGE };
  }

  return null;
}
