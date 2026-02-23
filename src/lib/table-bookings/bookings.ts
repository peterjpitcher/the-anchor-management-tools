import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import {
  computeStripeCheckoutExpiresAtUnix,
  createStripeTableDepositCheckoutSession,
  type StripeCheckoutSession,
} from '@/lib/payments/stripe'
import { logger } from '@/lib/logger'

export type TableBookingState = 'confirmed' | 'pending_card_capture' | 'pending_payment' | 'blocked'

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
  card_capture_required?: boolean
  sunday_lunch?: boolean
  sunday_preorder_cutoff_at?: string | null
}

export type TableCardCapturePreview = {
  state: 'ready' | 'already_completed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  booking_date?: string
  booking_time?: string
  party_size?: number
  booking_type?: string
  booking_purpose?: string
  status?: string
  hold_expires_at?: string
  start_datetime?: string
  end_datetime?: string
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
}

export const MANAGER_TABLE_BOOKING_EMAIL = 'manager@the-anchor.pub'

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const thrownCode = typeof (error as any)?.code === 'string' ? (error as any).code : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'

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

  const { data: bookingRaw, error: bookingError } = await (supabase.from('table_bookings') as any)
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

export async function createTableCardCaptureToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    tableBookingId: string
    holdExpiresAt: string
    appBaseUrl: string
  }
): Promise<{ rawToken: string; url: string; hashedToken: string }> {
  const { rawToken, hashedToken } = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'card_capture',
    tableBookingId: input.tableBookingId,
    expiresAt: input.holdExpiresAt
  })

  return {
    rawToken,
    url: `${input.appBaseUrl}/g/${rawToken}/card-capture`,
    hashedToken
  }
}

export async function getTableCardCapturePreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<TableCardCapturePreview> {
  const tokenHash = hashGuestToken(rawToken)
  const { data, error } = await supabase.rpc('get_table_card_capture_preview_v05', {
    p_hashed_token: tokenHash
  })

  if (error) {
    throw error
  }

  return ((data ?? {}) as TableCardCapturePreview)
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

  let booking: any = null
  let bookingError: any = null

  ;({ data: booking, error: bookingError } = await (supabase.from('table_bookings') as any)
    .select(`
      id,
      customer_id,
      status,
      hold_expires_at,
      party_size,
      committed_party_size,
      booking_reference,
      booking_date,
      booking_time,
      start_datetime,
      booking_type
    `)
    .eq('id', token.table_booking_id)
    .maybeSingle())

  // Compatibility fallback for environments that have not yet applied committed_party_size.
  if (bookingError && /committed_party_size/i.test(String(bookingError.message || ''))) {
    ;({ data: booking, error: bookingError } = await (supabase.from('table_bookings') as any)
      .select(`
        id,
        customer_id,
        status,
        hold_expires_at,
        party_size,
        booking_reference,
        booking_date,
        booking_time,
        start_datetime,
        booking_type
      `)
      .eq('id', token.table_booking_id)
      .maybeSingle())
  }

  if (bookingError) {
    throw bookingError
  }

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.customer_id !== token.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  if (booking.status !== 'pending_payment') {
    return { state: 'blocked', reason: 'booking_not_pending_payment' }
  }

  const holdExpiry = parseIsoDate(booking.hold_expires_at)
  if (!holdExpiry || holdExpiry.getTime() <= Date.now()) {
    return { state: 'blocked', reason: 'hold_expired' }
  }

  const partySize = Math.max(1, Number(booking.committed_party_size ?? booking.party_size ?? 1))
  const totalAmount = Number((partySize * 10).toFixed(2))
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
    productName: `Sunday lunch deposit (${preview.partySize} ${preview.partySize === 1 ? 'person' : 'people'})`,
    tokenHash: preview.tokenHash,
    expiresAtUnix: computeStripeCheckoutExpiresAtUnix(preview.holdExpiresAt),
    metadata: {
      booking_reference: preview.bookingReference,
      deposit_per_person_gbp: '10',
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
              deposit_per_person: 10,
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
            deposit_per_person: 10,
            created_at: nowIso,
          },
        })

        if (insertError) {
          throw new Error(`Failed to insert pending table-deposit payment row: ${insertError.message}`)
        }
      }
    }
  } catch (persistenceError) {
    // Do not block guest checkout if payment-row persistence fails after Stripe session creation.
    // Webhook confirmation can still upsert payment state by checkout session metadata.
    logger.error('Failed to persist pending table-deposit payment row after Stripe checkout session creation', {
      error: persistenceError instanceof Error ? persistenceError : new Error(String(persistenceError)),
      metadata: {
        tableBookingId: preview.tableBookingId,
        checkoutSessionId: session.id,
      },
    })
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
): Promise<{ scheduledFor?: string; sms: SmsSafetyMeta }> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', input.customerId)
    .maybeSingle()

  if (error || !customer || customer.sms_status !== 'active') {
    return { sms: null }
  }

  const firstName = getSmartFirstName(customer.first_name)
  const bookingMoment = formatLondonDateTime(input.bookingResult.start_datetime)
  const partySize = Math.max(1, Number(input.bookingResult.party_size ?? 1))
  const seatWord = partySize === 1 ? 'person' : 'people'
  const depositAmount = Number((partySize * 10).toFixed(2))
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
  if (input.bookingResult.state === 'pending_card_capture') {
    const base = `The Anchor: Hi ${firstName}, please add card details to hold your table booking for ${partySize} ${seatWord} on ${bookingMoment}. No charge now.`
    const cta = input.nextStepUrl ? `Complete here: ${input.nextStepUrl}` : 'We will text your card details link shortly.'
    smsBody = `${base} ${cta}`
  } else if (input.bookingResult.state === 'pending_payment') {
    const base = `The Anchor: Hi ${firstName}, please pay your Sunday lunch deposit of ${depositLabel} (${partySize} x GBP 10) to secure your table for ${partySize} ${seatWord} on ${bookingMoment}.`
    const cta = input.nextStepUrl ? `Pay now: ${input.nextStepUrl}` : 'We will text your payment link shortly.'
    smsBody = `${base} ${cta}`
  } else {
    smsBody = `The Anchor: Hi ${firstName}, your table booking for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  }

  let result: Awaited<ReturnType<typeof sendSMS>>
  try {
    result = await sendSMS(
      customer.mobile_number || input.normalizedPhone,
      ensureReplyInstruction(smsBody, supportPhone),
      {
        customerId: input.customerId,
        metadata: {
          table_booking_id: input.bookingResult.table_booking_id,
          template_key:
            input.bookingResult.state === 'pending_card_capture'
              ? 'table_booking_pending_card_capture'
              : input.bookingResult.state === 'pending_payment'
                ? 'table_booking_pending_payment'
              : 'table_booking_confirmed'
        }
      }
    )
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Table booking created SMS threw unexpectedly', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })
    return {
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
    logger.error('Table booking created SMS sent but outbound message logging failed', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        code: smsCode,
        logFailure: smsLogFailure,
      },
    })
  }

  if (!result.success) {
    logger.warn('Table booking created SMS send returned non-success', {
      metadata: {
        tableBookingId: input.bookingResult.table_booking_id,
        customerId: input.customerId,
        state: input.bookingResult.state,
        error: result.error,
        code: smsCode,
      }
    })
  }

  return {
    scheduledFor: smsDeliveredOrUnknown ? result.scheduledFor : undefined,
    sms: {
      success: smsDeliveredOrUnknown,
      code: smsCode,
      logFailure: smsLogFailure,
    },
  }
}

export async function sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<SmsSafetyMeta> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, customer_id, party_size, booking_date, booking_time, start_datetime, status, booking_type')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (bookingError) {
    throw new Error(`Failed to load table booking for post-card-capture SMS: ${bookingError.message}`)
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
    throw new Error(`Failed to load customer for post-card-capture SMS: ${customerError.message}`)
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
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL
    })
    manageLink = token.url
  } catch {
    manageLink = null
  }

  let sundayPreorderLink: string | null = null
  if (booking.booking_type === 'sunday_lunch') {
    try {
      const token = await createSundayPreorderToken(supabase, {
        customerId: customer.id,
        tableBookingId,
        bookingStartIso: booking.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL
      })
      sundayPreorderLink = token.url
    } catch {
      sundayPreorderLink = null
    }
  }

  let composedMessage = `The Anchor: Hi ${firstName}, card details are added and your table booking for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  const sundayPreorderTemplateKey =
    booking.booking_type === 'sunday_lunch'
      ? resolveSundayPreorderTemplateKey(booking.start_datetime)
      : 'table_booking_card_capture_confirmed'

  if (sundayPreorderLink) {
    const preorderIntro =
      sundayPreorderTemplateKey === 'sunday_preorder_reminder_26h'
        ? 'Final reminder: please complete your Sunday lunch pre-order.'
        : 'please complete your Sunday lunch pre-order.'
    composedMessage = `${composedMessage} ${preorderIntro} Complete here: ${sundayPreorderLink}`
  }

  const body = ensureReplyInstruction(
    composedMessage,
    supportPhone
  )

  try {
    const smsResult = await sendSMS(customer.mobile_number, body, {
      customerId: customer.id,
      metadata: {
        table_booking_id: tableBookingId,
        template_key: sundayPreorderTemplateKey
      }
    })

    const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
    const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
    const smsDeliveredOrUnknown = smsResult.success === true || smsLogFailure

    if (smsLogFailure) {
      logger.error('Table booking post-card-capture SMS sent but outbound message logging failed', {
        metadata: {
          tableBookingId,
          customerId: customer.id,
          code: smsCode,
          logFailure: smsLogFailure,
        },
      })
    }

    if (!smsResult.success) {
      logger.warn('Table booking post-card-capture SMS send returned non-success', {
        metadata: {
          tableBookingId,
          customerId: customer.id,
          error: smsResult.error,
          code: smsCode,
        }
      })
    }

    return {
      success: smsDeliveredOrUnknown,
      code: smsCode,
      logFailure: smsLogFailure,
    }
  } catch (smsError) {
    const thrownSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Table booking post-card-capture SMS threw unexpectedly', {
      metadata: {
        tableBookingId,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: thrownSafety.code,
        logFailure: thrownSafety.logFailure,
      }
    })

    return {
      success: false,
      code: thrownSafety.code,
      logFailure: thrownSafety.logFailure,
    }
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

  let sundayPreorderLink: string | null = null
  if (booking.booking_type === 'sunday_lunch') {
    try {
      const token = await createSundayPreorderToken(supabase, {
        customerId: customer.id,
        tableBookingId,
        bookingStartIso: booking.start_datetime || null,
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
      })
      sundayPreorderLink = token.url
    } catch {
      sundayPreorderLink = null
    }
  }

  let composedMessage = `The Anchor: Hi ${firstName}, your Sunday lunch deposit is received and your table booking for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  let templateKey = 'table_booking_deposit_confirmed'

  if (sundayPreorderLink) {
    templateKey = resolveSundayPreorderTemplateKey(booking.start_datetime)
    const preorderIntro =
      templateKey === 'sunday_preorder_reminder_26h'
        ? 'Final reminder: please complete your Sunday lunch pre-order.'
        : 'Please complete your Sunday lunch pre-order.'
    composedMessage = `${composedMessage} ${preorderIntro} Complete here: ${sundayPreorderLink}`
  }

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
  const referenceSnippet = input.bookingReference ? ` for booking ${input.bookingReference}` : ''
  const message = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, please complete your Sunday lunch pre-order${referenceSnippet}. Complete here: ${tokenUrl}`,
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

export async function alignTableCardCaptureHoldToScheduledSend(
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

  const [bookingSyncResult, holdSyncResult, captureSyncResult] = await Promise.allSettled([
    (async () => {
      const { data, error } = await supabase
        .from('table_bookings')
        .update({ hold_expires_at: expiresAt, updated_at: new Date().toISOString() })
        .eq('id', input.tableBookingId)
        .eq('status', 'pending_card_capture')
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
          updated_at: new Date().toISOString()
        })
        .eq('table_booking_id', input.tableBookingId)
        .eq('hold_type', 'card_capture_hold')
        .eq('status', 'active')
        .select('id')

      if (error) {
        throw error
      }

      return (data || []).length
    })(),
    (async () => {
      const { data, error } = await supabase
        .from('card_captures')
        .update({ expires_at: expiresAt, updated_at: new Date().toISOString() })
        .eq('table_booking_id', input.tableBookingId)
        .eq('status', 'pending')
        .select('id')

      if (error) {
        throw error
      }

      return (data || []).length
    })()
  ])

  if (bookingSyncResult.status === 'rejected') {
    logger.warn('Failed to align table booking hold expiry to deferred card-capture SMS send time', {
      metadata: {
        tableBookingId: input.tableBookingId,
        error: bookingSyncResult.reason instanceof Error
          ? bookingSyncResult.reason.message
          : String(bookingSyncResult.reason)
      }
    })
  } else if (!bookingSyncResult.value) {
    logger.warn('Table booking hold-expiry alignment affected no rows', {
      metadata: {
        tableBookingId: input.tableBookingId
      }
    })
  }

  if (holdSyncResult.status === 'rejected') {
    logger.warn('Failed to align booking-hold expiry to deferred card-capture SMS send time', {
      metadata: {
        tableBookingId: input.tableBookingId,
        error: holdSyncResult.reason instanceof Error
          ? holdSyncResult.reason.message
          : String(holdSyncResult.reason)
      }
    })
  } else if (holdSyncResult.value === 0) {
    logger.warn('Booking-hold expiry alignment affected no rows', {
      metadata: {
        tableBookingId: input.tableBookingId
      }
    })
  }

  if (captureSyncResult.status === 'rejected') {
    logger.warn('Failed to align card-capture expiry to deferred card-capture SMS send time', {
      metadata: {
        tableBookingId: input.tableBookingId,
        error: captureSyncResult.reason instanceof Error
          ? captureSyncResult.reason.message
          : String(captureSyncResult.reason)
      }
    })
  } else if (captureSyncResult.value === 0) {
    logger.warn('Card-capture expiry alignment affected no rows', {
      metadata: {
        tableBookingId: input.tableBookingId
      }
    })
  }

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

  if (captureSyncResult.status === 'rejected') {
    alignmentFailures.push(
      `card_captures_update_failed:${captureSyncResult.reason instanceof Error
        ? captureSyncResult.reason.message
        : String(captureSyncResult.reason)}`
    )
  } else if (captureSyncResult.value === 0) {
    alignmentFailures.push('card_captures_update_no_rows')
  }

  if (alignmentFailures.length > 0) {
    throw new Error(
      `Failed to align table card-capture hold state to scheduled SMS send time: ${alignmentFailures.join('; ')}`
    )
  }

  return expiresAt
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
