import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'

export type TableBookingState = 'confirmed' | 'pending_card_capture' | 'blocked'

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

export async function sendTableBookingCreatedSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    normalizedPhone: string
    bookingResult: TableBookingRpcResult
    nextStepUrl?: string | null
  }
): Promise<{ scheduledFor?: string }> {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', input.customerId)
    .maybeSingle()

  if (error || !customer || customer.sms_status !== 'active') {
    return {}
  }

  const firstName = customer.first_name || 'there'
  const bookingMoment = formatLondonDateTime(input.bookingResult.start_datetime)
  const partySize = Math.max(1, Number(input.bookingResult.party_size ?? 1))
  const seatWord = partySize === 1 ? 'person' : 'people'
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
  } else {
    smsBody = `The Anchor: Hi ${firstName}, your table booking for ${partySize} ${seatWord} on ${bookingMoment} is confirmed.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  }

  const result = await sendSMS(
    customer.mobile_number || input.normalizedPhone,
    ensureReplyInstruction(smsBody, supportPhone),
    {
      customerId: input.customerId,
      metadata: {
        table_booking_id: input.bookingResult.table_booking_id,
        template_key:
          input.bookingResult.state === 'pending_card_capture'
            ? 'table_booking_pending_card_capture'
            : 'table_booking_confirmed'
      }
    }
  )

  return {
    scheduledFor: result.success ? result.scheduledFor : undefined
  }
}

export async function sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<void> {
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('id, customer_id, party_size, booking_date, booking_time, start_datetime, status, booking_type')
    .eq('id', tableBookingId)
    .maybeSingle()

  if (error || !booking || booking.status !== 'confirmed' || !booking.customer_id) {
    return
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', booking.customer_id)
    .maybeSingle()

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return
  }

  const firstName = customer.first_name || 'there'
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

  await sendSMS(customer.mobile_number, body, {
    customerId: customer.id,
    metadata: {
      table_booking_id: tableBookingId,
      template_key: sundayPreorderTemplateKey
    }
  })
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
): Promise<{ sent: boolean; scheduledFor?: string; url?: string }> {
  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', input.customerId)
    .maybeSingle()

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return { sent: false }
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
    return { sent: false }
  }

  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const firstName = customer.first_name || 'there'
  const referenceSnippet = input.bookingReference ? ` for booking ${input.bookingReference}` : ''
  const message = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, please complete your Sunday lunch pre-order${referenceSnippet}. Complete here: ${tokenUrl}`,
    supportPhone
  )

  const result = await sendSMS(customer.mobile_number, message, {
    customerId: customer.id,
    metadata: {
      table_booking_id: input.tableBookingId,
      template_key: 'sunday_preorder_request'
    }
  })

  return {
    sent: result.success,
    scheduledFor: result.success ? result.scheduledFor : undefined,
    url: tokenUrl
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

  await Promise.allSettled([
    supabase
      .from('table_bookings')
      .update({ hold_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('id', input.tableBookingId)
      .eq('status', 'pending_card_capture'),
    supabase
      .from('booking_holds')
      .update({
        scheduled_sms_send_time: input.scheduledSendIso,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('table_booking_id', input.tableBookingId)
      .eq('hold_type', 'card_capture_hold')
      .eq('status', 'active'),
    supabase
      .from('card_captures')
      .update({ expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('table_booking_id', input.tableBookingId)
      .eq('status', 'pending')
  ])

  return expiresAt
}
