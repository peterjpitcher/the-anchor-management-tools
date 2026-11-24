import { createHash } from 'crypto'
import { calculateParkingPricing, type ParkingRateConfig } from '@/lib/parking/pricing'
import {
  bookingPrice,
  computeNetPaid,
  refundablePayments,
  roundPence,
  type ParkingBalancePaymentRow,
  type ParkingBalanceRefundRow,
  type RefundablePayment,
} from '@/lib/parking/balance'
import type { ParkingBooking, ParkingPricingResult } from '@/types/parking'

/**
 * The rules for changing a parking booking's dates, kept pure so they can be tested without a
 * database (spec tasks/spec-2026-11-24-parking-change-time-and-settle.md, sections 3 and 6).
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** D10: a stay whose booked end has passed can still be extended for this long after it. */
export const LATE_EXTENSION_WINDOW_DAYS = 7

/** D3: inside this long before arrival, the published terms give no refund. */
export const NO_REFUND_WINDOW_HOURS = 24

/** PayPal refuses a refund on a capture older than this. Matches refundActions. */
export const PAYPAL_REFUND_WINDOW_DAYS = 180

/** Reminder texts go three days ahead of the start and of the end (the session reminder cron). */
export const REMINDER_LEAD_MS = 3 * DAY_MS

export type ParkingChangeBooking = Pick<
  ParkingBooking,
  | 'id'
  | 'status'
  | 'payment_status'
  | 'start_at'
  | 'end_at'
  | 'calculated_price'
  | 'override_price'
  | 'override_reason'
  | 'updated_at'
>

/** What the money looks like after the change, before anyone decides how to settle it. */
export type ParkingChangeSettlementKind =
  /** Never paid: it owes the new price, and gets a fresh payment link. */
  | 'unpaid'
  /** Paid, and the new balance is zero. */
  | 'none'
  /** Paid, and we will owe them money back. */
  | 'refund'
  /** Paid, and they will owe us more. */
  | 'extra'

export interface ParkingChangePlan {
  oldPrice: number
  /** The calculated price for the new dates. A date change clears any old override. */
  newPrice: number
  pricing: ParkingPricingResult
  netPaid: number
  /** newPrice - netPaid for a paid booking; the new price for an unpaid one. */
  balanceAfter: number
  kind: ParkingChangeSettlementKind
  /** The most that can be refunded through this change (only for kind 'refund'). */
  refundDue: number
  /** The amount the refund box starts at: refundDue, or 0 inside 24 hours (D3). */
  refundDefault: number
  /** Extra to collect (only for kind 'extra'). */
  extraDue: number
  insideNoRefundWindow: boolean
  started: boolean
  ended: boolean
  startMoved: boolean
  endMoved: boolean
  hadOverride: boolean
  /** Paid payments, newest first, with what each can still give back. */
  refundable: RefundablePayment[]
  /** True when every refundable payment can go back through PayPal. */
  paypalRefundPossible: boolean
}

export type ParkingChangePlanResult = { ok: true; plan: ParkingChangePlan } | { ok: false; error: string }

function instant(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b
  const left = Date.parse(a)
  const right = Date.parse(b)
  return Number.isNaN(left) || Number.isNaN(right) ? a === b : left === right
}

function canRefundThroughPayPal(payment: RefundablePayment, now: Date): boolean {
  if (payment.provider !== 'paypal' || !payment.transactionId) return false
  if (!payment.paidAt) return true
  return now.getTime() - Date.parse(payment.paidAt) <= PAYPAL_REFUND_WINDOW_DAYS * DAY_MS
}

/** True when this payment goes back through PayPal rather than by hand. */
export function refundsThroughPayPal(payment: RefundablePayment, now: Date): boolean {
  return canRefundThroughPayPal(payment, now)
}

/**
 * Works out what a change of dates means. Refuses a change the rules do not allow (6.2 step 1).
 * `rates` is the active rate: the whole stay is repriced at today's rate (D8).
 */
export function planParkingDateChange(input: {
  booking: ParkingChangeBooking
  payments: ParkingBalancePaymentRow[]
  refunds: ParkingBalanceRefundRow[]
  newStartAt: string
  newEndAt: string
  rates: ParkingRateConfig
  now: Date
}): ParkingChangePlanResult {
  const { booking, payments, refunds, rates, now } = input

  if (booking.status !== 'pending_payment' && booking.status !== 'confirmed') {
    return { ok: false, error: `This booking is ${booking.status.replace('_', ' ')}, so its dates cannot be changed.` }
  }

  const newStart = instant(input.newStartAt)
  const newEnd = instant(input.newEndAt)
  if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) {
    return { ok: false, error: 'Enter a valid start and end.' }
  }
  if (newEnd <= newStart) {
    return { ok: false, error: 'The end must be after the start.' }
  }

  const oldStart = instant(booking.start_at)
  const oldEnd = instant(booking.end_at)
  const nowMs = now.getTime()
  const started = oldStart <= nowMs
  const ended = oldEnd <= nowMs
  const startMoved = newStart !== oldStart
  const endMoved = newEnd !== oldEnd

  if (!startMoved && !endMoved) {
    return { ok: false, error: 'The dates have not changed.' }
  }

  if (started && startMoved) {
    return { ok: false, error: 'This stay has started, so only the end can move.' }
  }

  if (ended) {
    // D10: a late collection. Only a later end, only within 7 days of the booked end.
    if (newEnd <= oldEnd) {
      return {
        ok: false,
        error: 'This stay has already ended, so it can only be extended. A refund after the fact goes through the Refund button.',
      }
    }
    if (newEnd > oldEnd + LATE_EXTENSION_WINDOW_DAYS * DAY_MS) {
      return { ok: false, error: `A stay that has ended can only be extended up to ${LATE_EXTENSION_WINDOW_DAYS} days after its booked end.` }
    }
  }

  const pricing = calculateParkingPricing(new Date(newStart), new Date(newEnd), rates)
  const newPrice = roundPence(pricing.total)
  const oldPrice = bookingPrice(booking)
  const { netPaid } = computeNetPaid(payments, refunds)
  const refundable = refundablePayments(payments, refunds)
  const hadOverride = booking.override_price !== null && booking.override_price !== undefined

  const unpaid = booking.payment_status === 'pending' || booking.status === 'pending_payment'
  const balanceAfter = unpaid ? newPrice : roundPence(newPrice - netPaid)

  if (ended && !unpaid && balanceAfter < 0) {
    return { ok: false, error: 'A stay that has ended cannot be made cheaper here. A refund after the fact goes through the Refund button.' }
  }

  const insideNoRefundWindow = started || oldStart - nowMs < NO_REFUND_WINDOW_HOURS * HOUR_MS

  let kind: ParkingChangeSettlementKind
  if (unpaid) kind = 'unpaid'
  else if (balanceAfter < 0) kind = 'refund'
  else if (balanceAfter > 0) kind = 'extra'
  else kind = 'none'

  const refundDue = kind === 'refund' ? roundPence(-balanceAfter) : 0
  const extraDue = kind === 'extra' ? balanceAfter : 0

  return {
    ok: true,
    plan: {
      oldPrice,
      newPrice,
      pricing,
      netPaid,
      balanceAfter,
      kind,
      refundDue,
      refundDefault: kind === 'refund' && !insideNoRefundWindow ? refundDue : 0,
      extraDue,
      insideNoRefundWindow,
      started,
      ended,
      startMoved,
      endMoved,
      hadOverride,
      refundable,
      paypalRefundPossible: refundable.filter((payment) => payment.refundable > 0).every((payment) => canRefundThroughPayPal(payment, now)),
    },
  }
}

/**
 * Which reminder flags a change clears (spec 8.2). A flag is cleared only when that end of the
 * stay moved AND the new time is more than three days away: inside three days the change text has
 * just told them, so no second reminder follows.
 */
export function reminderFlagResets(input: {
  startMoved: boolean
  endMoved: boolean
  newStartAt: string
  newEndAt: string
  now: Date
}): { resetStart: boolean; resetEnd: boolean } {
  const nowMs = input.now.getTime()
  return {
    resetStart: input.startMoved && instant(input.newStartAt) - nowMs > REMINDER_LEAD_MS,
    resetEnd: input.endMoved && instant(input.newEndAt) - nowMs > REMINDER_LEAD_MS,
  }
}

/**
 * A stable UUID for one refund in one change: the same change and payment always give the same
 * key, so a double click or a retry replays the refund rather than sending a second one.
 */
export function changeRefundKey(changeId: string, paymentId: string): string {
  const hex = createHash('sha256').update(`parking-change:${changeId}:${paymentId}`).digest('hex')
  // Shape it as a version 5 style UUID (the column is uuid).
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
