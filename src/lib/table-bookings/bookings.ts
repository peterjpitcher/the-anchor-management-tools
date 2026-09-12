import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import { queueManagerReportEmail } from '@/lib/manager-report/queue'
import { notifyCustomer } from '@/lib/notifications/notify'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import {
  computeStripeCheckoutExpiresAtUnix,
  createStripeTableDepositCheckoutSession,
  expireStripeCheckoutSession,
  type StripeCheckoutSession,
} from '@/lib/payments/stripe'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import {
  computeDepositAmount,
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
} from './deposit'
import { isChristmasBookingType } from './christmas'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import {
  GUEST_CHANNEL_COLUMNS,
  notifyTableBookingGuestEmailFirst,
  type GuestChannelCustomer,
} from '@/lib/table-bookings/guest-notify'
import {
  buildTableBookingCancelledEmail,
  buildTableBookingConfirmedEmail,
  buildTableBookingDepositAtBookingEmail,
  buildTableBookingDepositConfirmedEmail,
  buildTableBookingRescheduledEmail,
} from '@/lib/table-bookings/guest-emails'
import { depositPerPerson } from '@/lib/table-bookings/deposit-terms'
import { getPreorderCutoff } from '@/lib/table-bookings/preorder'
import {
  buildDepositConfirmedText,
  buildTableBookingCancelledText,
  describeChristmasCourseCounts,
  describeTableBookingCancellationRefund,
  formatLondonDateTime,
  type TableBookingCancellationRefundResult,
} from '@/lib/table-bookings/guest-texts'
import {
  cancellationFacts,
  depositConfirmedFacts,
  type TableBookingFallbackLink,
} from '@/lib/table-bookings/fallback-details'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

// The texts' words now live in guest-texts.ts, shared with the bounce fallback. Re-exported so
// existing importers keep working.
export { describeChristmasCourseCounts, describeTableBookingCancellationRefund, type TableBookingCancellationRefundResult }

// Re-exported for backwards-compat in this file. The single source of truth is
// `LARGE_GROUP_DEPOSIT_PER_PERSON_GBP` in `./deposit.ts`. Spec §7.3, §8.3.
const DEPOSIT_PER_PERSON_GBP = LARGE_GROUP_DEPOSIT_PER_PERSON_GBP
const LONDON_TIMEZONE = 'Europe/London'

type TableBookingState = 'confirmed' | 'pending_payment' | 'blocked'

export type TableBookingRpcResult = {
  state: TableBookingState
  table_booking_id?: string
  booking_reference?: string
  status?: string
  reason?: string
  table_id?: string
  table_ids?: string[]
  table_name?: string
  table_names?: string[]
  tables_joined?: boolean
  party_size?: number
  // Christmas requests are stored as a `food` purpose with booking_type
  // 'christmas'. Neither the RPC nor the walk-in override path ever returns
  // 'christmas' here, so read `booking_type` to detect a Christmas booking.
  // The value is kept in the union only so a future caller cannot be surprised.
  booking_purpose?: 'food' | 'drinks' | 'christmas'
  booking_type?: string
  start_datetime?: string
  end_datetime?: string
  hold_expires_at?: string
  sunday_lunch?: boolean
  sunday_preorder_cutoff_at?: string | null
  high_chairs_granted?: number
  high_chair_count?: number
  is_outside_seating?: boolean
  // The deposit the RPC actually resolved and charged, and the seasonal terms it snapshotted onto
  // the booking. Read these rather than recomputing an amount: the create path is the only place
  // that knows which of the two rules won, and a second copy of the sum is how the payments row and
  // the booking row end up disagreeing about what the guest owes.
  deposit_required?: boolean
  deposit_amount?: number
  deposit_rule?: 'none' | 'group' | 'period' | 'waived'
  deposit_basis?: 'per_head' | 'per_booking' | null
  deposit_rate?: number | null
  deposit_reason?: string | null
  deposit_refund_cutoff_days?: number | null
  deposit_refund_policy?: string | null
  booking_period_id?: string | null
  booking_period_code?: string | null
  booking_period_name?: string | null
  booking_period_answer?: boolean | null
  booking_period_requires_preorder?: boolean | null
  christmas_course_counts?: number[] | null
}

/**
 * The deposit the database ACTUALLY charged for a freshly created booking.
 *
 * There is exactly one right answer to "what does this guest owe", and the RPC computed it inside
 * the transaction that took the booking. Every caller that recomputed it from party size was
 * running the old party-size rule, and quoted a different number from the one written on the
 * payment row the moment a seasonal period charged anything other than GBP 10 a head: a per-head
 * GBP 15 Mother's Day booking for two was charged GBP 30 and told the guest GBP 0.
 *
 * `fallback` covers a caller holding a result from before this field existed. It is a function so
 * the old computation is not run when it is not needed.
 */
export function chargedDepositAmount(
  bookingResult: Pick<TableBookingRpcResult, 'deposit_amount'>,
  fallback: () => number,
): number {
  const charged = Number(bookingResult.deposit_amount)
  const amount = Number.isFinite(charged) && charged > 0 ? charged : fallback()
  return Number(amount.toFixed(2))
}

export type TablePaymentTokenResult = {
  rawToken: string
  url: string
  expiresAt: string
}

export type TablePaymentPreviewResult =
  | {
    state: 'ready'
    tableBookingId: string
    customerId: string
    bookingReference: string
    partySize: number
    totalAmount: number
    currency: string
    holdExpiresAt: string
    bookingDate: string | null
    bookingTime: string | null
    startDateTime: string | null
    bookingType: string | null
    tokenHash: string
  }
  | {
    state: 'blocked'
    reason:
      | 'invalid_token'
      | 'token_expired'
      | 'token_used'
      | 'booking_not_found'
      | 'booking_not_pending_payment'
      | 'hold_expired'
      | 'invalid_amount'
      | 'token_customer_mismatch'
  }

type SmsSafetyMeta =
  | {
    success: boolean
    code: string | null
    logFailure: boolean
  }
  | null

export type TableBookingNotificationChannel = 'email' | 'whatsapp' | 'sms' | null

type TableBookingNotificationRow = {
  id: string
  customer_id: string | null
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  source: string | null
  special_requirements: string | null
  high_chair_count: number | null
  is_outside_seating: boolean | null
}

type CustomerNotificationRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
  email: string | null
  sms_status?: string | null
  sms_opt_in?: boolean | null
  marketing_sms_opt_in?: boolean | null
  email_status?: string | null
  email_deactivated_at?: string | null
  marketing_email_opt_in?: boolean | null
}

const MANAGER_TABLE_BOOKING_EMAIL = 'manager@the-anchor.pub'

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const { code: thrownCode, logFailure: thrownLogFailure } = extractSmsSafetyInfo(error)

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (thrownCode) {
    return {
      code: thrownCode,
      logFailure: false
    }
  }

  return {
    code: 'safety_unavailable',
    logFailure: false
  }
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function endOfLondonBookingDay(bookingDate: string): Date {
  return fromZonedTime(`${bookingDate}T23:59:59`, LONDON_TIMEZONE)
}

function resolveBaseUrl(appBaseUrl?: string | null): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL
  const chosen = (appBaseUrl || fromEnv || 'http://localhost:3000').replace(/\/+$/, '')
  return chosen
}

function formatPence(amount: number): number {
  return Math.round(amount * 100)
}

export function mapTableBookingBlockedReason(reason?: string | null):
  | 'outside_hours'
  | 'cut_off'
  | 'no_table'
  | 'private_booking_blocked'
  | 'too_large_party'
  | 'customer_conflict'
  | 'in_past'
  | 'slot_full'
  | 'blocked' {
  switch (reason) {
    case 'too_large_party':
      return 'too_large_party'
    case 'no_table':
      return 'no_table'
    case 'private_booking_blocked':
      return 'private_booking_blocked'
    case 'cut_off':
      return 'cut_off'
    case 'customer_conflict':
      return 'customer_conflict'
    case 'in_past':
      return 'in_past'
    case 'slot_full':
      return 'slot_full'
    case 'outside_hours':
    case 'hours_not_configured':
    case 'outside_service_window':
    case 'sunday_lunch_requires_sunday':
      return 'outside_hours'
    default:
      return 'blocked'
  }
}

function resolveSundayPreorderTemplateKey(startDateTime?: string | null): string {
  if (!startDateTime) {
    return 'sunday_preorder_request'
  }

  const startMs = Date.parse(startDateTime)
  if (!Number.isFinite(startMs)) {
    return 'sunday_preorder_request'
  }

  const msUntilStart = startMs - Date.now()
  if (msUntilStart <= 0) {
    return 'sunday_preorder_request'
  }

  const hoursUntilStart = msUntilStart / (60 * 60 * 1000)
  if (hoursUntilStart > 24 && hoursUntilStart <= 26) {
    return 'sunday_preorder_reminder_26h'
  }
  if (hoursUntilStart > 26 && hoursUntilStart <= 48) {
    return 'sunday_preorder_reminder_48h'
  }

  return 'sunday_preorder_request'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function humanizeToken(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return 'Unknown'

  const normalised = trimmed.replaceAll('-', ' ').replaceAll('_', ' ')
  return normalised.charAt(0).toUpperCase() + normalised.slice(1)
}

function formatBookingTimeLabel(booking: TableBookingNotificationRow): string {
  if (booking.start_datetime) {
    return formatLondonDateTime(booking.start_datetime)
  }

  if (booking.booking_date && booking.booking_time) {
    return `${booking.booking_date} ${booking.booking_time}`
  }

  if (booking.booking_date) {
    return booking.booking_date
  }

  return 'Unknown time'
}

export async function sendManagerTableBookingCreatedEmailIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId?: string | null
    fallbackCustomerId?: string | null
    createdVia?: string
  }
): Promise<{ sent: boolean; queued?: boolean; skipped?: boolean; reason?: string; error?: string }> {
  if (!input.tableBookingId) {
    return {
      sent: false,
      skipped: true,
      reason: 'missing_booking_id'
    }
  }

  const { data: bookingRaw, error: bookingError } = await supabase.from('table_bookings')
    .select(
      `
        id,
        customer_id,
        booking_reference,
        booking_date,
        booking_time,
        start_datetime,
        party_size,
        booking_type,
        booking_purpose,
        status,
        source,
        special_requirements,
        high_chair_count,
        is_outside_seating
      `
    )
    .eq('id', input.tableBookingId)
    .maybeSingle()

  if (bookingError || !bookingRaw) {
    return {
      sent: false,
      error: bookingError?.message || 'Table booking not found'
    }
  }

  const booking = bookingRaw as TableBookingNotificationRow
  const bookingSource = booking.source?.trim().toLowerCase() || ''
  if (bookingSource === 'walk-in') {
    return {
      sent: false,
      skipped: true,
      reason: 'walk_in'
    }
  }

  const resolvedCustomerId = booking.customer_id || input.fallbackCustomerId || null
  let customer: CustomerNotificationRow | null = null

  if (resolvedCustomerId) {
    const { data: customerRaw } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_e164, mobile_number, email')
      .eq('id', resolvedCustomerId)
      .maybeSingle()

    customer = (customerRaw || null) as CustomerNotificationRow | null
  }

  const bookingReference = booking.booking_reference || booking.id
  const partySize = Math.max(1, Number(booking.party_size || 1))
  const customerName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Unknown guest'
  const customerPhone = customer?.mobile_e164 || customer?.mobile_number || 'Unknown'
  const customerEmail = customer?.email || 'Not provided'
  const createdVia = humanizeToken(input.createdVia || booking.source || 'unknown')
  const sourceLabel = humanizeToken(booking.source)
  const bookingMoment = formatBookingTimeLabel(booking)
  const subject = `New table booking: ${bookingReference}`

  const details = [
    `<li><strong>Reference:</strong> ${escapeHtml(bookingReference)}</li>`,
    `<li><strong>When:</strong> ${escapeHtml(bookingMoment)}</li>`,
    `<li><strong>Party size:</strong> ${escapeHtml(String(partySize))}</li>`,
    `<li><strong>Status:</strong> ${escapeHtml(humanizeToken(booking.status))}</li>`,
    `<li><strong>Type:</strong> ${escapeHtml(humanizeToken(booking.booking_type))}</li>`,
    `<li><strong>Purpose:</strong> ${escapeHtml(humanizeToken(booking.booking_purpose))}</li>`,
    `<li><strong>Source:</strong> ${escapeHtml(sourceLabel)}</li>`,
    `<li><strong>Created via:</strong> ${escapeHtml(createdVia)}</li>`,
    `<li><strong>Guest:</strong> ${escapeHtml(customerName)}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(customerPhone)}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(customerEmail)}</li>`
  ]

  const grantedHighChairs = Math.max(0, Number(booking.high_chair_count ?? 0))
  if (grantedHighChairs > 0) {
    details.push(`<li><strong>High chairs:</strong> ${escapeHtml(String(grantedHighChairs))}</li>`)
  }

  if (booking.is_outside_seating) {
    details.push('<li><strong>Seating:</strong> Outside</li>')
  }

  if (booking.special_requirements) {
    details.push(`<li><strong>Notes:</strong> ${escapeHtml(booking.special_requirements)}</li>`)
  }

  const html = [
    '<p>A new table booking has been created.</p>',
    '<ul>',
    ...details,
    '</ul>'
  ].join('')

  const emailResult = await queueManagerReportEmail({
    section: 'table_bookings',
    key: booking.id,
    to: MANAGER_TABLE_BOOKING_EMAIL,
    subject,
    html,
    metadata: {
      table_booking_id: booking.id,
      summary: `${customerName}: ${partySize} guests, ${bookingMoment}, ${bookingReference}`,
    },
  })

  if (!emailResult.success) {
    return {
      sent: false,
      error: emailResult.error || 'Failed to queue manager booking email'
    }
  }

  return {
    sent: false,
    queued: true
  }
}

export async function createTablePaymentToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    tableBookingId: string
    holdExpiresAt: string
    appBaseUrl?: string | null
  }
): Promise<TablePaymentTokenResult> {
  const holdExpiry = parseIsoDate(input.holdExpiresAt)
  if (!holdExpiry || holdExpiry.getTime() <= Date.now()) {
    throw new Error('Table payment hold has already expired')
  }

  const { rawToken } = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'payment',
    tableBookingId: input.tableBookingId,
    expiresAt: holdExpiry.toISOString(),
  })

  const baseUrl = resolveBaseUrl(input.appBaseUrl)

  return {
    rawToken,
    url: `${baseUrl}/g/${rawToken}/table-payment`,
    expiresAt: holdExpiry.toISOString(),
  }
}

export async function getTablePaymentPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<TablePaymentPreviewResult> {
  const tokenHash = hashGuestToken(rawToken)

  const { data: token, error: tokenError } = await supabase
    .from('guest_tokens')
    .select('id, customer_id, table_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'payment')
    .maybeSingle()

  if (tokenError) {
    throw tokenError
  }

  if (!token) {
    return { state: 'blocked', reason: 'invalid_token' }
  }

  if (token.consumed_at) {
    return { state: 'blocked', reason: 'token_used' }
  }

  const tokenExpiry = parseIsoDate(token.expires_at)
  if (!tokenExpiry || tokenExpiry.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  if (!token.table_booking_id) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  const { data: booking, error: bookingError } = await supabase.from('table_bookings')
    .select(`
      id,
      customer_id,
      status,
      payment_status,
      hold_expires_at,
      party_size,
      committed_party_size,
      booking_reference,
      booking_date,
      booking_time,
      start_datetime,
      booking_type,
      deposit_amount,
      deposit_amount_locked,
      deposit_waived
    `)
    .eq('id', token.table_booking_id)
    .maybeSingle()

  if (bookingError) {
    throw bookingError
  }

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.customer_id !== token.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  const awaitingPayment =
    booking.status === 'pending_payment' || booking.payment_status === 'pending'
  if (!awaitingPayment) {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  // For pending_payment bookings use hold_expires_at; for confirmed bookings with pending
  // payment use end-of-booking-day as a fallback (the booking is already secured).
  let holdExpiry = parseIsoDate(booking.hold_expires_at)
  if (!holdExpiry && booking.booking_date) {
    holdExpiry = endOfLondonBookingDay(booking.booking_date)
  }
  if (!holdExpiry || holdExpiry.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'hold_expired' }
  }

  const partySize = Math.max(1, Number(booking.committed_party_size ?? booking.party_size ?? 1))
  // Read canonical deposit (locked > stored > computed). Honours
  // `deposit_amount_locked` for already-paid bookings and any stored
  // `deposit_amount` for `pending_payment` rows. Spec §3 step 9, §7.3, §8.3.
  const canonical = getCanonicalDeposit(
    {
      party_size: partySize,
      deposit_amount: booking.deposit_amount ?? null,
      deposit_amount_locked: booking.deposit_amount_locked ?? null,
      status: booking.status ?? null,
      payment_status: booking.payment_status ?? null,
      deposit_waived: booking.deposit_waived ?? null,
      // Christmas bookings owe a deposit at any party size.
      booking_type: booking.booking_type ?? null,
    },
    partySize,
  )
  const totalAmount = Number(canonical.toFixed(2))
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { state: 'blocked', reason: 'invalid_amount' }
  }

  return {
    state: 'ready',
    tableBookingId: booking.id,
    customerId: booking.customer_id,
    bookingReference: booking.booking_reference || booking.id,
    partySize,
    totalAmount,
    currency: 'GBP',
    holdExpiresAt: holdExpiry.toISOString(),
    bookingDate: booking.booking_date || null,
    bookingTime: booking.booking_time || null,
    startDateTime: booking.start_datetime || null,
    bookingType: booking.booking_type || null,
    tokenHash,
  }
}

export async function createTableCheckoutSessionByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    appBaseUrl?: string | null
  }
): Promise<
  | {
    state: 'created'
    checkoutUrl: string
    session: StripeCheckoutSession
    tableBookingId: string
  }
  | {
    state: 'blocked'
    reason: TablePaymentPreviewResult extends { state: 'blocked'; reason: infer R } ? R : string
  }
  | {
    state: 'error'
    reason: string
  }
> {
  const preview = await getTablePaymentPreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready') {
    return preview
  }

  const baseUrl = resolveBaseUrl(input.appBaseUrl)
  const tokenEncoded = encodeURIComponent(input.rawToken)
  const successUrl = `${baseUrl}/g/${tokenEncoded}/table-payment?state=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${baseUrl}/g/${tokenEncoded}/table-payment?state=cancelled`

  const session = await createStripeTableDepositCheckoutSession({
    idempotencyKey: `table_booking_deposit_${preview.tableBookingId}_${preview.tokenHash.slice(0, 24)}`,
    successUrl,
    cancelUrl,
    tableBookingId: preview.tableBookingId,
    customerId: preview.customerId,
    quantity: 1,
    unitAmountMinor: formatPence(preview.totalAmount),
    currency: preview.currency,
    productName: `${preview.bookingType === 'sunday_lunch' ? 'Sunday lunch deposit' : 'Table deposit'} (${preview.partySize} ${preview.partySize === 1 ? 'person' : 'people'})`,
    tokenHash: preview.tokenHash,
    expiresAtUnix: computeStripeCheckoutExpiresAtUnix(preview.holdExpiresAt),
    metadata: {
      booking_reference: preview.bookingReference,
      deposit_per_person_gbp: String(DEPOSIT_PER_PERSON_GBP),
      party_size: String(preview.partySize),
    },
  })

  if (!session.url) {
    throw new Error('Stripe checkout session did not return a URL')
  }

  try {
    const nowIso = new Date().toISOString()

    const { data: existingSessionRow, error: existingSessionLookupError } = await supabase
      .from('payments')
      .select('id')
      .eq('stripe_checkout_session_id', session.id)
      .limit(1)
      .maybeSingle()

    if (existingSessionLookupError) {
      throw new Error(
        `Failed to verify existing table-deposit payment row before checkout persistence: ${existingSessionLookupError.message}`
      )
    }

    if (!existingSessionRow) {
      const { data: pendingRow, error: pendingLookupError } = await supabase
        .from('payments')
        .select('id')
        .eq('table_booking_id', preview.tableBookingId)
        .eq('charge_type', 'table_deposit')
        .eq('status', 'pending')
        .is('stripe_checkout_session_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (pendingLookupError) {
        throw new Error(`Failed to locate pending table-deposit row: ${pendingLookupError.message}`)
      }

      if (pendingRow?.id) {
        const { error: pendingUpdateError } = await supabase
          .from('payments')
          .update({
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent ?? null,
            amount: preview.totalAmount,
            currency: preview.currency,
            metadata: {
              source: 'guest_token',
              token_hash: preview.tokenHash,
              checkout_url: session.url,
              party_size: preview.partySize,
              deposit_per_person: DEPOSIT_PER_PERSON_GBP,
              updated_at: nowIso,
            },
          })
          .eq('id', pendingRow.id)

        if (pendingUpdateError) {
          throw new Error(`Failed to update pending table-deposit payment row: ${pendingUpdateError.message}`)
        }
      } else {
        const { error: insertError } = await supabase.from('payments').insert({
          table_booking_id: preview.tableBookingId,
          charge_type: 'table_deposit',
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent ?? null,
          amount: preview.totalAmount,
          currency: preview.currency,
          status: 'pending',
          metadata: {
            source: 'guest_token',
            token_hash: preview.tokenHash,
            checkout_url: session.url,
            party_size: preview.partySize,
            deposit_per_person: DEPOSIT_PER_PERSON_GBP,
            created_at: nowIso,
          },
        })

        if (insertError) {
          throw new Error(`Failed to insert pending table-deposit payment row: ${insertError.message}`)
        }
      }
    }
  } catch (persistenceError) {
    // DB persistence failed after Stripe session was created. If the guest were given
    // the checkout URL and paid, the webhook would have no matching payment row to
    // update. Attempt to expire the Stripe session so no payment can be taken, then
    // return an error state so the caller can surface a recoverable error to the guest.
    logger.error('Failed to persist pending table-deposit payment row after Stripe checkout session creation — expiring Stripe session', {
      error: persistenceError instanceof Error ? persistenceError : new Error(String(persistenceError)),
      metadata: {
        tableBookingId: preview.tableBookingId,
        checkoutSessionId: session.id,
      },
    })

    try {
      await expireStripeCheckoutSession(session.id)
    } catch (expireError) {
      logger.error('Failed to expire Stripe checkout session after DB persistence failure — manual action required', {
        error: expireError instanceof Error ? expireError : new Error(String(expireError)),
        metadata: {
          tableBookingId: preview.tableBookingId,
          checkoutSessionId: session.id,
        },
      })
    }

    return {
      state: 'error',
      reason: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
    }
  }

  return {
    state: 'created',
    checkoutUrl: session.url,
    session,
    tableBookingId: preview.tableBookingId,
  }
}

/**
 * What the deposit works out at per person, for the wording that says what it is.
 *
 * `per_booking` is not a per-person rate, so it answers null and the copy drops the sentence
 * rather than dividing a flat fee by the party and inventing a rate nobody charges.
 */
function depositPerPersonForBooking(
  bookingResult: TableBookingRpcResult,
  depositAmount: number,
  partySize: number
): number | null {
  if (bookingResult.deposit_basis === 'per_booking') return null
  const rate = Number(bookingResult.deposit_rate)
  if (Number.isFinite(rate) && rate > 0) return rate
  return depositPerPerson(depositAmount, partySize)
}

/**
 * The seasonal pre-order deadline for a freshly created booking: the period's cutoff in days and
 * the instant the form locks. Both null when the period cannot be read, so the confirmation says
 * nothing about a deadline rather than naming one the form will not honour.
 */
async function loadBookingPreorderDeadline(
  supabase: SupabaseClient<any, 'public', any>,
  bookingResult: TableBookingRpcResult
): Promise<{ cutoffDays: number | null; closesAtIso: string | null }> {
  const periodId = bookingResult.booking_period_id
  const startIso = bookingResult.start_datetime
  if (!periodId || !startIso) return { cutoffDays: null, closesAtIso: null }

  try {
    const { data, error } = await supabase
      .from('booking_periods')
      .select('preorder_cutoff_days')
      .eq('id', periodId)
      .maybeSingle()

    if (error || !data) return { cutoffDays: null, closesAtIso: null }

    const days = Number((data as { preorder_cutoff_days: number | null }).preorder_cutoff_days)
    if (!Number.isFinite(days) || days < 0) return { cutoffDays: null, closesAtIso: null }

    const bookingDate = toLocalIsoDate(new Date(startIso))
    const cutoff = getPreorderCutoff({ bookingDate, preorderCutoffDays: days })
    return { cutoffDays: days, closesAtIso: cutoff.closesAt ? cutoff.closesAt.toISOString() : null }
  } catch (error) {
    logger.warn('Could not read the seasonal pre-order deadline for a booking confirmation', {
      metadata: {
        tableBookingId: bookingResult.table_booking_id ?? null,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return { cutoffDays: null, closesAtIso: null }
  }
}

export async function sendTableBookingCreatedSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    normalizedPhone: string
    bookingResult: TableBookingRpcResult
    nextStepUrl?: string | null
    /**
     * Suppresses the TEXT, and only the text.
     *
     * The website sets this for a booking it is about to hand to PayPal, so the guest is not
     * texted a payment link while a payment screen is already in front of them. The caller used
     * to skip this whole function for those bookings, which suppressed the email as well: every
     * website booking of 15 or more, and every website Christmas booking, was taken with no
     * confirmation of any kind, no deposit terms and no pay-by time. They get the email now.
     */
    skipCustomerSms?: boolean
  }
): Promise<{
  notificationChannel?: TableBookingNotificationChannel
  scheduledFor?: string
  sms: SmsSafetyMeta
  email?: { success: boolean; error?: string | null } | null
}> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_e164, mobile_number, email, sms_status, sms_opt_in, marketing_sms_opt_in, email_status, email_deactivated_at, marketing_email_opt_in')
    .eq('id', input.customerId)
    .maybeSingle()

  if (error || !customer) {
    return { sms: null }
  }

  const firstName = getSmartFirstName(customer.first_name)
  const bookingMoment = formatLondonDateTime(input.bookingResult.start_datetime)
  const partySize = Math.max(1, Number(input.bookingResult.party_size ?? 1))
  const seatWord = partySize === 1 ? 'person' : 'people'
  // Centralised compute. Booking is fresh from the RPC so no prior locked
  // amount can exist here. Spec §3 step 9, §8.3.
  const depositAmount = Number(
    computeDepositAmount(partySize, {
      isChristmas: isChristmasBookingType(input.bookingResult.booking_type),
    }).toFixed(2),
  )
  const depositLabel = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(depositAmount)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  let manageLink: string | null = null
  // True when a link went out at full length because shortening failed. Recorded on
  // the audit row below rather than only logged, so a spell of silent failure is
  // queryable instead of invisible.
  let shortLinkFallback = false

  if (input.bookingResult.state === 'confirmed' && input.bookingResult.table_booking_id) {
    try {
      const token = await createTableManageToken(supabase, {
        customerId: input.customerId,
        tableBookingId: input.bookingResult.table_booking_id,
        bookingStartIso: input.bookingResult.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL
      })
      // Shortened here rather than inside createTableManageToken: that URL is also
      // handed back to API callers, so the caller's copy must stay long. Doing it
      // once here covers both the email and the SMS below.
      const shortened = await buildGuestShortLink({
        longUrl: token.url,
        linkKind: 'table_manage',
        customerId: input.customerId,
        tableBookingId: input.bookingResult.table_booking_id,
      })
      manageLink = shortened.url
      if (!shortened.shortened) shortLinkFallback = true
    } catch {
      manageLink = null
    }
  }

  // input.nextStepUrl is the same string the API returns as next_step_url and
  // fallback_payment_url, so only a local copy is shortened; the caller keeps the
  // long one for its straight-to-payment redirect.
  let paymentLink = input.nextStepUrl || null
  if (paymentLink && input.bookingResult.table_booking_id) {
    const shortenedPayment = await buildGuestShortLink({
      longUrl: paymentLink,
      linkKind: 'table_payment',
      customerId: input.customerId,
      tableBookingId: input.bookingResult.table_booking_id,
    })
    paymentLink = shortenedPayment.url
    if (!shortenedPayment.shortened) shortLinkFallback = true
  }

  // Render the server-GRANTED chair count (never the requested value) and outside-safe wording.
  const isOutside = Boolean(input.bookingResult.is_outside_seating)
  const grantedHighChairs = Math.max(0, Number(input.bookingResult.high_chair_count ?? 0))
  const highChairSuffix = grantedHighChairs > 0 ? ` High chair reserved x${grantedHighChairs}.` : ''
  const outsideSuffix = isOutside ? ' Outside seating (weather permitting).' : ''

  // A booking on a seasonal menu that needs choices is told so on both channels, and the link is
  // named for the job rather than for the screen it opens. "Manage booking" reads as an
  // amend-or-cancel link, so a Christmas guest who needs to pick three courses has no reason to
  // open it, and the first they would hear of it is the chase ten days out. That is late for the
  // kitchen and it makes the reminder do work the confirmation should already have done.
  // Only when the guest actually accepted the seasonal menu. Someone who declined it is on the
  // ordinary menu and has nothing to choose in advance, so pointing them at a food form would be
  // a job they cannot do.
  const needsFoodChoices =
    Boolean(input.bookingResult.booking_period_id) &&
    input.bookingResult.booking_period_requires_preorder === true &&
    input.bookingResult.booking_period_answer === true

  let smsBody: string
  if (input.bookingResult.state === 'pending_payment') {
    const depositKindLabel = input.bookingResult.sunday_lunch
      ? 'Sunday lunch deposit'
      : isOutside ? 'deposit' : 'table deposit'
    const secureNoun = isOutside ? 'outside booking' : 'table'
    const base = `The Anchor: Hi ${firstName}, please pay your ${depositKindLabel} of ${depositLabel} (${partySize} x GBP ${DEPOSIT_PER_PERSON_GBP}) to secure your ${secureNoun} for ${partySize} ${seatWord} on ${bookingMoment}.`
    const cta = paymentLink ? `Pay now: ${paymentLink}` : 'We will text your payment link shortly.'
    smsBody = `${base}${highChairSuffix}${outsideSuffix} ${cta}`
  } else {
    const bookingNoun = isOutside ? 'outside booking' : 'table booking'
    const linkSuffix = manageLink
      ? needsFoodChoices
        ? ` Choose your food: ${manageLink}`
        : ` Manage booking: ${manageLink}`
      : ''
    smsBody = `The Anchor: Hi ${firstName}, your ${bookingNoun} for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${highChairSuffix}${outsideSuffix}${linkSuffix}`
  }

  const christmasCourseSummary = describeChristmasCourseCounts(input.bookingResult.christmas_course_counts)
  if (christmasCourseSummary) smsBody += ` ${christmasCourseSummary}`

  const templateKey = input.bookingResult.state === 'pending_payment'
    ? 'table_booking_pending_payment'
    : 'table_booking_confirmed'

  // When the pre-order form locks for this booking, for the deadline the confirmation states.
  // Read only for a booking that owes choices, and a failed read leaves the sentence out rather
  // than guessing a date the form will not honour.
  const preorder = needsFoodChoices
    ? await loadBookingPreorderDeadline(supabase, input.bookingResult)
    : { cutoffDays: null, closesAtIso: null }

  const emailContent =
    input.bookingResult.state === 'pending_payment'
      ? buildTableBookingDepositAtBookingEmail({
          firstName,
          bookingReference: input.bookingResult.booking_reference || null,
          bookingDate: null,
          startDateTime: input.bookingResult.start_datetime || null,
          partySize,
          depositKindLabel: input.bookingResult.sunday_lunch
            ? 'Sunday lunch deposit'
            : isOutside ? 'deposit' : 'table deposit',
          depositLabel,
          breakdownNote: ` (${partySize} x GBP ${DEPOSIT_PER_PERSON_GBP})`,
          paymentLink,
          isOutsideSeating: isOutside,
          highChairCount: grantedHighChairs,
          isChristmas: isChristmasBookingType(input.bookingResult.booking_type),
          perPersonGbp: depositPerPersonForBooking(input.bookingResult, depositAmount, partySize),
          refundCutoffDays: input.bookingResult.deposit_refund_cutoff_days ?? null,
          payByIso: input.bookingResult.hold_expires_at || null,
        })
      : buildTableBookingConfirmedEmail({
          firstName,
          bookingReference: input.bookingResult.booking_reference || null,
          bookingDate: null,
          startDateTime: input.bookingResult.start_datetime || null,
          partySize,
          manageLink,
          christmasCourseSummary: christmasCourseSummary || null,
          highChairCount: grantedHighChairs,
          isOutsideSeating: isOutside,
          needsFoodChoices,
          christmasCourseCounts: input.bookingResult.christmas_course_counts ?? null,
          preorderCutoffDays: preorder.cutoffDays,
          preorderClosesAtIso: preorder.closesAtIso,
        })

  // Email only when the caller is suppressing the text, so the notice still goes out on the
  // channel that is left rather than not at all.
  const channelPolicy = input.skipCustomerSms === true ? 'email_only' : 'email_first'

  let notificationResult: Awaited<ReturnType<typeof notifyCustomer>>
  try {
    notificationResult = await notifyCustomer({
      supabase,
      customerId: input.customerId,
      customer,
      policy: channelPolicy,
      urgency: 'standard',
      category: 'transactional',
      email: {
        to: customer.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        commType: templateKey,
        tableBookingId: input.bookingResult.table_booking_id ?? null,
        metadata: {
          table_booking_id: input.bookingResult.table_booking_id,
          template_key: templateKey,
          channel_policy: channelPolicy,
        },
      },
      sms: {
        to: customer.mobile_number || input.normalizedPhone,
        body: ensureReplyInstruction(smsBody, supportPhone),
        options: {
          customerId: input.customerId,
          metadata: {
            table_booking_id: input.bookingResult.table_booking_id,
            template_key: templateKey,
          },
        },
      },
    })
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Table booking created notification threw unexpectedly', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: input.bookingResult.table_booking_id ?? undefined,
      operation_status: 'failure',
      error_message: smsError instanceof Error ? smsError.message : String(smsError),
      additional_info: {
        comm_type: templateKey,
        customer_id: input.customerId,
        code: thrownSafety.code,
      },
    })
    return {
      sms: {
        success: false,
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      },
    }
  }

  const smsAttempt = notificationResult.attempts.find(attempt => attempt.channel === 'sms')
  const emailAttempt = notificationResult.attempts.find(attempt => attempt.channel === 'email')
  const smsCode = typeof smsAttempt?.code === 'string' ? smsAttempt.code : null
  const smsLogFailure = smsAttempt?.logFailure === true || smsCode === 'logging_failed'
  const smsDeliveredOrUnknown = smsAttempt ? (smsAttempt.success === true || smsLogFailure) : false
  const emailDeliveredOrUnknown = emailAttempt?.success === true
  const notificationDeliveredOrUnknown = smsDeliveredOrUnknown || emailDeliveredOrUnknown

  if (smsLogFailure) {
    logger.error('Table booking created SMS sent but outbound message logging failed', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        code: smsCode,
        logFailure: smsLogFailure,
      },
    })
  }

  if (smsAttempt && !smsAttempt.success) {
    logger.warn('Table booking created SMS send returned non-success', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        state: input.bookingResult.state,
        error: smsAttempt.error,
        code: smsCode,
      }
    })
  }

  await AuditService.logAuditEvent({
    operation_type: notificationDeliveredOrUnknown ? 'table_booking.notification_sent' : 'table_booking.notification_failed',
    resource_type: 'table_booking',
    resource_id: input.bookingResult.table_booking_id ?? undefined,
    operation_status: notificationDeliveredOrUnknown ? 'success' : 'failure',
    error_message: notificationDeliveredOrUnknown ? undefined : (emailAttempt?.error ?? smsAttempt?.error ?? smsCode ?? undefined),
    additional_info: {
      comm_type: templateKey,
      customer_id: input.customerId,
      code: smsCode,
      selected_channels: notificationResult.selectedChannels,
      email_sent: emailDeliveredOrUnknown,
      sms_sent: smsDeliveredOrUnknown,
      short_link_fallback: shortLinkFallback,
    },
  })

  return {
    // The channel that reached the guest, which the website names on its confirmation screen.
    // With email first, the first channel selected is email even when the email failed and the
    // text went instead, so it is only the answer when nothing is known to have gone.
    notificationChannel: emailDeliveredOrUnknown
      ? 'email'
      : smsDeliveredOrUnknown
        ? 'sms'
        : notificationResult.sentChannel ?? notificationResult.selectedChannels[0] ?? null,
    scheduledFor: smsDeliveredOrUnknown ? smsAttempt?.scheduledFor : undefined,
    sms: smsAttempt
      ? {
        success: smsDeliveredOrUnknown,
        code: smsCode,
        logFailure: smsLogFailure,
      }
      : null,
    email: emailAttempt
      ? {
        success: emailAttempt.success,
        error: emailAttempt.error ?? null,
      }
      : null,
  }
}

const DEPOSIT_CONFIRMED_TEMPLATE_KEY = 'table_booking_deposit_confirmed'

/** Email log statuses that mean the email went out, as the event emails already read them. */
const DELIVERABLE_EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'delivery_delayed', 'opened', 'clicked']

/**
 * How long the one-message claim for a deposit confirmation lasts: the SMS duplicate window. All
 * five triggers (Stripe webhook, PayPal webhook, capture route, guest payment page and the
 * reconciliation cron) fire within minutes of the payment.
 */
const DEPOSIT_CONFIRMED_CLAIM_TTL_HOURS = 24 * 14

type DepositConfirmedBooking = {
  id: string
  customer_id: string
  status: string | null
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  is_outside_seating: boolean | null
  high_chair_count: number | null
  christmas_course_counts: number[] | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
}

/**
 * True only when the email log positively shows this message went to this booking. A failed
 * lookup answers false: better one duplicate than a guest who paid and heard nothing.
 */
async function hasDeliverableTableBookingEmail(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string,
  commType: string
): Promise<boolean> {
  try {
    const { data, error } = await (supabase.from('email_messages') as any)
      .select('id')
      .eq('table_booking_id', tableBookingId)
      .eq('comm_type', commType)
      .in('status', DELIVERABLE_EMAIL_STATUSES)
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('Could not check for an earlier table booking email; sending anyway', {
        metadata: { tableBookingId, commType, code: error.code, message: error.message },
      })
      return false
    }

    return Boolean(data)
  } catch (error) {
    logger.warn('Table booking email duplicate check unavailable; sending anyway', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId, commType },
    })
    return false
  }
}

/**
 * The deposit confirmation, email first (flag table_deposit_confirmed_email_first).
 *
 * Up to five triggers fire for one payment, often within the same second (the PayPal capture
 * route and its webhook). Three layers keep that to one message:
 *
 *  1. The email log: an email already sent for this booking ends it.
 *  2. A claim in idempotency_keys: the first trigger takes it and the rest stop. It is released
 *     if nothing reached the guest, so a later trigger can try again.
 *  3. The provider idempotency key on the email itself.
 *
 * Without the claim, two triggers a second apart would each build a different manage link, the
 * provider would refuse the second email as a changed payload, and the guest would get a text as
 * well.
 */
async function sendTableBookingDepositConfirmedEmailFirst(
  supabase: SupabaseClient<any, 'public', any>,
  booking: DepositConfirmedBooking
): Promise<GuestNotificationOutcome> {
  const tableBookingId = booking.id
  const templateKey = DEPOSIT_CONFIRMED_TEMPLATE_KEY

  if (await hasDeliverableTableBookingEmail(supabase, tableBookingId, templateKey)) {
    return { status: 'already_sent', channel: 'email', fallbackUsed: false, error: null }
  }

  const claimKey = `notify:${templateKey}:${tableBookingId}`
  const claimHash = computeIdempotencyRequestHash({ templateKey, tableBookingId })
  let claimed = false
  try {
    const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, DEPOSIT_CONFIRMED_CLAIM_TTL_HOURS)
    if (claim.state !== 'claimed') {
      return { status: 'already_sent', channel: null, fallbackUsed: false, error: null }
    }
    claimed = true
  } catch (error) {
    // The guest has paid; a confirmation must still go. The email log check above and the
    // provider idempotency key still stand between them and a duplicate.
    logger.error('Deposit confirmation claim unavailable; sending without it', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId },
    })
  }

  const settleClaim = async (outcome: GuestNotificationOutcome) => {
    if (!claimed) return
    try {
      if (outcome.status === 'sent') {
        await persistIdempotencyResponse(
          supabase,
          claimKey,
          claimHash,
          { state: 'sent', channel: outcome.channel },
          DEPOSIT_CONFIRMED_CLAIM_TTL_HOURS
        )
      } else {
        await releaseIdempotencyClaim(supabase, claimKey, claimHash)
      }
    } catch (error) {
      logger.warn('Could not settle the deposit confirmation claim', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { tableBookingId, outcome: outcome.status },
      })
    }
  }

  try {
    const { data: customerRow, error: customerError } = await supabase
      .from('customers')
      .select(GUEST_CHANNEL_COLUMNS)
      .eq('id', booking.customer_id)
      .maybeSingle()

    if (customerError || !customerRow) {
      const outcome: GuestNotificationOutcome = {
        status: customerError ? 'failed' : 'no_channel',
        channel: null,
        fallbackUsed: false,
        error: customerError ? `Customer could not be loaded: ${customerError.message}` : 'Customer not found',
      }
      logger.error('Deposit confirmation could not load the customer', {
        metadata: { tableBookingId, customerId: booking.customer_id, error: outcome.error },
      })
      await AuditService.logAuditEvent({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: tableBookingId,
        operation_status: 'failure',
        error_message: outcome.error ?? undefined,
        additional_info: { comm_type: templateKey, customer_id: booking.customer_id, outcome: outcome.status },
      })
      await settleClaim(outcome)
      return outcome
    }

    const customer = customerRow as GuestChannelCustomer
    const firstName = getSmartFirstName(customer.first_name)
    const partySize = Math.max(1, Number(booking.party_size ?? 1))
    const isOutside = Boolean(booking.is_outside_seating)
    const grantedHighChairs = Math.max(0, Number(booking.high_chair_count ?? 0))
    const christmasCourseSummary = describeChristmasCourseCounts(booking.christmas_course_counts)

    // One short link for both channels, so the email and a fallback text resolve to one code.
    // How it was made is recorded, never the link itself, so a bounce can find it again.
    let manageLink: string | null = null
    let manageLinkForm: TableBookingFallbackLink = 'none'
    try {
      const token = await createTableManageToken(supabase, {
        customerId: customer.id,
        tableBookingId,
        bookingStartIso: booking.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
      })
      const shortened = await buildGuestShortLink({
        longUrl: token.url,
        linkKind: 'table_manage',
        customerId: customer.id,
        tableBookingId,
      })
      manageLink = shortened.url
      manageLinkForm = shortened.shortened ? 'short_link' : 'full_url'
    } catch {
      manageLink = null
      manageLinkForm = 'none'
    }

    const smsBody = buildDepositConfirmedText({ booking, firstName, manageLink })

    const depositPaid = Number(booking.deposit_amount_locked ?? booking.deposit_amount)
    const email = buildTableBookingDepositConfirmedEmail({
      firstName,
      bookingReference: booking.booking_reference,
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time,
      startDateTime: booking.start_datetime,
      partySize,
      isOutsideSeating: isOutside,
      highChairCount: grantedHighChairs,
      christmasCourseSummary: christmasCourseSummary || null,
      depositPaid: Number.isFinite(depositPaid) && depositPaid > 0 ? depositPaid : null,
      manageLink,
    })

    const outcome = await notifyTableBookingGuestEmailFirst({
      supabase,
      templateKey,
      tableBookingId,
      customer,
      email,
      sms: { to: customer.mobile_number, body: smsBody },
      idempotencyKey: `${templateKey}:${tableBookingId}`,
      fallback: { message: 'deposit_confirmed', facts: depositConfirmedFacts(booking), link: manageLinkForm },
    })

    await settleClaim(outcome)
    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Deposit confirmation threw unexpectedly', {
      error: error instanceof Error ? error : new Error(message),
      metadata: { tableBookingId },
    })
    const outcome: GuestNotificationOutcome = { status: 'failed', channel: null, fallbackUsed: false, error: message }
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: message,
      additional_info: { comm_type: templateKey, customer_id: booking.customer_id, outcome: 'failed', threw: true },
    })
    await settleClaim(outcome)
    return outcome
  }
}

export async function sendTableBookingConfirmedAfterDepositSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<SmsSafetyMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('*')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) {
    throw new Error(`Failed to load table booking for post-deposit SMS: ${bookingError.message}`)
  }

  if (!booking || booking.status !== 'confirmed' || !booking.customer_id) {
    return null
  }

  if (await isMessagingFlagOn('table_deposit_confirmed_email_first')) {
    const outcome = await sendTableBookingDepositConfirmedEmailFirst(supabase, booking as DepositConfirmedBooking)
    const delivered = outcome.status === 'sent' || outcome.status === 'already_sent'
    return {
      success: delivered,
      code: outcome.status === 'sent' ? null : outcome.status,
      logFailure: false,
    }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (customerError) {
    throw new Error(`Failed to load customer for post-deposit SMS: ${customerError.message}`)
  }

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return null
  }

  const firstName = getSmartFirstName(customer.first_name)
  let manageLink: string | null = null

  try {
    const token = await createTableManageToken(supabase, {
      customerId: customer.id,
      tableBookingId,
      bookingStartIso: booking.start_datetime || null,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
    })
    manageLink = token.url
  } catch {
    manageLink = null
  }

  const templateKey = DEPOSIT_CONFIRMED_TEMPLATE_KEY
  const body = buildDepositConfirmedText({ booking: booking as DepositConfirmedBooking, firstName, manageLink })

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        table_booking_id: tableBookingId,
        template_key: templateKey,
      },
    })

    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
    const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

    if (smsLogFailure) {
      logger.error('Table booking post-deposit SMS sent but outbound message logging failed', {
        metadata: {
          tableBookingId,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        },
      })
    }

    if (!smsResult.success) {
      logger.warn('Table booking post-deposit SMS send returned non-success', {
        metadata: {
          tableBookingId,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
        },
      })
    }

    await AuditService.logAuditEvent({
      operation_type: smsDeliveredOrUnknown ? 'table_booking.sms_sent' : 'table_booking.sms_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: smsDeliveredOrUnknown ? 'success' : 'failure',
      error_message: smsDeliveredOrUnknown ? undefined : (smsResult.error ?? smsCode ?? undefined),
      additional_info: {
        sms_type: templateKey,
        customer_id: customer.id,
        code: smsCode,
      },
    })

    return {
      success: smsDeliveredOrUnknown,
      code: smsCode,
      logFailure: smsLogFailure,
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Table booking post-deposit SMS threw unexpectedly', {
      metadata: {
        tableBookingId,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      },
    })

    await AuditService.logAuditEvent({
      operation_type: 'table_booking.sms_failed',
      resource_type: 'table_booking',
      resource_id: tableBookingId,
      operation_status: 'failure',
      error_message: smsError instanceof Error ? smsError.message : String(smsError),
      additional_info: {
        sms_type: templateKey,
        customer_id: customer.id,
        code: thrownSafety.code,
      },
    })

    return {
      success: false,
      code: thrownSafety.code,
      logFailure: thrownSafety.logFailure,
    }
  }
}

export async function sendSundayPreorderLinkSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    tableBookingId: string
    bookingStartIso?: string | null
    bookingReference?: string | null
    appBaseUrl?: string | null
  }
): Promise<{ sent: boolean; scheduledFor?: string; url?: string; sms: SmsSafetyMeta }> {
  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', input.customerId)
    .maybeSingle()

  if (!customer || !customer.mobile_number) {
    return { sent: false, sms: null }
  }

  let tokenUrl: string
  try {
    const token = await createSundayPreorderToken(supabase, {
      customerId: input.customerId,
      tableBookingId: input.tableBookingId,
      bookingStartIso: input.bookingStartIso || null,
      appBaseUrl: input.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL
    })
    tokenUrl = token.url
  } catch {
    return { sent: false, sms: null }
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const firstName = getSmartFirstName(customer.first_name)
  const message = ensureReplyInstruction(
    `The Anchor: ${firstName}! Time to pick what you're having for Sunday lunch — get your pre-order in here: ${tokenUrl}`,
    supportPhone
  )

  let result: Awaited<ReturnType<typeof sendSMS>>
  try {
    result = await sendSMS(customer.mobile_number, message, {
      customerId: customer.id,
      allowTransactionalOverride: true,
      metadata: {
        table_booking_id: input.tableBookingId,
        template_key: 'sunday_preorder_request'
      }
    })
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Sunday pre-order link SMS threw unexpectedly', {
      metadata: {
        tableBookingId: input.tableBookingId,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.sms_failed',
      resource_type: 'table_booking',
      resource_id: input.tableBookingId,
      operation_status: 'failure',
      error_message: smsError instanceof Error ? smsError.message : String(smsError),
      additional_info: {
        sms_type: 'sunday_preorder_request',
        customer_id: customer.id,
        code: thrownSafety.code,
      },
    })
    return {
      sent: false,
      url: tokenUrl,
      sms: {
        success: false,
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      },
    }
  }

  const smsCode = typeof result.code === 'string' ? result.code : null
  const smsLogFailure = result.logFailure === true || smsCode === 'logging_failed'
  const smsDeliveredOrUnknown = result.success === true || smsLogFailure

  if (smsLogFailure) {
    logger.error('Sunday pre-order link SMS sent but outbound message logging failed', {
      metadata: {
        tableBookingId: input.tableBookingId,
        customerId: customer.id,
        code: smsCode,
        logFailure: smsLogFailure,
      },
    })
  }

  if (!result.success) {
    logger.warn('Sunday pre-order link SMS send returned non-success', {
      metadata: {
        tableBookingId: input.tableBookingId,
        customerId: customer.id,
        error: result.error,
        code: smsCode,
      }
    })
  }

  await AuditService.logAuditEvent({
    operation_type: smsDeliveredOrUnknown ? 'table_booking.sms_sent' : 'table_booking.sms_failed',
    resource_type: 'table_booking',
    resource_id: input.tableBookingId,
    operation_status: smsDeliveredOrUnknown ? 'success' : 'failure',
    error_message: smsDeliveredOrUnknown ? undefined : (result.error ?? smsCode ?? undefined),
    additional_info: {
      sms_type: 'sunday_preorder_request',
      customer_id: customer.id,
      code: smsCode,
    },
  })

  return {
    sent: smsDeliveredOrUnknown,
    scheduledFor: smsDeliveredOrUnknown ? result.scheduledFor : undefined,
    url: tokenUrl,
    sms: {
      success: smsDeliveredOrUnknown,
      code: smsCode,
      logFailure: smsLogFailure,
    },
  }
}

type TableBookingCancellationNoticeParams = {
  customerId: string
  bookingReference: string
  bookingDate: string // YYYY-MM-DD format
  refundResult: TableBookingCancellationRefundResult
  tableBookingId?: string
}

/**
 * Tell the guest their table booking has been cancelled.
 *
 * With the messaging flag `table_cancelled_email_first` off (today), a text goes to guests with
 * an active mobile, exactly as before, and this returns null. With it on, the email goes first
 * and the text is the fallback, guests with only an email address are told too, and the outcome
 * comes back so staff can see a guest who was not reached.
 */
export async function sendTableBookingCancelledSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  params: TableBookingCancellationNoticeParams
): Promise<GuestNotificationOutcome | null> {
  // Every caller passes the booking id. Without one the email-first path could not key its
  // duplicate protection to the booking, so it stays on the text path.
  if (params.tableBookingId && (await isMessagingFlagOn('table_cancelled_email_first'))) {
    return sendTableBookingCancelledEmailFirst(supabase, { ...params, tableBookingId: params.tableBookingId })
  }

  await sendTableBookingCancelledTextOnly(supabase, params)
  return null
}

/**
 * The provider idempotency key for one cancellation email: stable across retries of the same
 * cancellation, new for each cancellation. Keyed on the booking alone, a booking cancelled,
 * re-confirmed and cancelled again inside Resend's 24-hour key window had the second email
 * replayed as the first (the guest got nothing new while staff saw it sent) or refused when its
 * words differed. The booking's cancelled_at, written once per cancellation, tells the two apart.
 * When it cannot be read the key falls back to the booking alone, which still stops a retry
 * sending twice.
 */
export function tableBookingCancelledEmailKey(tableBookingId: string, cancelledAt: string | null | undefined): string {
  const base = `table_booking_cancelled:${tableBookingId}`
  const cancelledAtMs = cancelledAt ? Date.parse(cancelledAt) : Number.NaN
  return Number.isFinite(cancelledAtMs) ? `${base}:${new Date(cancelledAtMs).toISOString()}` : base
}

async function sendTableBookingCancelledEmailFirst(
  supabase: SupabaseClient<any, 'public', any>,
  params: TableBookingCancellationNoticeParams & { tableBookingId: string }
): Promise<GuestNotificationOutcome> {
  const templateKey = 'table_booking_cancelled'

  try {
    const [{ data: customer, error: customerError }, { data: booking, error: bookingError }] = await Promise.all([
      supabase.from('customers').select(GUEST_CHANNEL_COLUMNS).eq('id', params.customerId).maybeSingle(),
      supabase
        .from('table_bookings')
        .select('id, booking_reference, booking_date, booking_time, start_datetime, party_size, cancelled_at')
        .eq('id', params.tableBookingId)
        .maybeSingle(),
    ])

    if (customerError || !customer) {
      const outcome: GuestNotificationOutcome = {
        status: customerError ? 'failed' : 'no_channel',
        channel: null,
        fallbackUsed: false,
        error: customerError ? `Customer could not be loaded: ${customerError.message}` : 'Customer not found',
      }
      logger.error('Table booking cancellation notice could not load the customer', {
        metadata: { tableBookingId: params.tableBookingId, customerId: params.customerId, error: outcome.error },
      })
      await AuditService.logAuditEvent({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: params.tableBookingId,
        operation_status: 'failure',
        error_message: outcome.error ?? undefined,
        additional_info: { comm_type: templateKey, customer_id: params.customerId, outcome: outcome.status },
      })
      return outcome
    }

    if (bookingError) {
      // The date, reference and refund still reach the guest; only the time and party size
      // are left out of the email.
      logger.warn('Table booking cancellation notice could not load the booking details', {
        metadata: { tableBookingId: params.tableBookingId, error: bookingError.message },
      })
    }

    const guest = customer as GuestChannelCustomer
    const firstName = getSmartFirstName(guest.first_name)
    const email = buildTableBookingCancelledEmail({
      firstName,
      bookingReference: booking?.booking_reference || params.bookingReference,
      bookingDate: params.bookingDate,
      bookingTime: booking?.booking_time ?? null,
      startDateTime: booking?.start_datetime ?? null,
      partySize: booking?.party_size ?? null,
      refundSentence: describeTableBookingCancellationRefund(params.refundResult),
    })

    return await notifyTableBookingGuestEmailFirst({
      supabase,
      templateKey,
      tableBookingId: params.tableBookingId,
      customer: guest,
      email,
      sms: {
        to: guest.mobile_number,
        body: buildTableBookingCancelledText({
          firstName,
          bookingDate: params.bookingDate,
          refundResult: params.refundResult,
        }),
        metadata: { booking_reference: params.bookingReference },
      },
      idempotencyKey: tableBookingCancelledEmailKey(params.tableBookingId, booking?.cancelled_at),
      auditContext: {
        booking_reference: params.bookingReference,
        refunded: params.refundResult.refunded,
      },
      fallback: {
        message: 'cancellation',
        facts: cancellationFacts({ bookingDate: params.bookingDate, refundResult: params.refundResult }),
      },
    })
  } catch (error) {
    // Never rethrow: a messaging failure must not affect the cancel or delete that called us.
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Table booking cancellation notice threw unexpectedly', {
      error: error instanceof Error ? error : new Error(message),
      metadata: { tableBookingId: params.tableBookingId, customerId: params.customerId },
    })
    await AuditService.logAuditEvent({
      operation_type: 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: params.tableBookingId,
      operation_status: 'failure',
      error_message: message,
      additional_info: { comm_type: templateKey, customer_id: params.customerId, outcome: 'failed', threw: true },
    })
    return { status: 'failed', channel: null, fallbackUsed: false, error: message }
  }
}

async function sendTableBookingCancelledTextOnly(
  supabase: SupabaseClient<any, 'public', any>,
  params: TableBookingCancellationNoticeParams
): Promise<void> {
  try {
    const { data: customer } = await supabase
      .from('customers')
      .select('id, first_name, mobile_number, sms_status')
      .eq('id', params.customerId)
      .maybeSingle()

    if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
      return
    }

    const firstName = getSmartFirstName(customer.first_name)

    const smsResult = await sendSMS(
      customer.mobile_number,
      buildTableBookingCancelledText({ firstName, bookingDate: params.bookingDate, refundResult: params.refundResult }),
      {
        customerId: customer.id,
        metadata: {
          booking_reference: params.bookingReference,
          template_key: 'table_booking_cancelled',
        },
      }
    )

    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
    const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

    if (smsLogFailure) {
      logger.error('Table booking cancelled SMS sent but outbound message logging failed', {
        metadata: {
          bookingReference: params.bookingReference,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        },
      })
    }

    if (!smsResult.success) {
      logger.warn('Table booking cancelled SMS send returned non-success', {
        metadata: {
          bookingReference: params.bookingReference,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
        },
      })
    }

    await AuditService.logAuditEvent({
      operation_type: smsDeliveredOrUnknown ? 'table_booking.sms_sent' : 'table_booking.sms_failed',
      resource_type: 'table_booking',
      resource_id: params.tableBookingId,
      operation_status: smsDeliveredOrUnknown ? 'success' : 'failure',
      error_message: smsDeliveredOrUnknown ? undefined : (smsResult.error ?? smsCode ?? undefined),
      additional_info: {
        sms_type: 'table_booking_cancelled',
        customer_id: customer.id,
        booking_reference: params.bookingReference,
        code: smsCode,
      },
    })
  } catch (smsError) {
    logger.warn('Table booking cancelled SMS threw unexpectedly', {
      metadata: {
        bookingReference: params.bookingReference,
        customerId: params.customerId,
        error: smsError instanceof Error ? smsError.message : String(smsError),
      },
    })
    // Do not rethrow — SMS failure must not affect the cancel/delete operation
  }
}

/**
 * Confirm an amended booking to the guest, after a change to the date, the time or the party size.
 *
 * Re-reads the booking fresh (post-update) and dispatches via notifyCustomer with an email_first
 * policy, so the guest gets one confirmation on their best channel with the same opt-in,
 * suppression and rate-limit guards as every other booking message. Never rethrows: a
 * notification failure must not affect the edit or move that triggered it. Internal table
 * reassignments do NOT call this.
 *
 * Two rules this used to get wrong:
 *
 *  - It said "still confirmed" whatever the status was. The floor may re-time a
 *    `pending_payment` booking, and that guest still owes a deposit whose hold is ticking, so
 *    telling them their table was confirmed is how a hold lapses on somebody who thought they
 *    were done. They now get the deposit, the pay-by time and the payment link instead.
 *  - It fired on a duration change, which the guest never sees, and it showed only the new time,
 *    which the guest cannot check. `params.previous` is what the booking said before, so the
 *    email can say what it was, and nothing is sent when the date, the time and the party size
 *    are all unchanged.
 */
export async function sendTableBookingRescheduledNotificationIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  params: {
    tableBookingId: string
    /** What the booking said before the change. Optional: an older caller simply says less. */
    previous?: {
      startDateTime?: string | null
      partySize?: number | null
    }
  }
): Promise<void> {
  try {
    const { data: bookingRaw } = await supabase
      .from('table_bookings')
      .select('id, customer_id, booking_reference, booking_date, booking_time, start_datetime, party_size, status, payment_status, booking_type, high_chair_count, is_outside_seating, deposit_amount, deposit_amount_locked, deposit_waived, deposit_rate, deposit_basis, deposit_refund_cutoff_days, hold_expires_at')
      .eq('id', params.tableBookingId)
      .maybeSingle()

    if (!bookingRaw || !bookingRaw.customer_id) {
      return
    }

    const booking = bookingRaw as {
      id: string
      customer_id: string
      booking_reference: string | null
      booking_date: string | null
      booking_time: string | null
      start_datetime: string | null
      party_size: number | null
      status: string | null
      payment_status: string | null
      booking_type: string | null
      high_chair_count: number | null
      is_outside_seating: boolean | null
      deposit_amount: number | string | null
      deposit_amount_locked: number | string | null
      deposit_waived: boolean | null
      deposit_rate: number | null
      deposit_basis: string | null
      deposit_refund_cutoff_days: number | null
      hold_expires_at: string | null
    }

    // Only confirm changes for live bookings. Never message cancelled or closed ones.
    const status = (booking.status || '').toLowerCase()
    if (['cancelled', 'no_show', 'completed'].includes(status)) {
      return
    }

    // Nothing the guest can see has moved, so there is nothing to tell them. A duration change
    // reaches this function and must not produce an email that restates the same booking.
    const previousStartIso = params.previous?.startDateTime ?? null
    const previousPartySize = params.previous?.partySize ?? null
    const startUnchanged =
      previousStartIso !== null &&
      booking.start_datetime !== null &&
      Date.parse(previousStartIso) === Date.parse(booking.start_datetime)
    const partySizeUnchanged =
      previousPartySize === null || Math.max(1, Number(previousPartySize)) === Math.max(1, Number(booking.party_size ?? 1))
    if (startUnchanged && partySizeUnchanged) {
      logger.info('Table booking amendment changed nothing the guest can see, so no notice was sent', {
        metadata: { tableBookingId: booking.id },
      })
      return
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_e164, mobile_number, email, sms_status, sms_opt_in, marketing_sms_opt_in, email_status, email_deactivated_at, marketing_email_opt_in')
      .eq('id', booking.customer_id)
      .maybeSingle()

    if (!customer) {
      return
    }

    const firstName = getSmartFirstName(customer.first_name)
    const bookingMoment = formatLondonDateTime(booking.start_datetime)
    const partySize = Math.max(1, Number(booking.party_size ?? 1))
    const seatWord = partySize === 1 ? 'person' : 'people'
    const isOutside = Boolean(booking.is_outside_seating)
    const grantedHighChairs = Math.max(0, Number(booking.high_chair_count ?? 0))
    const bookingNoun = isOutside ? 'outside booking' : 'table booking'

    let manageLink: string | null = null
    let shortLinkFallback = false
    try {
      const token = await createTableManageToken(supabase, {
        customerId: customer.id,
        tableBookingId: booking.id,
        bookingStartIso: booking.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
      })
      const shortened = await buildGuestShortLink({
        longUrl: token.url,
        linkKind: 'table_manage',
        customerId: customer.id,
        tableBookingId: booking.id,
      })
      manageLink = shortened.url
      shortLinkFallback = !shortened.shortened
    } catch {
      manageLink = null
    }

    // A booking that still owes a deposit is not confirmed, whatever the amendment did. Its
    // payment link is minted again here, because the one the guest was sent names the same hold
    // and that hold is what the deposit is racing.
    const isConfirmed = status === 'confirmed'
    const depositAmount = getCanonicalDeposit({
      party_size: partySize,
      deposit_amount: booking.deposit_amount,
      deposit_amount_locked: booking.deposit_amount_locked,
      status: booking.status,
      payment_status: booking.payment_status,
      deposit_waived: booking.deposit_waived,
      booking_type: booking.booking_type,
    })
    const holdIsLive = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) > Date.now() : false

    let depositPaymentLink: string | null = null
    if (!isConfirmed && depositAmount > 0 && holdIsLive && booking.hold_expires_at) {
      try {
        const paymentToken = await createTablePaymentToken(supabase, {
          customerId: customer.id,
          tableBookingId: booking.id,
          holdExpiresAt: booking.hold_expires_at,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
        })
        const shortenedPayment = await buildGuestShortLink({
          longUrl: paymentToken.url,
          linkKind: 'table_payment',
          customerId: customer.id,
          tableBookingId: booking.id,
        })
        depositPaymentLink = shortenedPayment.url
        if (!shortenedPayment.shortened) shortLinkFallback = true
      } catch (paymentLinkError) {
        depositPaymentLink = null
        logger.warn('Could not mint a payment link for an amended booking that still owes a deposit', {
          metadata: {
            tableBookingId: booking.id,
            error: paymentLinkError instanceof Error ? paymentLinkError.message : String(paymentLinkError),
          },
        })
      }
    }

    const depositLabel =
      depositAmount > 0
        ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
        : null
    const depositFacts =
      !isConfirmed && depositLabel
        ? {
            depositLabel,
            paymentLink: depositPaymentLink,
            isChristmas: isChristmasBookingType(booking.booking_type),
            perPersonGbp:
              booking.deposit_basis === 'per_booking'
                ? null
                : Number.isFinite(Number(booking.deposit_rate)) && Number(booking.deposit_rate) > 0
                  ? Number(booking.deposit_rate)
                  : depositPerPerson(depositAmount, partySize),
            refundCutoffDays: booking.deposit_refund_cutoff_days ?? null,
            payByIso: holdIsLive ? booking.hold_expires_at : null,
          }
        : null

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const highChairSuffix = grantedHighChairs > 0 ? ` High chair reserved x${grantedHighChairs}.` : ''
    const outsideSuffix = isOutside ? ' Outside seating (weather permitting).' : ''
    const previousMomentForSms = previousStartIso ? formatLondonDateTime(previousStartIso) : null
    const wasSuffix =
      previousMomentForSms && previousMomentForSms !== bookingMoment ? ` It was ${previousMomentForSms}.` : ''
    const statusSuffix = isConfirmed
      ? " It's still confirmed."
      : depositFacts
        ? ` It is not confirmed yet: we still need your deposit of ${depositFacts.depositLabel}.`
        : ' It is not confirmed yet.'
    const linkSuffix = !isConfirmed && depositPaymentLink
      ? ` Pay your deposit: ${depositPaymentLink}`
      : manageLink
        ? ` Manage booking: ${manageLink}`
        : ''
    const smsBody = `The Anchor: Hi ${firstName}, your ${bookingNoun} has been updated to ${bookingMoment} for ${partySize} ${seatWord}.${wasSuffix}${statusSuffix}${highChairSuffix}${outsideSuffix}${linkSuffix}`

    const emailContent = buildTableBookingRescheduledEmail({
      firstName,
      bookingReference: booking.booking_reference,
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time,
      startDateTime: booking.start_datetime,
      partySize,
      status,
      manageLink,
      highChairCount: grantedHighChairs,
      isOutsideSeating: isOutside,
      previousStartDateTime: previousStartIso,
      previousPartySize,
      deposit: depositFacts,
    })

    const templateKey = 'table_booking_rescheduled'

    let notificationResult: Awaited<ReturnType<typeof notifyCustomer>>
    try {
      notificationResult = await notifyCustomer({
        supabase,
        customerId: customer.id,
        customer,
        policy: 'email_first',
        urgency: 'standard',
        category: 'transactional',
        email: {
          to: customer.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          commType: templateKey,
          tableBookingId: booking.id,
          metadata: {
            table_booking_id: booking.id,
            template_key: templateKey,
            channel_policy: 'email_first',
          },
        },
        sms: {
          to: customer.mobile_number || customer.mobile_e164 || undefined,
          body: ensureReplyInstruction(smsBody, supportPhone),
          options: {
            customerId: customer.id,
            metadata: {
              table_booking_id: booking.id,
              template_key: templateKey,
            },
          },
        },
      })
    } catch (notifyError) {
      logger.warn('Table booking rescheduled notification threw unexpectedly', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        },
      })
      await AuditService.logAuditEvent({
        operation_type: 'table_booking.notification_failed',
        resource_type: 'table_booking',
        resource_id: booking.id,
        operation_status: 'failure',
        error_message: notifyError instanceof Error ? notifyError.message : String(notifyError),
        additional_info: {
          comm_type: templateKey,
          customer_id: customer.id,
        },
      })
      return
    }

    const smsAttempt = notificationResult.attempts.find((attempt) => attempt.channel === 'sms')
    const emailAttempt = notificationResult.attempts.find((attempt) => attempt.channel === 'email')
    const smsCode = typeof smsAttempt?.code === 'string' ? smsAttempt.code : null
    const smsLogFailure = smsAttempt?.logFailure === true || smsCode === 'logging_failed'
    const delivered =
      smsAttempt?.success === true || smsLogFailure || emailAttempt?.success === true

    await AuditService.logAuditEvent({
      operation_type: delivered ? 'table_booking.notification_sent' : 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: delivered ? 'success' : 'failure',
      error_message: delivered
        ? undefined
        : (smsAttempt?.error ?? emailAttempt?.error ?? notificationResult.noChannelReason ?? undefined),
      additional_info: {
        comm_type: templateKey,
        customer_id: customer.id,
        booking_reference: booking.booking_reference,
        selected_channels: notificationResult.selectedChannels,
        sms_code: smsCode,
        short_link_fallback: shortLinkFallback,
      },
    })
  } catch (error) {
    logger.warn('Table booking rescheduled notification threw unexpectedly', {
      metadata: {
        tableBookingId: params.tableBookingId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    // Do not rethrow — notification failure must not affect the edit/move operation.
  }
}

export async function alignTablePaymentHoldToScheduledSend(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId: string
    scheduledSendIso: string
    bookingStartIso?: string | null
  }
): Promise<string | null> {
  if (!input.scheduledSendIso || !input.tableBookingId) {
    return null
  }

  const scheduledMs = Date.parse(input.scheduledSendIso)
  if (!Number.isFinite(scheduledMs)) {
    return null
  }

  const bookingStartMs = input.bookingStartIso ? Date.parse(input.bookingStartIso) : NaN
  const defaultExpiryMs = scheduledMs + 24 * 60 * 60 * 1000
  const nextExpiryMs = Number.isFinite(bookingStartMs)
    ? Math.min(defaultExpiryMs, bookingStartMs)
    : defaultExpiryMs
  const expiresAt = new Date(nextExpiryMs).toISOString()

  const [bookingSyncResult, holdSyncResult] = await Promise.allSettled([
    (async () => {
      const { data, error } = await supabase
        .from('table_bookings')
        .update({ hold_expires_at: expiresAt, updated_at: new Date().toISOString() })
        .eq('id', input.tableBookingId)
        .eq('status', 'pending_payment')
        .select('id')
        .maybeSingle()

      if (error) {
        throw error
      }

      return Boolean(data)
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('booking_holds')
        .update({
          scheduled_sms_send_time: input.scheduledSendIso,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('table_booking_id', input.tableBookingId)
        .eq('hold_type', 'payment_hold')
        .eq('status', 'active')
        .select('id')

      if (error) {
        throw error
      }

      return (data || []).length
    })(),
  ])

  const alignmentFailures: string[] = []

  if (bookingSyncResult.status === 'rejected') {
    alignmentFailures.push(
      `table_bookings_update_failed:${bookingSyncResult.reason instanceof Error
        ? bookingSyncResult.reason.message
        : String(bookingSyncResult.reason)}`
    )
  } else if (!bookingSyncResult.value) {
    alignmentFailures.push('table_bookings_update_no_rows')
  }

  if (holdSyncResult.status === 'rejected') {
    alignmentFailures.push(
      `booking_holds_update_failed:${holdSyncResult.reason instanceof Error
        ? holdSyncResult.reason.message
        : String(holdSyncResult.reason)}`
    )
  } else if (holdSyncResult.value === 0) {
    alignmentFailures.push('booking_holds_update_no_rows')
  }

  if (alignmentFailures.length > 0) {
    throw new Error(
      `Failed to align table payment hold state to scheduled SMS send time: ${alignmentFailures.join('; ')}`
    )
  }

  return expiresAt
}
