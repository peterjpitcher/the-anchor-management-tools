/**
 * What a table booking email-first message records on its notification_deliveries row, so the
 * bounce fallback (P4, flag bounce_sms_fallback) can rebuild the text the email replaced.
 *
 * The row is written by notifyCustomer when the delivery is created, before anything is sent, so
 * a bounce that arrives seconds later always finds it. It carries ids and facts only: the booking
 * id, the template key, which message it is, how its link was made, and the facts the message
 * states (dates, times, party size, amounts, the refund outcome). Never a name, a phone number,
 * an email address, the message body, a link or a token.
 *
 * Each facts builder below is called twice: by the sender with the values it put in the message,
 * and by the fallback with the booking as it is now. The fallback sends nothing when the two differ.
 */

import { parseLondonDateTimeLocal } from '@/lib/dateUtils'
import type { FallbackBookingFacts } from '@/lib/notifications/delayed-fallback/types'
import type { TableBookingCancellationRefundResult } from '@/lib/table-bookings/guest-texts'

/** Written as `source` on every table booking email-first delivery row. */
export const TABLE_BOOKING_EMAIL_FIRST_SOURCE = 'table_booking_email_first'

/** The table booking messages that go by email first and can fall back to a text after a bounce. */
export type TableBookingFallbackMessage =
  | 'cancellation'
  | 'deposit_confirmed'
  | 'party_size_deposit_request'
  | 'confirm_reminder'
  | 'preorder_reminder'

/** The template key each message is sent under. */
export const TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS: Record<TableBookingFallbackMessage, string> = {
  cancellation: 'table_booking_cancelled',
  deposit_confirmed: 'table_booking_deposit_confirmed',
  party_size_deposit_request: 'table_booking_pending_payment',
  confirm_reminder: 'table_booking_confirm_reminder',
  preorder_reminder: 'table_booking_preorder_reminder',
}

/**
 * How the message's link was made. A short link can be found again without side effects; a
 * full-length link carries a token that is never stored, so it cannot be rebuilt; 'none' means the
 * message went without one.
 */
export type TableBookingFallbackLink = 'short_link' | 'full_url' | 'none'

export type TableBookingFallbackDetails = {
  message: TableBookingFallbackMessage
  facts: FallbackBookingFacts
  /** Only for the messages that carry a link. */
  link?: TableBookingFallbackLink
}

/** The metadata notifyCustomer writes on the delivery row for one table booking message. */
export function buildTableBookingDeliveryMetadata(input: {
  tableBookingId: string
  templateKey: string
  fallback: TableBookingFallbackDetails
}): Record<string, unknown> {
  return {
    source: TABLE_BOOKING_EMAIL_FIRST_SOURCE,
    table_booking_id: input.tableBookingId,
    template_key: input.templateKey,
    fallback_message: input.fallback.message,
    booking_facts: input.fallback.facts,
    ...(input.fallback.link ? { fallback_link: input.fallback.link } : {}),
  }
}

const MESSAGES = new Set<string>(Object.keys(TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS))
const LINKS = new Set<string>(['short_link', 'full_url', 'none'])

/** Reads back what buildTableBookingDeliveryMetadata wrote. Null without a table booking id. */
export function readTableBookingDeliveryMetadata(metadata: Record<string, unknown> | null | undefined): {
  tableBookingId: string
  message: TableBookingFallbackMessage | null
  facts: Record<string, unknown> | null
  link: TableBookingFallbackLink | null
} | null {
  const tableBookingId = metadata?.table_booking_id
  if (typeof tableBookingId !== 'string' || !tableBookingId) return null
  const message = metadata?.fallback_message
  const facts = metadata?.booking_facts
  const link = metadata?.fallback_link
  return {
    tableBookingId,
    message: typeof message === 'string' && MESSAGES.has(message) ? (message as TableBookingFallbackMessage) : null,
    facts: facts && typeof facts === 'object' && !Array.isArray(facts) ? (facts as Record<string, unknown>) : null,
    link: typeof link === 'string' && LINKS.has(link) ? (link as TableBookingFallbackLink) : null,
  }
}

// ---------------------------------------------------------------------------
// Comparable values
// ---------------------------------------------------------------------------

/** HH:MM from a stored time such as 19:30:00. */
function clockTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, 5) : null
}

/** A timestamp as one ISO form, so 18:00:00+00:00 and 18:00:00.000Z compare equal. */
export function isoInstant(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = parseLondonDateTimeLocal(value)
  return parsed ? parsed.toISOString() : null
}

function yesNo(value: boolean): 'yes' | 'no' {
  return value ? 'yes' : 'no'
}

/**
 * When a table booking starts, as an ISO instant: its London date and time converted to UTC, else
 * its stored start. Null when neither can be read.
 */
export function tableBookingStartsAt(booking: {
  booking_date?: string | null
  booking_time?: string | null
  start_datetime?: string | null
}): string | null {
  const date = booking.booking_date?.slice(0, 10) || null
  const time = clockTime(booking.booking_time)
  if (date && time) {
    const wallTime = parseLondonDateTimeLocal(`${date}T${time}`)
    if (wallTime) return wallTime.toISOString()
  }
  return isoInstant(booking.start_datetime)
}

// ---------------------------------------------------------------------------
// The facts each message states
// ---------------------------------------------------------------------------

/** The date and the refund outcome, which the refund sentence is rebuilt from. */
export function cancellationFacts(input: {
  bookingDate: string | null
  refundResult: TableBookingCancellationRefundResult
}): FallbackBookingFacts {
  const refund = input.refundResult
  return {
    booking_date: input.bookingDate ?? null,
    refund_outcome: refund.refunded ? 'refunded' : refund.reason,
    refund_tier: refund.refunded ? refund.tier : null,
    refund_amount_pence: refund.refunded ? refund.amountPence : null,
    deposit_owed: refund.refunded ? null : yesNo(refund.depositOwed === true),
    amount_owed_pence: !refund.refunded && typeof refund.amountOwedPence === 'number' ? refund.amountOwedPence : null,
  }
}

/**
 * The refund outcome the cancellation stated, from its stored facts. The outcome of a refund is
 * not on the booking, so this is the only way to state it again. Null when the facts are missing
 * or malformed.
 */
export function refundResultFromFacts(facts: Record<string, unknown> | null | undefined): TableBookingCancellationRefundResult | null {
  const outcome = facts?.refund_outcome
  if (typeof outcome !== 'string' || !outcome) return null

  if (outcome === 'refunded') {
    const amountPence = Number(facts?.refund_amount_pence)
    const tier = facts?.refund_tier
    if (!Number.isFinite(amountPence) || amountPence <= 0 || typeof tier !== 'string' || !tier) return null
    return { refunded: true, amountPence, tier }
  }

  const owed = facts?.amount_owed_pence
  const owedPence = owed === null || owed === undefined || owed === '' ? Number.NaN : Number(owed)
  return {
    refunded: false,
    reason: outcome,
    ...(facts?.deposit_owed === 'yes' ? { depositOwed: true } : {}),
    ...(Number.isFinite(owedPence) && owedPence > 0 ? { amountOwedPence: owedPence } : {}),
  }
}

/** The date, time and party size, and that the booking is confirmed. */
export function depositConfirmedFacts(booking: {
  booking_date: string | null
  booking_time: string | null
  party_size: number | null
  status: string | null
}): FallbackBookingFacts {
  return {
    booking_date: booking.booking_date ?? null,
    booking_time: clockTime(booking.booking_time),
    party_size: Math.max(1, Number(booking.party_size ?? 1)),
    status: booking.status ?? null,
  }
}

/** The new party size, the amount asked for, when the payment link runs out, and that it is still owed. */
export function partySizeDepositRequestFacts(input: {
  partySize: number | null
  depositAmount: number | string | null
  holdExpiresAt: string | null
  awaitingPayment: boolean
}): FallbackBookingFacts {
  const amount = input.depositAmount === null || input.depositAmount === '' ? Number.NaN : Number(input.depositAmount)
  return {
    party_size: input.partySize ?? null,
    deposit_amount: Number.isFinite(amount) ? amount : null,
    hold_expires_at: isoInstant(input.holdExpiresAt),
    awaiting_payment: yesNo(input.awaitingPayment),
  }
}

/** Whether a booking is still waiting for its deposit, as the payment page itself decides it. */
export function isAwaitingTableDeposit(booking: { status: string | null; payment_status: string | null }): boolean {
  return booking.status === 'pending_payment' || booking.payment_status === 'pending'
}

/** The date, time and party size, that the booking is confirmed, and that the guest has not answered. */
export function confirmReminderFacts(booking: {
  booking_date: string | null
  booking_time: string | null
  party_size: number | null
  status: string | null
  guest_confirmed_at: string | null
}): FallbackBookingFacts {
  return {
    booking_date: booking.booking_date ?? null,
    booking_time: clockTime(booking.booking_time),
    party_size: booking.party_size ?? null,
    status: booking.status ?? null,
    guest_confirmed: yesNo(Boolean(booking.guest_confirmed_at)),
  }
}

/** The date and time, and that food choices are still owed on a form that is still open. */
export function preorderReminderFacts(input: {
  bookingDate: string | null
  bookingTime: string | null
  choicesOutstanding: boolean
}): FallbackBookingFacts {
  return {
    booking_date: input.bookingDate ?? null,
    booking_time: clockTime(input.bookingTime),
    choices_outstanding: yesNo(input.choicesOutstanding),
  }
}
