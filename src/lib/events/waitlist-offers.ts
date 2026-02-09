import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

export type WaitlistOfferCreateResult = {
  state: 'offered' | 'none' | 'blocked'
  waitlist_offer_id?: string
  waitlist_entry_id?: string
  event_id?: string
  customer_id?: string
  requested_seats?: number
  scheduled_sms_send_time?: string
  expires_at?: string
  event_start_datetime?: string
  reason?: string
}

export type WaitlistOfferAcceptResult = {
  state: 'confirmed' | 'pending_payment' | 'blocked'
  booking_id?: string
  status?: string
  payment_mode?: string
  event_id?: string
  event_name?: string
  event_start_datetime?: string
  hold_expires_at?: string
  reason?: string
}

export type WaitlistOfferPreviewResult = {
  state: 'ready' | 'blocked'
  reason?: string
  waitlist_offer_id?: string
  event_id?: string
  event_name?: string
  payment_mode?: string
  requested_seats?: number
  event_start_datetime?: string | null
  expires_at?: string
}

function formatLondonDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return 'your event time'
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
    return 'your event time'
  }
}

function computeOfferExpiryFromScheduledSend(
  scheduledSendAtIso: string,
  eventStartDateTimeIso: string | null | undefined
): string {
  const scheduledMs = Date.parse(scheduledSendAtIso)
  const fallbackMs = Date.now() + 24 * 60 * 60 * 1000
  const baseMs = Number.isFinite(scheduledMs) ? scheduledMs : fallbackMs
  const defaultExpiryMs = baseMs + 24 * 60 * 60 * 1000
  const eventStartMs = eventStartDateTimeIso ? Date.parse(eventStartDateTimeIso) : Number.NaN

  if (Number.isFinite(eventStartMs)) {
    return new Date(Math.min(defaultExpiryMs, eventStartMs)).toISOString()
  }

  return new Date(defaultExpiryMs).toISOString()
}

function resolveEventStartDateTimeIso(
  event: { start_datetime?: string | null; date?: string | null; time?: string | null } | null | undefined,
  fallback?: string | null
): string | undefined {
  if (event?.start_datetime) {
    return event.start_datetime
  }

  if (event?.date && event?.time) {
    const parsed = Date.parse(`${event.date}T${event.time}:00Z`)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString()
    }
  }

  return fallback ?? undefined
}

export async function createNextWaitlistOffer(
  supabase: SupabaseClient<any, 'public', any>,
  eventId: string
): Promise<WaitlistOfferCreateResult> {
  const { data, error } = await supabase.rpc('create_next_waitlist_offer_v05', {
    p_event_id: eventId
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as WaitlistOfferCreateResult
}

export async function sendWaitlistOfferSms(
  supabase: SupabaseClient<any, 'public', any>,
  offer: WaitlistOfferCreateResult,
  appBaseUrl: string
): Promise<{ success: boolean; scheduledSendAt?: string; reason?: string }> {
  if (offer.state !== 'offered' || !offer.waitlist_offer_id || !offer.customer_id || !offer.event_id) {
    return { success: false, reason: 'invalid_offer_payload' }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', offer.customer_id)
    .maybeSingle()

  if (customerError || !customer) {
    logger.warn('Failed to load customer for waitlist offer SMS', {
      metadata: { offerId: offer.waitlist_offer_id, error: customerError?.message }
    })
    return { success: false, reason: 'customer_not_found' }
  }

  if (customer.sms_status !== 'active') {
    return { success: false, reason: 'sms_not_active' }
  }

  const { data: eventRow } = await supabase
    .from('events')
    .select('name, start_datetime, date, time')
    .eq('id', offer.event_id)
    .maybeSingle()

  const eventStartDateTimeIso = resolveEventStartDateTimeIso(eventRow, offer.event_start_datetime ?? null)
  const quietHoursState = evaluateSmsQuietHours()
  const predictedScheduledSendAt = quietHoursState.nextAllowedSendAt.toISOString()
  const predictedExpiry = computeOfferExpiryFromScheduledSend(predictedScheduledSendAt, eventStartDateTimeIso)
  if (Date.parse(predictedExpiry) <= Date.parse(predictedScheduledSendAt)) {
    return { success: false, reason: 'offer_window_unavailable' }
  }

  const { rawToken, hashedToken } = await createGuestToken(supabase, {
    customerId: customer.id,
    actionType: 'waitlist_offer',
    waitlistOfferId: offer.waitlist_offer_id,
    expiresAt: predictedExpiry
  })

  const confirmUrl = `${appBaseUrl}/g/${rawToken}/waitlist-offer`
  const seatCount = offer.requested_seats ?? 1
  const seatWord = seatCount === 1 ? 'seat' : 'seats'

  const eventName = eventRow?.name || 'your event'
  const eventStart = formatLondonDateTime(eventStartDateTimeIso)

  const firstName = customer.first_name || 'there'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  const messageBody = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, seats are now available for ${eventName} on ${eventStart}. We're holding ${seatCount} ${seatWord} for 24 hours. Review and confirm here: ${confirmUrl}`,
    supportPhone
  )

  const smsResult = await sendSMS(customer.mobile_number, messageBody, {
    customerId: customer.id,
    metadata: {
      waitlist_offer_id: offer.waitlist_offer_id,
      event_id: offer.event_id,
      template_key: 'event_waitlist_offer'
    }
  })

  if (!smsResult.success) {
    await supabase
      .from('guest_tokens')
      .delete()
      .eq('hashed_token', hashGuestToken(rawToken))

    logger.warn('Failed to send waitlist offer SMS', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: smsResult.error
      }
    })

    return { success: false, reason: 'sms_send_failed' }
  }

  const scheduledSendAt = smsResult.scheduledFor || new Date().toISOString()
  const effectiveExpiresAt = computeOfferExpiryFromScheduledSend(scheduledSendAt, eventStartDateTimeIso)

  await Promise.all([
    recordAnalyticsEvent(supabase, {
      customerId: customer.id,
      eventType: 'waitlist_offer_sent',
      metadata: {
        waitlist_offer_id: offer.waitlist_offer_id,
        event_id: offer.event_id,
        scheduled_send_at: scheduledSendAt,
        expires_at: effectiveExpiresAt
      }
    }),
    supabase
      .from('waitlist_offers')
      .update({
        scheduled_sms_send_time: scheduledSendAt,
        sent_at: scheduledSendAt,
        expires_at: effectiveExpiresAt
      })
      .eq('id', offer.waitlist_offer_id),
    supabase
      .from('booking_holds')
      .update({
        scheduled_sms_send_time: scheduledSendAt,
        expires_at: effectiveExpiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('waitlist_offer_id', offer.waitlist_offer_id)
      .eq('status', 'active'),
    supabase
      .from('guest_tokens')
      .update({
        expires_at: effectiveExpiresAt
      })
      .eq('hashed_token', hashedToken)
  ])

  return { success: true, scheduledSendAt }
}

export async function getWaitlistOfferPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<WaitlistOfferPreviewResult> {
  const hashedToken = hashGuestToken(rawToken)

  const { data: token, error: tokenError } = await supabase
    .from('guest_tokens')
    .select('waitlist_offer_id, expires_at, consumed_at')
    .eq('hashed_token', hashedToken)
    .eq('action_type', 'waitlist_offer')
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

  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) {
    return { state: 'blocked', reason: 'token_expired' }
  }

  if (!token.waitlist_offer_id) {
    return { state: 'blocked', reason: 'offer_not_found' }
  }

  const { data: offer, error: offerError } = await supabase
    .from('waitlist_offers')
    .select('id, event_id, seats_held, status, expires_at')
    .eq('id', token.waitlist_offer_id)
    .maybeSingle()

  if (offerError) {
    throw offerError
  }

  if (!offer) {
    return { state: 'blocked', reason: 'offer_not_found' }
  }

  if (offer.status !== 'sent') {
    return { state: 'blocked', reason: 'offer_unavailable' }
  }

  if (Date.parse(offer.expires_at) <= Date.now()) {
    return { state: 'blocked', reason: 'offer_expired' }
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, payment_mode, start_datetime')
    .eq('id', offer.event_id)
    .maybeSingle()

  if (eventError) {
    throw eventError
  }

  return {
    state: 'ready',
    waitlist_offer_id: offer.id,
    event_id: offer.event_id,
    event_name: event?.name ?? 'your event',
    payment_mode: event?.payment_mode ?? 'free',
    requested_seats: offer.seats_held,
    event_start_datetime: event?.start_datetime ?? null,
    expires_at: offer.expires_at
  }
}

export async function acceptWaitlistOfferByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<WaitlistOfferAcceptResult> {
  const hashedToken = hashGuestToken(rawToken)

  const { data, error } = await supabase.rpc('accept_waitlist_offer_v05', {
    p_hashed_token: hashedToken,
    p_source: 'brand_site'
  })

  if (error) {
    throw error
  }

  return (data ?? {}) as WaitlistOfferAcceptResult
}
