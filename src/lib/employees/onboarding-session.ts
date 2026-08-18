/**
 * Who is allowed to keep using an onboarding invite link.
 *
 * Creating a password calls createEmployeeAccount, which makes the auth user with the admin
 * client and links it to the employee record. It deliberately does NOT sign the browser in, so
 * for the rest of the flow there is no session cookie even though employees.auth_user_id is now
 * set. Treating "no session" as "wrong person" blocks every step after the password, which is
 * every new starter.
 *
 * The rule, therefore:
 *
 *   - Nobody signed in: the invite token is the credential, as it always has been. Allow.
 *   - Somebody signed in and they are this employee: allow.
 *   - Somebody signed in and they are NOT this employee: refuse.
 *
 * That closes the case this was written for, a link forwarded to a colleague who is already
 * signed in on a shared device, without standing in front of the normal path.
 *
 * Kept as a pure function so it can be tested without standing up Supabase.
 */
export function resolveOnboardingSessionError(params: {
  /** employees.auth_user_id, null until the starter has created a password. */
  employeeAuthUserId: string | null;
  /** The signed in user's id, null when there is no session. */
  sessionUserId: string | null;
}): string | null {
  const { employeeAuthUserId, sessionUserId } = params;

  if (!employeeAuthUserId) {
    // No account yet, so the token is the only credential there is.
    return null;
  }

  if (!sessionUserId) {
    // The normal state of this flow, not a failure.
    return null;
  }

  if (sessionUserId !== employeeAuthUserId) {
    return 'This onboarding link belongs to a different account. Please sign out and open the link again.';
  }

  return null;
}
