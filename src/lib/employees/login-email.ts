/**
 * What saving a new email address on an employee record means for their login.
 *
 * A login is made with the address on the record, and nothing used to move it when staff
 * corrected that address. The record and the login then disagreed: the starter at the new
 * address was told they had already set a password they never set, a password reset went
 * nowhere, and whoever held the old address kept the way in (owner decision, 2 November 2026).
 *
 * - A starter still onboarding: refused. They set that password at the old address, which may
 *   not be theirs, so the record is deleted and they are invited again.
 * - Anyone who has started work: the login moves with the record.
 * - A login that also opens the management app (its user holds any row in user_roles) moves
 *   only for someone who can manage user roles, or for the person themselves. Otherwise anyone
 *   with employees:edit could point a super_admin's login at an address they control and then
 *   reset its password. Staff portal logins with no role keep moving for any editor.
 */

/** Shown to staff when they try to change the email of a starter who has already set a password. */
export const ONBOARDING_LOGIN_EMAIL_REFUSAL =
  'This starter has already set a password using their current email address, so it cannot be changed here. To use a new address, delete this record and invite them again.'

/** Shown to an editor who cannot manage user roles when the login also opens the management app. */
export const APP_LOGIN_EMAIL_REFUSAL =
  'This person signs in to the management app with this email address. Only someone who can manage user roles can change it.'

/** Shown when the login's roles could not be read, so it is not known who may move it. */
export const APP_LOGIN_CHECK_FAILED =
  'We could not check how this person signs in, so the new email address was not saved. Please try again.'

/**
 * Who is saving the record, worked out by the action (the service has no signed-in user).
 * Left out, nobody counts as allowed, so a login with a role is never moved.
 */
export type LoginMoveAuthority = {
  /** The signed-in user saving the record. */
  editorUserId: string | null
  /** Whether that user holds users:manage_roles. */
  canManageRoles: boolean
}

export const NO_LOGIN_MOVE_AUTHORITY: LoginMoveAuthority = { editorUserId: null, canManageRoles: false }

/**
 * True when this editor may move the login whatever roles it holds: they can manage user roles,
 * or it is their own login. Anyone else needs the login's roles read first.
 */
export function mayMoveAnyLogin(authority: LoginMoveAuthority, authUserId: string): boolean {
  if (authority.canManageRoles) return true
  return Boolean(authority.editorUserId) && authority.editorUserId === authUserId
}

export type LoginEmailChange =
  | { action: 'none' }
  | { action: 'refuse' }
  | { action: 'move'; authUserId: string }

/** Compared as the login stores it: trimmed and lower case. */
export function normaliseLoginEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function loginEmailChange(
  employee: { status: string | null; auth_user_id?: string | null; email_address?: string | null },
  newEmail: string
): LoginEmailChange {
  const authUserId = employee.auth_user_id ?? null
  if (!authUserId) return { action: 'none' }
  // Only the case or spacing changed: the login already answers to this address.
  if (normaliseLoginEmail(employee.email_address) === normaliseLoginEmail(newEmail)) return { action: 'none' }
  if (employee.status === 'Onboarding') return { action: 'refuse' }
  return { action: 'move', authUserId }
}

/**
 * Supabase says an address already has a login with the code `email_exists` (or
 * `user_already_exists`). The message is kept as a fallback for older servers.
 */
export function isLoginEmailTakenError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('already been registered') || message.includes('already registered')
}
