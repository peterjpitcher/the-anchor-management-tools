import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

const LONDON_TIMEZONE = 'Europe/London'
const TOKEN_MIN_VALID_MS = 60 * 60 * 1000
const TOKEN_DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const TOKEN_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY = 'private_booking_feedback_followup'
export const PRIVATE_BOOKING_FEEDBACK_MANAGER_EMAIL = 'manager@the-anchor.pub'

export type PrivateBookingFeedbackPreview = {
  state: 'ready' | 'submitted' | 'blocked'
  reason?: string
  token_id?: string
  customer_id?: string
  private_booking_id?: string
  customer_first_name?: string | null
  customer_last_name?: string | null
  customer_name?: string | null
  event_date?: string | null
  start_time?: string | null
  status?: string | null
  guest_count?: number | null
  submitted_at?: string | null
}

export type SubmitPrivateBookingFeedbackInput = {
  rawToken: string
  ratingOverall: number
  ratingFood?: number | null
  ratingService?: number | null
  comments?: string | null
}

export type SubmitPrivateBookingFeedbackResult = {
  state: 'submitted' | 'blocked'
  reason?: string
  private_booking_id?: string
  feedback_id?: string | null
  manager_email_sent?: boolean
}

function resolveAppBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function resolvePrivateBookingStartIso(eventDate?: string | null, startTime?: string | null): string | null {
  if (!eventDate) return null
  const normalizedTime = startTime && startTime.length >= 5 ? startTime.slice(0, 5) : '12:00'

  try {
    const date = fromZonedTime(`${eventDate}T${normalizedTime}`, LONDON_TIMEZONE)
    if (!Number.isFinite(date.getTime())) {
      return null
    }
    return date.toISOString()
  } catch {
    return null
  }
}

function formatDateTimeForEmail(isoDate?: string | null): string {
  if (!isoDate) return 'Unknown'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TIMEZONE,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(isoDate))
  } catch {
    return 'Unknown'
  }
}

function computeFeedbackTokenExpiry(bookingStartIso?: string | null): string {
  const now = Date.now()
  const minMs = now + TOKEN_MIN_VALID_MS
  const maxMs = now + TOKEN_MAX_WINDOW_MS
  const fallbackMs = now + TOKEN_DEFAULT_WINDOW_MS
  const bookingWindowMs = bookingStartIso ? Date.parse(bookingStartIso) + TOKEN_DEFAULT_WINDOW_MS : Number.NaN

  const candidateMs = Number.isFinite(bookingWindowMs)
    ? Math.max(minMs, Math.min(bookingWindowMs, maxMs))
    : Math.max(minMs, Math.min(fallbackMs, maxMs))

  return new Date(candidateMs).toISOString()
}

async function loadFeedbackTokenContext(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<{
  token: {
    id: string
    customer_id: string
    private_booking_id: string
    expires_at: string
    consumed_at: string | null
  }
  booking: {
    id: string
    customer_id: string | null
    customer_first_name: string | null
    customer_last_name: string | null
    customer_name: string | null
    event_date: string | null
    start_time: string | null
    status: string | null
    guest_count: number | null
  }
  feedback: {
    id: string
    created_at: string | null
  } | null
} | null> {
  const hashedToken = hashGuestToken(rawToken)
  const { data: tokenRow } = await (supabase.from('guest_tokens') as any)
    .select('id, customer_id, private_booking_id, expires_at, consumed_at')
    .eq('hashed_token', hashedToken)
    .eq('action_type', 'private_feedback')
    .maybeSingle()

  if (!tokenRow?.id || !tokenRow?.customer_id || !tokenRow?.private_booking_id) {
    return null
  }

  const { data: bookingRow } = await (supabase.from('private_bookings') as any)
    .select('id, customer_id, customer_first_name, customer_last_name, customer_name, event_date, start_time, status, guest_count')
    .eq('id', tokenRow.private_booking_id)
    .maybeSingle()

  if (!bookingRow?.id) {
    return null
  }

  const { data: feedbackRow } = await (supabase.from('feedback') as any)
    .select('id, created_at')
    .eq('private_booking_id', bookingRow.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    token: tokenRow,
    booking: bookingRow,
    feedback: feedbackRow || null
  }
}

export async function createPrivateBookingFeedbackToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    privateBookingId: string
    eventDate?: string | null
    startTime?: string | null
    bookingStartIso?: string | null
    appBaseUrl?: string
  }
): Promise<{ rawToken: string; url: string; expiresAt: string }> {
  const bookingStartIso = input.bookingStartIso || resolvePrivateBookingStartIso(input.eventDate, input.startTime)
  const expiresAt = computeFeedbackTokenExpiry(bookingStartIso)
  const { rawToken } = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'private_feedback',
    privateBookingId: input.privateBookingId,
    expiresAt
  })

  const appBaseUrl = resolveAppBaseUrl(input.appBaseUrl)
  return {
    rawToken,
    url: `${appBaseUrl}/g/${rawToken}/private-feedback`,
    expiresAt
  }
}

export async function getPrivateBookingFeedbackPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<PrivateBookingFeedbackPreview> {
  const context = await loadFeedbackTokenContext(supabase, rawToken)
  if (!context) {
    return { state: 'blocked', reason: 'invalid_token' }
  }

  const { token, booking, feedback } = context

  if (booking.customer_id && booking.customer_id !== token.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  if (feedback?.id) {
    return {
      state: 'submitted',
      customer_id: token.customer_id,
      private_booking_id: booking.id,
      customer_first_name: booking.customer_first_name,
      customer_last_name: booking.customer_last_name,
      customer_name: booking.customer_name,
      event_date: booking.event_date,
      start_time: booking.start_time,
      status: booking.status,
      guest_count: parseNumber(booking.guest_count, 0) || null,
      submitted_at: feedback.created_at || null
    }
  }

  if (token.consumed_at) {
    return { state: 'blocked', reason: 'token_used' }
  }

  const expiresAtMs = Date.parse(token.expires_at || '')
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  if (booking.status === 'cancelled') {
    return { state: 'blocked', reason: 'booking_cancelled' }
  }

  return {
    state: 'ready',
    token_id: token.id,
    customer_id: token.customer_id,
    private_booking_id: booking.id,
    customer_first_name: booking.customer_first_name,
    customer_last_name: booking.customer_last_name,
    customer_name: booking.customer_name,
    event_date: booking.event_date,
    start_time: booking.start_time,
    status: booking.status,
    guest_count: parseNumber(booking.guest_count, 0) || null
  }
}

async function sendPrivateBookingFeedbackManagerEmail(
  input: {
    customerName: string
    privateBookingId: string
    eventDate?: string | null
    startTime?: string | null
    ratingOverall: number
    ratingFood?: number | null
    ratingService?: number | null
    comments?: string | null
  }
): Promise<boolean> {
  const eventStartIso = resolvePrivateBookingStartIso(input.eventDate, input.startTime)
  const eventDateText = formatDateTimeForEmail(eventStartIso)
  const subject = `Private booking feedback received (${input.ratingOverall}/5)`

  const rows = [
    `<li><strong>Booking:</strong> ${escapeHtml(input.privateBookingId)}</li>`,
    `<li><strong>Guest:</strong> ${escapeHtml(input.customerName || 'Guest')}</li>`,
    `<li><strong>Event date/time:</strong> ${escapeHtml(eventDateText)}</li>`,
    `<li><strong>Overall rating:</strong> ${escapeHtml(String(input.ratingOverall))}/5</li>`,
    `<li><strong>Food rating:</strong> ${input.ratingFood ? `${escapeHtml(String(input.ratingFood))}/5` : 'Not provided'}</li>`,
    `<li><strong>Service rating:</strong> ${input.ratingService ? `${escapeHtml(String(input.ratingService))}/5` : 'Not provided'}</li>`
  ]

  const comments = input.comments?.trim()
  const html = [
    '<p>A private-booking feedback form was submitted.</p>',
    '<ul>',
    ...rows,
    '</ul>',
    comments ? `<p><strong>Comments:</strong><br/>${escapeHtml(comments)}</p>` : '<p><strong>Comments:</strong> None provided.</p>'
  ].join('')

  let result: Awaited<ReturnType<typeof sendEmail>>
  try {
    result = await sendEmail({
      to: PRIVATE_BOOKING_FEEDBACK_MANAGER_EMAIL,
      subject,
      html
    })
  } catch (emailError) {
    logger.warn('Private-booking feedback manager email send threw unexpectedly', {
      metadata: {
        privateBookingId: input.privateBookingId,
        error: emailError instanceof Error ? emailError.message : String(emailError)
      }
    })
    return false
  }

  if (!result.success) {
    logger.warn('Failed to send private-booking feedback manager email', {
      metadata: {
        privateBookingId: input.privateBookingId,
        error: result.error || 'unknown'
      }
    })
  }

  return result.success
}

export async function submitPrivateBookingFeedbackByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: SubmitPrivateBookingFeedbackInput
): Promise<SubmitPrivateBookingFeedbackResult> {
  const preview = await getPrivateBookingFeedbackPreviewByRawToken(supabase, input.rawToken)
  if (preview.state === 'submitted') {
    return {
      state: 'submitted',
      private_booking_id: preview.private_booking_id
    }
  }

  if (preview.state !== 'ready' || !preview.private_booking_id || !preview.customer_id || !preview.token_id) {
    return {
      state: 'blocked',
      reason: preview.reason || 'invalid_token'
    }
  }

  const comments = input.comments?.trim() || null
  const ratingOverall = parseNumber(input.ratingOverall)
  const ratingFood = input.ratingFood == null ? null : parseNumber(input.ratingFood)
  const ratingService = input.ratingService == null ? null : parseNumber(input.ratingService)
  const tokenConsumedAt = new Date().toISOString()

  const { data: consumedToken, error: tokenConsumeError } = await (supabase.from('guest_tokens') as any)
    .update({ consumed_at: tokenConsumedAt })
    .eq('id', preview.token_id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()

  if (tokenConsumeError) {
    throw tokenConsumeError
  }

  if (!consumedToken) {
    const { data: existingFeedback, error: existingFeedbackError } = await (supabase.from('feedback') as any)
      .select('id')
      .eq('private_booking_id', preview.private_booking_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingFeedbackError) {
      throw existingFeedbackError
    }

    if (existingFeedback?.id) {
      return {
        state: 'submitted',
        private_booking_id: preview.private_booking_id,
        feedback_id: existingFeedback.id,
        manager_email_sent: false
      }
    }

    return {
      state: 'blocked',
      reason: 'token_used'
    }
  }

  const { data: insertedFeedback, error: insertError } = await (supabase.from('feedback') as any)
    .insert({
      private_booking_id: preview.private_booking_id,
      rating_overall: ratingOverall,
      rating_food: ratingFood,
      rating_service: ratingService,
      comments
    })
    .select('id, created_at')
    .maybeSingle()

  if (insertError) {
    const { data: rollbackToken, error: rollbackTokenConsumeError } = await (supabase.from('guest_tokens') as any)
      .update({ consumed_at: null })
      .eq('id', preview.token_id)
      .eq('consumed_at', tokenConsumedAt)
      .select('id')
      .maybeSingle()

    if (rollbackTokenConsumeError) {
      logger.error('Failed to rollback private-feedback token consumption after insert failure', {
        error: new Error(rollbackTokenConsumeError.message),
        metadata: {
          tokenId: preview.token_id,
          privateBookingId: preview.private_booking_id
        }
      })
    } else if (!rollbackToken) {
      logger.error('Private-feedback token rollback affected no rows after insert failure', {
        metadata: {
          tokenId: preview.token_id,
          privateBookingId: preview.private_booking_id
        }
      })
    }

    throw insertError
  }

  try {
    await recordAnalyticsEvent(supabase, {
      customerId: preview.customer_id,
      privateBookingId: preview.private_booking_id,
      eventType: 'feedback_submitted',
      metadata: {
        rating_overall: ratingOverall,
        rating_food: ratingFood,
        rating_service: ratingService
      }
    })
  } catch (analyticsError) {
    logger.warn('Failed to record private-booking feedback analytics event', {
      metadata: {
        privateBookingId: preview.private_booking_id,
        customerId: preview.customer_id,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }

  const customerName =
    `${preview.customer_first_name || ''} ${preview.customer_last_name || ''}`.trim() ||
    preview.customer_name ||
    'Guest'

  let managerEmailSent = false
  try {
    managerEmailSent = await sendPrivateBookingFeedbackManagerEmail({
      customerName,
      privateBookingId: preview.private_booking_id,
      eventDate: preview.event_date,
      startTime: preview.start_time,
      ratingOverall,
      ratingFood,
      ratingService,
      comments
    })
  } catch (emailError) {
    logger.warn('Unexpected private-booking feedback email failure', {
      metadata: {
        privateBookingId: preview.private_booking_id,
        error: emailError instanceof Error ? emailError.message : String(emailError)
      }
    })
  }

  return {
    state: 'submitted',
    private_booking_id: preview.private_booking_id,
    feedback_id: insertedFeedback?.id || null,
    manager_email_sent: managerEmailSent
  }
}
