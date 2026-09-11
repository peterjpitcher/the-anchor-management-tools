import { createAdminClient } from '@/lib/supabase/admin'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { getEmailSuppressionStatus } from '@/lib/email/logging'
import { isEmailUsable, type EmailUsabilityState } from '@/lib/notifications/channel'

export { STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT } from '@/lib/messaging/staff-email-defaults'

/**
 * P7: staff free-text booking messages may go by email (flag staff_message_email_option).
 * `usable` decides the default: email for a guest with a usable address, text otherwise. Staff
 * still choose.
 */
export type StaffEmailOption = { enabled: boolean; usable: boolean }

export async function isStaffEmailOptionOn(): Promise<boolean> {
  return isMessagingFlagOn('staff_message_email_option')
}

/** A customer's address is usable when well formed, not marked bounced or deactivated, and not suppressed. */
export async function isCustomerEmailUsable(state: EmailUsabilityState | null | undefined): Promise<boolean> {
  if (!state?.email || !isEmailUsable(state)) return false
  return (await getEmailSuppressionStatus(state.email)) === 'clear'
}

/** Which of these addresses are on the suppression list. Null when the list cannot be read. */
export async function findSuppressedEmails(emails: string[]): Promise<Set<string> | null> {
  const normalised = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (normalised.length === 0) return new Set()
  const { data, error } = await (createAdminClient().from('email_suppressions') as any)
    .select('email')
    .in('email', normalised)
  if (error) return null
  return new Set(((data ?? []) as Array<{ email: string }>).map((row) => String(row.email).trim().toLowerCase()))
}

/** The option for one table booking guest, read with the admin client (the page has checked access). */
export async function resolveCustomerStaffEmailOption(customerId: string | null | undefined): Promise<StaffEmailOption> {
  if (!(await isStaffEmailOptionOn())) return { enabled: false, usable: false }
  if (!customerId) return { enabled: true, usable: false }
  const { data } = await (createAdminClient().from('customers') as any)
    .select('email, email_status, email_deactivated_at')
    .eq('id', customerId)
    .maybeSingle()
  return { enabled: true, usable: await isCustomerEmailUsable(data as EmailUsabilityState | null) }
}
