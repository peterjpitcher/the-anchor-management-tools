/**
 * Permission inheritance helpers for the private-bookings module.
 *
 * The `manage` action is the "super-permission" — it implies all standard
 * CRUD actions (`view`, `edit`, `create`, `delete`, `send`). Specific
 * high-risk actions like `manage_deposits`, `manage_spaces`,
 * `manage_catering`, `manage_vendors`, `approve_sms`, `view_sms_queue`,
 * and `refund` are NOT implied by `manage` and must be granted explicitly.
 */

/**
 * Check if a set of granted actions satisfies a required action.
 * `manage` implies all other standard actions for private bookings.
 */
export function hasPrivateBookingPermission(
  actions: Set<string>,
  required: string
): boolean {
  return actions.has(required) || actions.has('manage')
}
