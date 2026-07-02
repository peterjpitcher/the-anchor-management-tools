/**
 * Who may issue an event-booking refund.
 *
 * Refunds move real money, so they're restricted to real managers: a user must
 * hold the `manager` or `super_admin` role AND must NOT be the shared
 * `manager@the-anchor.pub` login (a communal account we don't want issuing
 * refunds unattributably). Cancelling a booking WITHOUT a refund is unaffected.
 *
 * The decision is a pure function so it can be unit-tested; callers fetch the
 * user's email + role names (via the `get_user_roles` RPC) and pass them in.
 */

export const SHARED_MANAGER_EMAIL = (process.env.MANAGER_EMAIL || 'manager@the-anchor.pub')
  .trim()
  .toLowerCase()

export const EVENT_REFUND_ROLES = ['manager', 'super_admin'] as const

export function canIssueEventRefund(input: {
  email: string | null | undefined
  roleNames: readonly string[]
}): boolean {
  const email = (input.email || '').trim().toLowerCase()
  if (!email) return false
  if (email === SHARED_MANAGER_EMAIL) return false
  return input.roleNames.some((name) => (EVENT_REFUND_ROLES as readonly string[]).includes(name))
}
