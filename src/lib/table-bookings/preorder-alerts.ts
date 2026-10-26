import { logAuditEvent } from '@/app/actions/audit'
import { escapeHtml } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * The inbox that hears about pre-orders a person has to look at. The same address the pre-order
 * escalation cron writes to (src/app/api/cron/preorder-reminders/route.ts).
 */
export const PREORDER_MANAGER_EMAIL = 'manager@the-anchor.pub'

export type PreorderSaveFailure = {
  tableBookingId: string
  bookingReference: string | null
  bookingDate: string
  requestedCovers: number
  savedCovers: number
  /** The library's message. Never a guest name or a dietary note: those are never in it. */
  error: string
}

/**
 * Tell the pub, visibly, that a guest booked with food choices and some or all of them did not save
 * (BK-059). Before this the booking route logged a warning, which is silent in production, so the
 * first anyone knew was the reminder or, for a late booking, the escalation after the form locked.
 *
 * Two records, so one failing does not lose the other: an audit row on the booking, and an email to
 * the manager naming the booking reference and the counts. Staff only: nothing here reaches the
 * guest, who is told by the website from the `preorder.saved` flag on the booking response.
 *
 * Never throws: the booking is already confirmed, and an alert failure must not turn into a failed
 * booking.
 */
export async function reportPreorderSaveFailure(input: PreorderSaveFailure): Promise<void> {
  const reference = input.bookingReference || input.tableBookingId

  try {
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'table_booking_preorder',
      resource_id: input.tableBookingId,
      operation_status: 'failure',
      error_message: input.error,
      additional_info: {
        booking_reference: reference,
        booking_date: input.bookingDate,
        requested_covers: input.requestedCovers,
        saved_covers: input.savedCovers,
        source: 'online_booking',
      },
    })
  } catch (auditError) {
    logger.error('Could not audit a failed pre-order save', {
      error: auditError instanceof Error ? auditError : new Error(String(auditError)),
      metadata: { tableBookingId: input.tableBookingId },
    })
  }

  let bookingUrl: string | null = null
  try {
    bookingUrl = `${getAppUrl()}/table-bookings/${input.tableBookingId}`
  } catch {
    bookingUrl = null
  }

  const summary =
    `A guest booked online for ${input.bookingDate} and sent food choices for ${input.requestedCovers} ` +
    `guest${input.requestedCovers === 1 ? '' : 's'}, but ${input.savedCovers} saved. The booking itself went through. ` +
    'Open the booking and check its pre-order; if choices are still missing, ring the guest and record them.'

  const html = [
    `<p>${escapeHtml(summary)}</p>`,
    '<ul>',
    `<li><strong>Reference:</strong> ${escapeHtml(reference)}</li>`,
    `<li><strong>Date:</strong> ${escapeHtml(input.bookingDate)}</li>`,
    `<li><strong>Choices sent:</strong> ${input.requestedCovers}</li>`,
    `<li><strong>Choices saved:</strong> ${input.savedCovers}</li>`,
    `<li><strong>Reason:</strong> ${escapeHtml(input.error)}</li>`,
    bookingUrl ? `<li><a href="${escapeHtml(bookingUrl)}">Open the booking</a></li>` : '',
    '</ul>',
  ].join('')

  try {
    const result = await sendEmail({
      to: PREORDER_MANAGER_EMAIL,
      subject: `Food choices did not save: ${reference}`,
      html,
      text: `${summary}\n\nReference: ${reference}\nReason: ${input.error}${bookingUrl ? `\n${bookingUrl}` : ''}`,
      tableBookingId: input.tableBookingId,
    })
    if (!result.success) {
      logger.error('Could not email the manager about a failed pre-order save', {
        error: new Error(result.error || 'Email not sent'),
        metadata: { tableBookingId: input.tableBookingId },
      })
    }
  } catch (emailError) {
    logger.error('Could not email the manager about a failed pre-order save', {
      error: emailError instanceof Error ? emailError : new Error(String(emailError)),
      metadata: { tableBookingId: input.tableBookingId },
    })
  }
}
