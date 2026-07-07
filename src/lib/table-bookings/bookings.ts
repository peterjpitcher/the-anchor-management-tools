import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
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
  booking_purpose?: 'food' | 'drinks'
  booking_type?: string
  start_datetime?: string
  end_datetime?: string
  hold_expires_at?: string
  sunday_lunch?: boolean
  sunday_preorder_cutoff_at?: string | null
  high_chairs_granted?: number
  high_chair_count?: number
  is_outside_seating?: boolean
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
    case 'outside_hours':
    case 'hours_not_configured':
    case 'outside_service_window':
    case 'sunday_lunch_requires_sunday':
      return 'outside_hours'
    default:
      return 'blocked'
  }
}

function formatLondonDateTime(isoDateTime?: string | null): string {
  if (!isoDateTime) return 'your booking time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoDateTime))
  } catch {
    return 'your booking time'
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

function buildTableBookingCustomerEmail(input: {
  firstName: string
  bookingMoment: string
  partySize: number
  seatWord: string
  bookingReference?: string | null
  state: TableBookingState
  manageLink?: string | null
  paymentLink?: string | null
  depositLabel?: string | null
}): { subject: string; html: string; text: string } {
  const safeFirstName = escapeHtml(input.firstName)
  const safeBookingMoment = escapeHtml(input.bookingMoment)
  const safePartySize = escapeHtml(String(input.partySize))
  const safeSeatWord = escapeHtml(input.seatWord)
  const safeReference = input.bookingReference ? escapeHtml(input.bookingReference) : null
  const isPendingPayment = input.state === 'pending_payment'
  const subject = isPendingPayment
    ? 'Secure your table at The Anchor'
    : 'Your table booking at The Anchor is confirmed'

  const intro = isPendingPayment
    ? `Hi ${safeFirstName}, please pay your ${escapeHtml(input.depositLabel || 'table deposit')} to secure your table.`
    : `Hi ${safeFirstName}, your table booking is confirmed.`

  const cta = isPendingPayment
    ? input.paymentLink
      ? `<p><a href="${escapeHtml(input.paymentLink)}">Pay now</a></p>`
      : '<p>We will send your payment link shortly.</p>'
    : input.manageLink
      ? `<p><a href="${escapeHtml(input.manageLink)}">Manage your booking</a></p>`
      : ''

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">',
    `<p>${intro}</p>`,
    '<ul>',
    safeReference ? `<li><strong>Reference:</strong> ${safeReference}</li>` : '',
    `<li><strong>When:</strong> ${safeBookingMoment}</li>`,
    `<li><strong>Party size:</strong> ${safePartySize} ${safeSeatWord}</li>`,
    '</ul>',
    cta,
    '<p>If you need to change anything, reply to this email or call the pub.</p>',
    '<p>The Anchor</p>',
    '</div>',
  ].join('')

  const textLines = [
    isPendingPayment
      ? `Hi ${input.firstName}, please pay your ${input.depositLabel || 'table deposit'} to secure your table.`
      : `Hi ${input.firstName}, your table booking is confirmed.`,
    input.bookingReference ? `Reference: ${input.bookingReference}` : null,
    `When: ${input.bookingMoment}`,
    `Party size: ${input.partySize} ${input.seatWord}`,
    isPendingPayment
      ? input.paymentLink
        ? `Pay now: ${input.paymentLink}`
        : 'We will send your payment link shortly.'
      : input.manageLink
        ? `Manage booking: ${input.manageLink}`
        : null,
    'If you need to change anything, reply to this email or call the pub.',
    'The Anchor',
  ].filter((line): line is string => Boolean(line))

  return {
    subject,
    html,
    text: textLines.join('\n'),
  }
}

export async function sendManagerTableBookingCreatedEmailIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId?: string | null
    fallbackCustomerId?: string | null
    createdVia?: string
  }
): Promise<{ sent: boolean; skipped?: boolean; reason?: string; error?: string }> {
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
        special_requirements
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

  if (booking.special_requirements) {
    details.push(`<li><strong>Notes:</strong> ${escapeHtml(booking.special_requirements)}</li>`)
  }

  const html = [
    '<p>A new table booking has been created.</p>',
    '<ul>',
    ...details,
    '</ul>'
  ].join('')

  const emailResult = await sendEmail({
    to: MANAGER_TABLE_BOOKING_EMAIL,
    subject,
    html
  })

  if (!emailResult.success) {
    return {
      sent: false,
      error: emailResult.error || 'Failed to send manager booking email'
    }
  }

  return {
    sent: true
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

export async function sendTableBookingCreatedSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    normalizedPhone: string
    bookingResult: TableBookingRpcResult
    nextStepUrl?: string | null
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
  const depositAmount = Number(computeDepositAmount(partySize).toFixed(2))
  const depositLabel = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(depositAmount)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  let manageLink: string | null = null

  if (input.bookingResult.state === 'confirmed' && input.bookingResult.table_booking_id) {
    try {
      const token = await createTableManageToken(supabase, {
        customerId: input.customerId,
        tableBookingId: input.bookingResult.table_booking_id,
        bookingStartIso: input.bookingResult.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL
      })
      manageLink = token.url
    } catch {
      manageLink = null
    }
  }

  let smsBody: string
  if (input.bookingResult.state === 'pending_payment') {
    const depositKindLabel = input.bookingResult.sunday_lunch ? 'Sunday lunch deposit' : 'table deposit'
    const base = `The Anchor: Hi ${firstName}, please pay your ${depositKindLabel} of ${depositLabel} (${partySize} x GBP ${DEPOSIT_PER_PERSON_GBP}) to secure your table for ${partySize} ${seatWord} on ${bookingMoment}.`
    const cta = input.nextStepUrl ? `Pay now: ${input.nextStepUrl}` : 'We will text your payment link shortly.'
    smsBody = `${base} ${cta}`
  } else {
    smsBody = `The Anchor: Hi ${firstName}, your table booking for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  }

  const templateKey = input.bookingResult.state === 'pending_payment'
    ? 'table_booking_pending_payment'
    : 'table_booking_confirmed'
  const emailContent = buildTableBookingCustomerEmail({
    firstName,
    bookingMoment,
    partySize,
    seatWord,
    bookingReference: input.bookingResult.booking_reference || null,
    state: input.bookingResult.state,
    manageLink,
    paymentLink: input.nextStepUrl || null,
    depositLabel,
  })

  let notificationResult: Awaited<ReturnType<typeof notifyCustomer>>
  try {
    notificationResult = await notifyCustomer({
      supabase,
      customerId: input.customerId,
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
        tableBookingId: input.bookingResult.table_booking_id ?? null,
        metadata: {
          table_booking_id: input.bookingResult.table_booking_id,
          template_key: templateKey,
          channel_policy: 'email_first',
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
    },
  })

  return {
    notificationChannel: notificationResult.selectedChannels[0] ?? null,
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

export async function sendTableBookingConfirmedAfterDepositSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<SmsSafetyMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, customer_id, party_size, booking_date, booking_time, start_datetime, status, booking_type')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) {
    throw new Error(`Failed to load table booking for post-deposit SMS: ${bookingError.message}`)
  }

  if (!booking || booking.status !== 'confirmed' || !booking.customer_id) {
    return null
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
  const partySize = Math.max(1, Number(booking.party_size ?? 1))
  const seatWord = partySize === 1 ? 'person' : 'people'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const bookingMoment = formatLondonDateTime(booking.start_datetime)
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

  const composedMessage = `The Anchor: ${firstName}! Deposit sorted — your table for ${partySize} ${seatWord} on ${bookingMoment} is locked in. See you then!${manageLink ? ` ${manageLink}` : ''}`
  const templateKey = 'table_booking_deposit_confirmed'

  const body = ensureReplyInstruction(composedMessage, supportPhone)

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

export async function sendTableBookingCancelledSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  params: {
    customerId: string
    bookingReference: string
    bookingDate: string // YYYY-MM-DD format
    refundResult: { refunded: false; reason: string } | { refunded: true; amountPence: number; tier: string }
    tableBookingId?: string
  }
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

    // Format booking date for display (e.g. "Sat 14 Mar 2026")
    let dateLabel = params.bookingDate
    try {
      dateLabel = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${params.bookingDate}T12:00:00`))
    } catch {
      // fall back to raw date string
    }

    const firstName = getSmartFirstName(customer.first_name)
    let smsBody: string
    if (params.refundResult.refunded) {
      const amountGbp = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
      }).format(params.refundResult.amountPence / 100)

      smsBody = `The Anchor: ${firstName}, your booking on ${dateLabel} has been cancelled. Your ${amountGbp} refund will land within 5-10 days. Hope to see you again soon!`
    } else if (params.refundResult.reason === 'zero_tier') {
      smsBody = `The Anchor: ${firstName}, your booking on ${dateLabel} has been cancelled. As it's within 3 days, the deposit can't be refunded. Hope to see you another time!`
    } else {
      smsBody = `The Anchor: ${firstName}, your booking on ${dateLabel} has been cancelled. Hope to see you again soon!`
    }

    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

    const smsResult = await sendSMS(
      customer.mobile_number,
      ensureReplyInstruction(smsBody, supportPhone),
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
