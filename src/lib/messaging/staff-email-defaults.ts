/**
 * Shared by the server actions and the client screens for staff booking messages (P7). No server
 * imports here, so client components can use it.
 */

/** Default subject for a staff message about a booking; staff can change it. */
export const STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT = 'A message about your booking at The Anchor'

export type StaffMessageChannel = 'email' | 'sms'

/** Email for a guest with a usable address, text otherwise. Staff can still switch. */
export function defaultStaffMessageChannel(option: { enabled: boolean; usable: boolean } | null | undefined): StaffMessageChannel {
  return option?.enabled && option.usable ? 'email' : 'sms'
}
