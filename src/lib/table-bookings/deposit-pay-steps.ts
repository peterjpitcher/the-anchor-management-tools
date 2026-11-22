import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { hashGuestToken } from '@/lib/guest/tokens'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { isGuestSidePayPalRefusal } from '@/lib/paypal-error-detail'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CaptureTableDepositResult } from '@/lib/table-bookings/capture-deposit'

/**
 * The record of what happened on the table deposit pay page (/g/<token>/table-payment).
 *
 * Owner decision, 22 November 2026: "Add error reporting at every step, just so that we know
 * what's happened if it fails. We'll need to use the analytics to find out where people are
 * falling off." Three of the last five deposit holds lapsed after the guest had opened the pay
 * page several times, and nothing said why: a PayPal browser error, a closed PayPal window, a
 * refused capture, a failed PayPal set-up and a blocked link only changed the screen.
 *
 * Every step is one row in `analytics_events`, first party, with no cookie and no third-party
 * script. The row carries the table booking id, the step (`event_type` is `deposit_pay_<step>`,
 * and `metadata.step` repeats it), the time (`created_at`) and the detail of any error. Ids, codes
 * and PayPal's own wording only: never a guest's name, email address or phone number.
 *
 * Nothing here may stop or slow a payment. Every function swallows its own failures.
 */

/** Steps the guest's browser reports through the step route. A fixed list: nothing else is taken. */
export const DEPOSIT_PAY_CLIENT_STEPS = [
  /** PayPal's script loaded and its buttons are on the screen. */
  'buttons_shown',
  /** The guest pressed a PayPal button: the PayPal window, or its card form, opened. */
  'paypal_opened',
  /** The guest approved the payment in PayPal; the capture is about to run. */
  'approved',
  /** The guest closed PayPal without paying. */
  'cancelled',
  /** PayPal's script reported an error in the browser. */
  'paypal_error',
  /** The capture call never answered the browser (a dropped connection, or our server failing). */
  'capture_call_failed',
] as const

/** Steps only the server can know. */
export const DEPOSIT_PAY_SERVER_STEPS = [
  /** The pay page was served for a payable booking (or an already paid one, see `alreadyPaid`). */
  'page_viewed',
  /** The link could not be opened: used, expired, hold lapsed, rate limited and so on. */
  'link_blocked',
  /** We could not create the PayPal order, or could not save it on the booking. */
  'setup_failed',
  /** The capture was refused, with the reason. */
  'capture_refused',
  /** The deposit was taken and recorded. */
  'paid',
] as const

export type DepositPayClientStep = (typeof DEPOSIT_PAY_CLIENT_STEPS)[number]
export type DepositPayStep = DepositPayClientStep | (typeof DEPOSIT_PAY_SERVER_STEPS)[number]

export type DepositPayStepDetail = Record<string, string | number | boolean | string[] | null | undefined>

export function depositPayEventType(step: DepositPayStep): string {
  return `deposit_pay_${step}`
}

type Client = SupabaseClient<any, 'public', any>

export type DepositPayBooking = { tableBookingId: string; customerId: string }

/**
 * Runs the work once the response has gone, so recording never holds the guest up. Outside a
 * request (a test, a script) `after` throws, and the work simply runs unawaited instead.
 */
export function afterDepositPayResponse(work: () => Promise<void>): void {
  const safe = async (): Promise<void> => {
    try {
      await work()
    } catch (error) {
      logger.error('Recording a deposit pay page step failed', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  try {
    after(safe)
  } catch {
    void safe()
  }
}

/**
 * The booking a deposit pay link belongs to, taken from the token and nothing else.
 *
 * Deliberately looser than `getTablePaymentPreviewByRawToken`, which refuses a link once its hold
 * has lapsed or the booking is paid: the steps most worth recording are the late ones (a guest
 * back on an expired link, a "paid" that arrives as the token is consumed). So this asks only that
 * the token is a real payment token, that its booking exists, and that the booking belongs to the
 * token's customer. Null for anything else. Never throws.
 */
export async function resolveDepositPayBooking(supabase: Client, rawToken: string): Promise<DepositPayBooking | null> {
  try {
    if (!rawToken || rawToken.length > 512) return null

    const { data: token, error: tokenError } = await supabase
      .from('guest_tokens')
      .select('customer_id, table_booking_id')
      .eq('hashed_token', hashGuestToken(rawToken))
      .eq('action_type', 'payment')
      .maybeSingle()
    if (tokenError || !token?.table_booking_id || !token.customer_id) return null

    const { data: booking, error: bookingError } = await supabase
      .from('table_bookings')
      .select('id, customer_id')
      .eq('id', token.table_booking_id)
      .maybeSingle()
    if (bookingError || !booking || booking.customer_id !== token.customer_id) return null

    return { tableBookingId: booking.id as string, customerId: booking.customer_id as string }
  } catch {
    return null
  }
}

/** Writes one step against the booking. Never throws. */
export async function recordDepositPayStep(
  supabase: Client,
  input: DepositPayBooking & { step: DepositPayStep; detail?: DepositPayStepDetail },
): Promise<void> {
  const detail: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.detail ?? {})) {
    if (value !== undefined && value !== null && value !== '') detail[key] = value
  }
  await recordAnalyticsEvent(supabase, {
    customerId: input.customerId,
    tableBookingId: input.tableBookingId,
    eventType: depositPayEventType(input.step),
    metadata: { ...detail, step: input.step, source: 'guest_payment_link' },
  })
}

/** How often, at most, one booking's pay page faults reach the manager. */
export const DEPOSIT_PAY_FAULT_ALERT_HOURS = 1

/**
 * Tells the manager a guest could not pay and it looks like our fault or PayPal's, not the guest
 * changing their mind or their bank saying no. At most one email an hour for a booking, whatever
 * the step, through the same manager alert the other deposit problems use. Never throws.
 */
export async function alertDepositPayFault(
  supabase: Client,
  input: { tableBookingId: string; step: DepositPayStep; detail?: DepositPayStepDetail },
): Promise<void> {
  try {
    const context: Record<string, unknown> = { Step: input.step }
    for (const [key, value] of Object.entries(input.detail ?? {})) {
      if (value === undefined || value === null || value === '') continue
      context[key] = Array.isArray(value) ? value.join(', ') : value
    }
    await alertMoneyNeedsAPerson(supabase, {
      domain: 'table_bookings',
      bookingId: input.tableBookingId,
      kind: 'deposit_pay_fault',
      ttlHours: DEPOSIT_PAY_FAULT_ALERT_HOURS,
      title: 'A guest could not pay a table deposit',
      summary:
        'A guest was on the deposit pay page for this booking and the payment stopped in a way that looks like a fault on our side or PayPal\'s, not a change of mind or a card being declined. Check whether the deposit shows as paid on the booking, and call the guest if the hold is close to running out. Every step is recorded against the booking; this email is sent at most once an hour for the same booking.',
      context,
    })
  } catch (error) {
    logger.error('Could not raise the deposit pay page alert', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: input.tableBookingId, step: input.step },
    })
  }
}

/** Records a step and, when it is a fault for a person, raises the alert. Never throws. */
export async function reportDepositPayStep(
  supabase: Client,
  input: DepositPayBooking & { step: DepositPayStep; detail?: DepositPayStepDetail; alert?: boolean },
): Promise<void> {
  await recordDepositPayStep(supabase, input)
  if (input.alert) {
    await alertDepositPayFault(supabase, { tableBookingId: input.tableBookingId, step: input.step, detail: input.detail })
  }
}

/**
 * Client steps a person should hear about. Only the capture call that never answered: the guest
 * had approved the payment and we cannot say whether it was taken. An error from PayPal's script
 * in the browser is recorded but not alerted, because it is as often the guest's own browser (a
 * blocked pop-up, a dropped connection) as anything we can fix.
 */
export function isDepositPayClientFault(step: DepositPayClientStep): boolean {
  return step === 'capture_call_failed'
}

/** Blocked reasons this page can give. One from the address bar that is not on the list is stored as `other`. */
const KNOWN_BLOCKED_REASONS = new Set([
  'invalid_token',
  'token_used',
  'token_expired',
  'booking_not_found',
  'booking_not_pending_payment',
  'hold_expired',
  'token_customer_mismatch',
  'invalid_amount',
  'stripe_unavailable',
  'internal_error',
  'rate_limited',
])

export function normaliseDepositPayBlockedReason(reason: string | undefined): string {
  if (!reason) return 'unknown'
  return KNOWN_BLOCKED_REASONS.has(reason) ? reason : 'other'
}

/**
 * A pay link that could not be opened. Always logged at error level, because a warning is easy to
 * lose and this is the point a guest gives up. Recorded against the booking when the token still
 * names one; a link whose token is unknown has no booking or customer to hang a row on, so the log
 * line is all there is.
 *
 * `throttleHeaders` is for the one branch the page serves before its own rate limit (the
 * `?state=blocked` redirect): the record is skipped once that address has been hit too often.
 */
export function reportDepositPayLinkBlocked(input: {
  rawToken: string
  reason: string | undefined
  /** Where the page decided it: the redirect that sent the guest here, the rate limit, or the link check. */
  decidedBy: 'redirect' | 'rate_limit' | 'link_check'
  record: boolean
  throttleHeaders?: { get(name: string): string | null }
}): void {
  const reason = normaliseDepositPayBlockedReason(input.reason)
  logger.error('Table deposit pay link was blocked', {
    error: new Error(`deposit_pay_link_blocked_${reason}`),
    metadata: { reason, decidedBy: input.decidedBy },
  })
  if (!input.record) return

  afterDepositPayResponse(async () => {
    if (input.throttleHeaders) {
      const throttle = await checkGuestTokenThrottle({
        headers: input.throttleHeaders,
        rawToken: input.rawToken,
        scope: 'guest_table_payment_blocked_record',
        maxAttempts: 20,
      })
      if (!throttle.allowed) return
    }
    const supabase = createAdminClient()
    const booking = await resolveDepositPayBooking(supabase, input.rawToken)
    if (!booking) return
    await recordDepositPayStep(supabase, {
      ...booking,
      step: 'link_blocked',
      detail: { reason, decidedBy: input.decidedBy },
    })
  })
}

/**
 * We could not get the guest as far as PayPal's buttons: the order could not be created, or could
 * not be saved on the booking. Logged at error level, recorded, and a person is told.
 */
export function reportDepositPaySetupFailed(input: DepositPayBooking & { detail: DepositPayStepDetail }): void {
  logger.error('Table deposit pay page could not set up the PayPal payment', {
    error: new Error(`deposit_pay_setup_failed_${String(input.detail.reason ?? 'unknown')}`),
    metadata: { tableBookingId: input.tableBookingId, ...input.detail },
  })
  afterDepositPayResponse(() =>
    reportDepositPayStep(createAdminClient(), {
      tableBookingId: input.tableBookingId,
      customerId: input.customerId,
      step: 'setup_failed',
      detail: input.detail,
      alert: true,
    }),
  )
}

type CaptureRefusal = Exclude<CaptureTableDepositResult, { ok: true }>

/**
 * Refusals nobody has been told about yet that look like our fault or PayPal's.
 *
 * Left out on purpose: a declined payment and a booking that is no longer payable (the guest's
 * side), and the refusals after money moved, which captureTableDeposit already sends to the
 * manager itself (pending, wrong booking, wrong amount, not recorded). A capture that threw is a
 * fault unless PayPal's issue codes say the guest's bank or account refused it.
 */
export function depositCaptureRefusalNeedsAPerson(result: CaptureRefusal): boolean {
  switch (result.code) {
    case 'BOOKING_NOT_FOUND':
    case 'ORDER_MISMATCH':
    case 'PAYPAL_ORDER_LOOKUP_FAILED':
    case 'AMOUNT_MISMATCH':
      return true
    case 'CAPTURE_FAILED':
      return !(result.detail?.paypal && isGuestSidePayPalRefusal(result.detail.paypal))
    default:
      return false
  }
}

/** The outcome of the capture the guest's approval set off: `paid`, or `capture_refused` with why. */
export function reportDepositCaptureOutcome(input: DepositPayBooking & { result: CaptureTableDepositResult }): void {
  const { result, tableBookingId, customerId } = input
  afterDepositPayResponse(async () => {
    const supabase = createAdminClient()
    if (result.ok) {
      await recordDepositPayStep(supabase, {
        tableBookingId,
        customerId,
        step: 'paid',
        detail: { alreadyRecorded: result.alreadyRecorded, confirmationChannel: result.confirmationChannel },
      })
      return
    }
    const failure = result.code === 'NOT_PAYABLE' ? undefined : result.detail
    await reportDepositPayStep(supabase, {
      tableBookingId,
      customerId,
      step: 'capture_refused',
      alert: depositCaptureRefusalNeedsAPerson(result),
      detail: {
        code: result.code,
        blockReason: result.code === 'NOT_PAYABLE' ? result.blockReason : undefined,
        paypalStatus: failure?.paypal?.status,
        paypalName: failure?.paypal?.name,
        paypalIssues: failure?.paypal?.issues.length ? failure.paypal.issues : undefined,
        paypalDebugId: failure?.paypal?.debugId,
        paypalMessage: failure?.paypal?.message,
        captureStatus: failure?.captureStatus,
        captureStatusReason: failure?.captureStatusReason,
      },
    })
  })
}
