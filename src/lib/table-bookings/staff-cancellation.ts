import { z } from 'zod'

/**
 * Who is cancelling a table booking when staff do it, and what the deposit refund follows
 * (BK-046, customer bookings review of 24 October 2026; owner decision D7).
 *
 * Every staff cancel used to apply the guest's own refund terms, so when the pub had to cancel
 * (kitchen down, double-booked, power cut) the guest got half or nothing back and was told the
 * deposit could not be refunded. Staff now say who is cancelling:
 *
 *  - the guest asked: the booking's own terms, as before;
 *  - the pub is cancelling: the whole deposit is refunded and the message says sorry.
 *
 * A manager (table_bookings manage, the rule release 9 set for the deposit waiver) may choose the
 * refund amount instead, starting from what the guest actually paid.
 *
 * Shared by the FOH and BOH screens and their routes, so it imports nothing from the server.
 */

export type StaffCancelledBy = 'guest' | 'venue'

/** What goes in table_bookings.cancellation_reason, so a venue cancellation can be told apart later. */
export const STAFF_CANCELLATION_REASON: Record<StaffCancelledBy, string> = {
  guest: 'Guest asked staff to cancel',
  venue: 'The pub cancelled',
}

export const STAFF_CANCELLED_BY_OPTIONS: ReadonlyArray<{ value: StaffCancelledBy; label: string; description: string }> = [
  {
    value: 'guest',
    label: 'The guest asked to cancel',
    description: "Any deposit is refunded under the booking's own terms.",
  },
  {
    value: 'venue',
    label: 'The pub is cancelling',
    description: 'Any deposit is refunded in full, and the message to the guest says sorry.',
  },
]

const optionalAmount = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') return Number(value.trim())
  return value
}, z.number().finite().positive('Enter a refund amount above £0').max(100_000).optional())

export const StaffCancellationBodySchema = z.object({
  cancelled_by: z.enum(['guest', 'venue']).optional(),
  refund_amount_gbp: optionalAmount,
})

export type StaffCancellationChoice = {
  cancelledBy: StaffCancelledBy
  /** A manager's chosen refund in pounds, or null to follow the rule. */
  refundAmountGbp: number | null
  /** False when the request named nobody (a screen loaded before this change): the guest's terms apply. */
  choiceGiven: boolean
}

export function parseStaffCancellation(
  body: unknown
): { ok: true; choice: StaffCancellationChoice } | { ok: false; error: string } {
  const record = body && typeof body === 'object' ? body : {}
  const parsed = StaffCancellationBodySchema.safeParse(record)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid cancellation details' }
  }
  return {
    ok: true,
    choice: {
      cancelledBy: parsed.data.cancelled_by ?? 'guest',
      refundAmountGbp: parsed.data.refund_amount_gbp === undefined ? null : Math.round(parsed.data.refund_amount_gbp * 100) / 100,
      choiceGiven: parsed.data.cancelled_by !== undefined,
    },
  }
}

/** What the guest paid and still has with us, in pounds, for the refund field's starting value. */
export function depositHeldGbp(
  booking: {
    payment_status?: string | null
    deposit_refund_status?: string | null
    deposit_amount_locked?: number | string | null
    deposit_amount?: number | string | null
  },
  alreadyReturnedGbp = 0
): number {
  const paid = booking.payment_status === 'completed' || booking.payment_status === 'partial_refund'
  if (!paid || booking.deposit_refund_status === 'refunded') return 0
  const raw = booking.deposit_amount_locked ?? booking.deposit_amount
  const amount = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return Math.max(0, Math.round((amount - alreadyReturnedGbp) * 100) / 100)
}

/** The request body the screens send. */
export function staffCancellationBody(choice: { cancelledBy: StaffCancelledBy; refundAmountGbp: number | null }): Record<string, unknown> {
  return {
    cancelled_by: choice.cancelledBy,
    ...(choice.refundAmountGbp !== null ? { refund_amount_gbp: choice.refundAmountGbp } : {}),
  }
}

/** What the cancel form holds while staff fill it in. */
export type StaffCancelFormState = {
  cancelledBy: StaffCancelledBy | null
  chooseAmount: boolean
  amountText: string
}

export function initialStaffCancelForm(heldGbp: number): StaffCancelFormState {
  return { cancelledBy: null, chooseAmount: false, amountText: heldGbp > 0 ? heldGbp.toFixed(2) : '' }
}

/** Turns the form into the choice to send, or says what is missing. */
export function readStaffCancelForm(
  state: StaffCancelFormState,
  heldGbp: number
): { ok: true; choice: { cancelledBy: StaffCancelledBy; refundAmountGbp: number | null } } | { ok: false; error: string } {
  if (!state.cancelledBy) {
    return { ok: false, error: 'Choose who is cancelling.' }
  }
  if (!state.chooseAmount || heldGbp <= 0) {
    return { ok: true, choice: { cancelledBy: state.cancelledBy, refundAmountGbp: null } }
  }
  const amount = Number(state.amountText.trim())
  if (!Number.isFinite(amount) || amount <= 0 || amount > heldGbp + 0.005) {
    return { ok: false, error: `Enter a refund between £0.01 and £${heldGbp.toFixed(2)}.` }
  }
  return { ok: true, choice: { cancelledBy: state.cancelledBy, refundAmountGbp: Math.round(amount * 100) / 100 } }
}
