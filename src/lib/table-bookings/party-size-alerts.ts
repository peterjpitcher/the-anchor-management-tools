import { logAuditEvent } from '@/app/actions/audit'
import { escapeHtml } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { PREORDER_MANAGER_EMAIL } from './preorder-alerts'

export type GuestPartySizeChange = {
  tableBookingId: string
  bookingReference: string | null
  bookingDate: string | null
  previousPartySize: number
  newPartySize: number
  /**
   * The deposit transition's manual-review message, when the deposit was left for a person to check
   * (every seasonal booking, Christmas included). Null when the deposit needed nothing.
   */
  depositReview: string | null
  /** Christmas only: the guests who left, by seat, and the tiers of anyone who joined. */
  christmas?: { seatsRemoved: number[]; tiersAdded: number[] }
}

/**
 * Record a party-size change a guest made on their manage link (BK-053).
 *
 * Staff changes have always been audited; a guest's never were, and when the deposit transition
 * said a person had to check a seasonal deposit, the message was thrown away, so nobody looked. Now
 * every guest change writes an audit row, and a change that leaves the deposit for a person also
 * emails the manager with the reference, the old and new numbers and the reason. Counts and seat
 * numbers only: never a guest name or a dietary note.
 *
 * Never throws: the change is already saved, and an alert failure must not report it as failed.
 */
export async function recordGuestPartySizeChange(input: GuestPartySizeChange): Promise<void> {
  const reference = input.bookingReference || input.tableBookingId

  try {
    await logAuditEvent({
      // The guest's own change, which the booking page and the FOH floor show as made by the guest
      // (BK-091). The staff path writes 'table_booking.party_size_changed'.
      operation_type: 'table_booking.party_size_changed_by_guest',
      resource_type: 'table_booking',
      resource_id: input.tableBookingId,
      operation_status: 'success',
      old_values: { party_size: input.previousPartySize },
      new_values: { party_size: input.newPartySize },
      additional_info: {
        source: 'guest_manage_link',
        booking_reference: reference,
        previousPartySize: input.previousPartySize,
        newPartySize: input.newPartySize,
        ...(input.depositReview ? { deposit_review: true } : {}),
        ...(input.christmas ? { seats_removed: input.christmas.seatsRemoved, tiers_added: input.christmas.tiersAdded } : {}),
      },
    })
  } catch (auditError) {
    logger.error('Could not audit a guest party-size change', {
      error: auditError instanceof Error ? auditError : new Error(String(auditError)),
      metadata: { tableBookingId: input.tableBookingId },
    })
  }

  if (!input.depositReview) return

  let bookingUrl: string | null = null
  try {
    bookingUrl = `${getAppUrl()}/table-bookings/${input.tableBookingId}`
  } catch {
    bookingUrl = null
  }

  const summary =
    `A guest changed their booking${input.bookingDate ? ` for ${input.bookingDate}` : ''} from ${input.previousPartySize} ` +
    `to ${input.newPartySize} guests on their manage link. ${input.depositReview}`
  const christmasLines = input.christmas
    ? [
        input.christmas.seatsRemoved.length > 0 ? `Guests removed (seat numbers before the change): ${input.christmas.seatsRemoved.join(', ')}` : null,
        input.christmas.tiersAdded.length > 0 ? `Guests added, courses each: ${input.christmas.tiersAdded.join(', ')}` : null,
      ].filter((line): line is string => Boolean(line))
    : []

  const html = [
    `<p>${escapeHtml(summary)}</p>`,
    '<ul>',
    `<li><strong>Reference:</strong> ${escapeHtml(reference)}</li>`,
    `<li><strong>Party size:</strong> ${input.previousPartySize} to ${input.newPartySize}</li>`,
    ...christmasLines.map((line) => `<li>${escapeHtml(line)}</li>`),
    bookingUrl ? `<li><a href="${escapeHtml(bookingUrl)}">Open the booking</a></li>` : '',
    '</ul>',
  ].join('')

  try {
    const result = await sendEmail({
      to: PREORDER_MANAGER_EMAIL,
      subject: `Party size changed online, check the deposit: ${reference}`,
      html,
      text: [summary, `Reference: ${reference}`, ...christmasLines, bookingUrl ?? ''].filter(Boolean).join('\n'),
      tableBookingId: input.tableBookingId,
    })
    if (!result.success) {
      logger.error('Could not email the manager about a guest party-size change', {
        error: new Error(result.error || 'Email not sent'),
        metadata: { tableBookingId: input.tableBookingId },
      })
    }
  } catch (emailError) {
    logger.error('Could not email the manager about a guest party-size change', {
      error: emailError instanceof Error ? emailError : new Error(String(emailError)),
      metadata: { tableBookingId: input.tableBookingId },
    })
  }
}
