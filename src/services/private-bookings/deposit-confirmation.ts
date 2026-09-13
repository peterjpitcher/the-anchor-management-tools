import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatPrivateBookingAmount } from '@/lib/private-bookings/messages'
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import {
  PRIVATE_BOOKING_MESSAGE_COLUMNS,
  formatPrivateBookingSmsDate,
  renderPrivateBookingMessage,
  type CatalogueBooking,
} from '@/lib/private-bookings/message-catalogue'
import { buildPrivateBookingPortalUrl } from '@/lib/private-bookings/booking-token'
import { resolveConfirmationHoldExpiry } from '@/lib/private-bookings/deposit-confirmation'

type AdminClient = ReturnType<typeof createAdminClient>
type ConfirmationBooking = CatalogueBooking & { deposit_confirmed_at: string | null }

const CONFIRMATION_COLUMNS = `${PRIVATE_BOOKING_MESSAGE_COLUMNS}, deposit_confirmed_at`

/**
 * What Confirm deposit did, in words staff can act on.
 * - sent: the deposit is confirmed and the request reached the guest by the channel named.
 * - already_confirmed: someone (or a double click) got there first; nothing more was sent.
 * - not_sent: nothing reached the guest. The booking is put back to "deposit to be confirmed"
 *   (restored) so staff can fix the contact details and confirm again.
 */
export type ConfirmDepositOutcome =
  | {
      status: 'sent'
      channel: 'email' | 'sms'
      amount: number
      holdExpiry: string | null
      emailError: string | null
      message: string
    }
  | { status: 'already_confirmed'; message: string }
  | { status: 'not_sent'; reason: string; restored: boolean; message: string }

/** Stops a confirmation before anything has changed or been sent. The message is for staff. */
export class DepositConfirmationError extends Error {}

const ALREADY_CONFIRMED: ConfirmDepositOutcome = {
  status: 'already_confirmed',
  message: 'The deposit was already confirmed, so nothing more was sent.',
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isMissingColumn(error: { code?: string | null; message?: string | null } | null): boolean {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('deposit_confirmed') && (text.includes('column') || text.includes('42703') || text.includes('pgrst204'))
}

async function loadBooking(db: AdminClient, bookingId: string): Promise<ConfirmationBooking> {
  const { data, error } = await (db.from('private_bookings') as any)
    .select(CONFIRMATION_COLUMNS)
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    logger.error('Confirm deposit: booking could not be loaded', {
      metadata: { bookingId, code: error.code ?? null, message: error.message ?? null },
    })
    throw new DepositConfirmationError(
      isMissingColumn(error)
        ? 'Deposit confirmation needs a database change that has not been applied yet, so nothing was sent.'
        : 'The booking could not be loaded, so nothing was sent. Please try again.'
    )
  }
  if (!data) throw new DepositConfirmationError('Booking not found')
  return data as ConfirmationBooking
}

/** Which channel reached the guest, from the messenger's answer. */
function reachedChannel(result: Record<string, unknown>): 'email' | 'sms' | null {
  if (result.channel === 'email' || result.channel === 'sms') return result.channel
  // The messenger names the channel whenever it tried an email. With no usable address it hands
  // back the text queue's own answer, which has no channel.
  if (result.channel === null || result.requiresApproval === true) return null
  return result.sent === true || result.suppressed === true ? 'sms' : null
}

function failureReason(result: Record<string, unknown>): string {
  const emailError = typeof result.emailError === 'string' ? result.emailError : null
  const smsError = typeof result.error === 'string' ? result.error : null
  const noNumber = smsError === 'No phone number available for SMS'

  if (emailError) {
    if (noNumber) return `the email failed (${emailError}) and there is no mobile number to text`
    return smsError ? `the email failed (${emailError}) and the text failed too (${smsError})` : `the email failed (${emailError})`
  }
  if (noNumber) return 'the guest has no usable email address and no mobile number'
  if (result.requiresApproval === true) return 'the text is waiting for approval'
  return smsError ? `the guest has no usable email address and the text failed (${smsError})` : 'the message could not be sent'
}

function describeDeadline(holdExpiry: string | null): string {
  return holdExpiry ? `, due by ${formatPrivateBookingSmsDate(holdExpiry)}` : ''
}

async function writeTimelineRow(
  db: AdminClient,
  row: {
    bookingId: string
    action: 'deposit_confirmed' | 'deposit_confirmation_failed'
    previousAmount: number
    amount: number
    description: string
    metadata: Record<string, unknown>
    performedBy: string
  }
): Promise<void> {
  try {
    const { error } = await (db.from('private_booking_audit') as any).insert({
      booking_id: row.bookingId,
      action: row.action,
      field_name: 'deposit_amount',
      // Old and new only when the amount moved, so the timeline shows the change; otherwise the
      // description says what happened.
      old_value: row.previousAmount !== row.amount ? String(row.previousAmount) : null,
      new_value: row.previousAmount !== row.amount ? String(row.amount) : null,
      metadata: { description: row.description, ...row.metadata },
      performed_by: row.performedBy,
    })
    if (error) {
      logger.error('Confirm deposit: timeline row not written', {
        metadata: { bookingId: row.bookingId, action: row.action, code: error.code ?? null, message: error.message ?? null },
      })
    }
  } catch (error) {
    logger.error('Confirm deposit: timeline row not written', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: row.bookingId, action: row.action },
    })
  }
}

/**
 * Puts the booking back exactly as it was before this confirmation, and only if the confirmation
 * is still this one. Returns false if that could not be done.
 */
async function restoreUnconfirmed(db: AdminClient, before: ConfirmationBooking, confirmedAt: string): Promise<boolean> {
  try {
    const { data, error } = await (db.from('private_bookings') as any)
      .update({
        deposit_confirmed_at: null,
        deposit_confirmed_by: null,
        deposit_amount: before.deposit_amount,
        hold_expiry: before.hold_expiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', before.id)
      .eq('deposit_confirmed_at', confirmedAt)
      .select('id')
      .maybeSingle()
    if (error || !data) {
      logger.error('Confirm deposit: the booking could not be put back to deposit to be confirmed', {
        metadata: { bookingId: before.id, code: error?.code ?? null, message: error?.message ?? null },
      })
      return false
    }
    return true
  } catch (error) {
    logger.error('Confirm deposit: the booking could not be put back to deposit to be confirmed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: before.id },
    })
    return false
  }
}

/**
 * Confirm deposit (owner decision, 11 September 2026; flag private_booking_deposit_confirmation,
 * checked by the calling action).
 *
 * Records the confirmed amount, who confirmed it and when, sets the hold expiry
 * (resolveConfirmationHoldExpiry: a future hold is kept, otherwise the creation rule), and sends
 * the guest one deposit request through the private booking messenger: by email when the booking
 * has a usable address (its contact email, then the customer's), otherwise by text, and by text if
 * the email fails. The email says the deposit can be paid in cash at the bar or by PayPal, with
 * the link to the guest's booking page where one button pays it.
 *
 * One send per confirmation: the booking is claimed with a conditional update that only succeeds
 * while it is still unconfirmed, so a double click or a second member of staff gets
 * already_confirmed and sends nothing. If nothing reaches the guest, the claim is undone so the
 * deposit shows as still to be confirmed, and staff are told why.
 *
 * Throws DepositConfirmationError when it cannot start; nothing has changed then.
 */
export async function confirmDeposit(input: {
  bookingId: string
  amount: number
  confirmedBy: string
  now?: Date
  client?: AdminClient
}): Promise<ConfirmDepositOutcome> {
  const db = input.client ?? createAdminClient()
  const now = input.now ?? new Date()

  const booking = await loadBooking(db, input.bookingId)
  if (booking.deposit_confirmed_at) return ALREADY_CONFIRMED
  if (booking.status !== 'draft' && booking.status !== 'confirmed') {
    throw new DepositConfirmationError('Only a draft or confirmed booking can have its deposit confirmed.')
  }
  if (booking.deposit_paid_date) throw new DepositConfirmationError('The deposit has already been paid.')
  if (booking.deposit_waived === true) {
    throw new DepositConfirmationError('The deposit has been waived, so there is nothing to confirm.')
  }

  const amount = roundMoney(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DepositConfirmationError('Enter a deposit amount greater than £0. To waive the deposit, set it to £0 with a waiver instead.')
  }

  const holdExpiry = resolveConfirmationHoldExpiry(booking, now)
  if (holdExpiry && Date.parse(holdExpiry) <= now.getTime()) {
    throw new DepositConfirmationError('The deposit deadline would already have passed because the event is today or has passed. Check the event date first.')
  }

  const paymentLink = buildPrivateBookingPortalUrl(booking.id)
  if (!paymentLink) {
    throw new DepositConfirmationError('The PayPal link could not be made (NEXT_PUBLIC_APP_URL is not set), so nothing was confirmed or sent.')
  }

  // Built once before anything changes, so a booking whose request cannot be built is never marked
  // confirmed. The send below builds it again from the confirmed row, which is what a bounce reads.
  if (!renderPrivateBookingMessage('deposit_request', { booking: { ...booking, deposit_amount: amount, hold_expiry: holdExpiry }, now, paymentLink })) {
    throw new DepositConfirmationError('The deposit request could not be written for this booking, so nothing was sent.')
  }

  const previousAmount = roundMoney(Number(booking.deposit_amount ?? 0))
  const confirmedAt = now.toISOString()
  const { data: claimed, error: claimError } = await (db.from('private_bookings') as any)
    .update({
      deposit_confirmed_at: confirmedAt,
      deposit_confirmed_by: input.confirmedBy,
      deposit_amount: amount,
      hold_expiry: holdExpiry,
      // A PayPal order made for a different amount must not be reused (as updateDepositAmount does).
      ...(previousAmount !== amount ? { paypal_deposit_order_id: null } : {}),
      updated_at: confirmedAt,
    })
    .eq('id', booking.id)
    .is('deposit_confirmed_at', null)
    .is('deposit_paid_date', null)
    .in('status', ['draft', 'confirmed'])
    .select(CONFIRMATION_COLUMNS)
    .maybeSingle()

  if (claimError) {
    logger.error('Confirm deposit: the confirmation could not be saved', {
      metadata: { bookingId: booking.id, code: claimError.code ?? null, message: claimError.message ?? null },
    })
    throw new DepositConfirmationError(`The deposit could not be confirmed (${claimError.message ?? 'database error'}), so nothing was sent.`)
  }
  if (!claimed) {
    const latest = await loadBooking(db, booking.id)
    if (latest.deposit_confirmed_at) return ALREADY_CONFIRMED
    throw new DepositConfirmationError('The booking changed while you were confirming it, so nothing was sent. Refresh the page and try again.')
  }

  const confirmed = claimed as ConfirmationBooking
  const message = renderPrivateBookingMessage('deposit_request', { booking: confirmed, now, paymentLink })
  let result: Record<string, unknown>
  if (!message) {
    result = { error: 'the deposit request could not be written' }
  } else {
    try {
      result = (await sendPrivateBookingMessage({
        sms: {
          booking_id: confirmed.id,
          trigger_type: 'deposit_request',
          template_key: message.templateKey,
          message_body: message.smsBody,
          customer_phone: confirmed.contact_phone,
          customer_name: confirmed.customer_name || [confirmed.customer_first_name, confirmed.customer_last_name].filter(Boolean).join(' '),
          customer_id: confirmed.customer_id ?? undefined,
          created_by: input.confirmedBy,
          priority: 1,
          metadata: {
            template: message.templateKey,
            deposit_amount: amount,
            hold_expiry_date: holdExpiry ? holdExpiry.slice(0, 10) : null,
            deposit_confirmed_at: confirmedAt,
          },
        },
        booking: confirmed,
        email: message.email,
        // One email per confirmation: a later confirmation (after one that reached nobody was
        // undone) is a new request.
        windowKey: `confirmed-${confirmedAt}`,
        facts: message.facts,
        // The owner asked for this one by email whatever private_booking_email_first says.
        emailFirst: true,
      })) as unknown as Record<string, unknown>
    } catch (error) {
      logger.error('Confirm deposit: sending the deposit request threw', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId: confirmed.id },
      })
      result = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  const channel = reachedChannel(result)
  const emailError = typeof result.emailError === 'string' ? result.emailError : null
  const deadline = describeDeadline(holdExpiry)

  if (channel) {
    const how =
      channel === 'email'
        ? 'The deposit request was emailed to the guest.'
        : emailError
          ? `The email failed (${emailError}), so the deposit request was sent by text instead.`
          : 'The guest has no usable email address, so the deposit request was sent by text.'
    const staffMessage = `Deposit confirmed at ${formatPrivateBookingAmount(amount)}${deadline}. ${how}`
    await writeTimelineRow(db, {
      bookingId: confirmed.id,
      action: 'deposit_confirmed',
      previousAmount,
      amount,
      description: staffMessage,
      metadata: { channel, email_error: emailError, hold_expiry: holdExpiry, confirmed_at: confirmedAt },
      performedBy: input.confirmedBy,
    })
    return { status: 'sent', channel, amount, holdExpiry, emailError, message: staffMessage }
  }

  const reason = failureReason(result)
  const restored = await restoreUnconfirmed(db, booking, confirmedAt)
  const staffMessage = restored
    ? `Nothing was sent: ${reason}. The deposit is still to be confirmed. Check the guest's email address and mobile number, then confirm again.`
    : `Nothing reached the guest: ${reason}. The booking could not be put back to "deposit to be confirmed", so it now shows the deposit as confirmed. Contact the guest yourself.`
  await writeTimelineRow(db, {
    bookingId: confirmed.id,
    action: 'deposit_confirmation_failed',
    previousAmount,
    amount,
    description: staffMessage,
    metadata: { reason, restored, email_error: emailError, sms_error: typeof result.error === 'string' ? result.error : null },
    performedBy: input.confirmedBy,
  })
  return { status: 'not_sent', reason, restored, message: staffMessage }
}
