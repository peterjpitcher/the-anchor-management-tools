import { sendEmail } from '@/lib/email/emailService'

/**
 * The venue sign-off added to a staff message about a booking, so a guest can see who wrote and
 * how to answer (website SSOT §2). Not added to the customer-page email, which has never had one.
 */
const BOOKING_MESSAGE_SIGNATURE = [
  '',
  'The Anchor',
  'Horton Road, Stanwell Moor, Surrey, TW19 6AQ',
  '01753 682707 | manager@the-anchor.pub',
].join('\n')

export type StaffOneOffEmailResult =
  | { success: true; messageId: string | null; emailMessageId: string | null }
  | { success: false; error: string }

/**
 * One plain-text email written by a member of staff. Shared by the customer page's "Send email"
 * (sendCustomerEmail) and the booking message screens (P7), so every staff email goes the same way:
 * through sendEmail, which checks the suppression list and the kill switches and logs the send
 * to email_messages against the customer and, when given, the booking.
 *
 * Permission checks and audit rows stay with each caller, which knows its own gate.
 */
export async function sendStaffOneOffEmail(input: {
  to: string
  subject: string
  body: string
  customerId: string | null
  commType: string
  tableBookingId?: string | null
  privateBookingId?: string | null
  metadata?: Record<string, unknown>
  /** Adds the venue sign-off, for messages about a booking. */
  withBookingSignature?: boolean
}): Promise<StaffOneOffEmailResult> {
  const options: Parameters<typeof sendEmail>[0] = {
    to: input.to,
    subject: input.subject,
    text: input.withBookingSignature ? `${input.body}\n${BOOKING_MESSAGE_SIGNATURE}` : input.body,
    customerId: input.customerId,
    commType: input.commType,
  }
  if (input.tableBookingId) options.tableBookingId = input.tableBookingId
  if (input.privateBookingId) options.privateBookingId = input.privateBookingId
  if (input.metadata) options.metadata = input.metadata

  const result = await sendEmail(options)
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to send email' }
  }
  return { success: true, messageId: result.messageId ?? null, emailMessageId: result.emailMessageId ?? null }
}
