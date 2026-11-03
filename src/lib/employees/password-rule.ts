/**
 * The password rule for a new starter setting their password, from the workspace auth standard
 * (section 12): at least 12 characters, at most 72 bytes (the bcrypt limit, counted in bytes so a
 * long password is refused rather than silently cut short), and no rules about which characters.
 *
 * The standard wants one shared policy at src/lib/auth/password-policy.ts used by every surface
 * that sets a password. This repo has none yet, and the reset and change password forms still
 * allow 8. This file is the onboarding rule until that shared policy exists; move it there then.
 *
 * Pure, so the form and the server action apply the same check. The server is the one that counts.
 */
export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 72;

export function passwordError(password: string | null | undefined): string | null {
  const value = password ?? '';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Your password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return 'Your password is too long. Please choose a shorter one.';
  }
  return null;
}
