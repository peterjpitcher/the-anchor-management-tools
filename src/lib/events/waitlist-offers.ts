import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
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
  customer_id?: string
  waitlist_offer_id?: string
  event_id?: string
  event_name?: string
  payment_mode?: string
  requested_seats?: number
  event_start_datetime?: string | null
  expires_at?: string
}

export type WaitlistOfferSmsDispatchResult = {
  success: boolean
  scheduledSendAt?: string
  reason?: string
  code?: string
  logFailure?: boolean
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

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const thrownCode = typeof (error as any)?.code === 'string' ? (error as any).code : null
  const thrownLogFailure = (error as any)?.logFailure === true || thrownCode === 'logging_failed'

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
  ) {
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
): Promise<WaitlistOfferSmsDispatchResult> {
  if (offer.state !== 'offered' || !offer.waitlist_offer_id || !offer.customer_id || !offer.event_id) {
    return { success: false, reason: 'invalid_offer_payload' }
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, mobile_number, sms_status')
    .eq('id', offer.customer_id)
    .maybeSingle()

  if (customerError) {
    logger.warn('Failed to load customer for waitlist offer SMS', {
      metadata: { offerId: offer.waitlist_offer_id, error: customerError?.message }
    })
    return {
      success: false,
      reason: 'customer_lookup_failed',
      code: 'safety_unavailable',
      logFailure: false
    }
  }

  if (!customer) {
    logger.warn('Waitlist offer SMS customer lookup affected no rows', {
      metadata: { offerId: offer.waitlist_offer_id, customerId: offer.customer_id }
    })
    return { success: false, reason: 'customer_not_found' }
  }

  if (customer.sms_status !== 'active') {
    return { success: false, reason: 'sms_not_active' }
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('name, start_datetime, date, time')
    .eq('id', offer.event_id)
    .maybeSingle()

  if (eventError) {
    logger.warn('Failed to load event for waitlist offer SMS', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        eventId: offer.event_id,
        error: eventError.message,
      },
    })
    return {
      success: false,
      reason: 'event_lookup_failed',
      code: 'safety_unavailable',
      logFailure: false
    }
  }

  if (!eventRow) {
    logger.warn('Waitlist offer SMS event lookup affected no rows', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        eventId: offer.event_id,
      },
    })
    return { success: false, reason: 'event_not_found' }
  }

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

  const firstName = getSmartFirstName(customer.first_name)
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

  const messageBody = ensureReplyInstruction(
    `The Anchor: Hi ${firstName}, seats are now available for ${eventName} on ${eventStart}. We're holding ${seatCount} ${seatWord} for 24 hours. Review and confirm here: ${confirmUrl}`,
    supportPhone
  )

  const cleanupWaitlistGuestTokenAfterSmsFailure = async () => {
    const { error: tokenDeleteError } = await supabase
      .from('guest_tokens')
      .delete()
      .eq('hashed_token', hashGuestToken(rawToken))

    if (tokenDeleteError) {
      logger.warn('Failed to remove guest token after waitlist offer SMS failure', {
        metadata: {
          offerId: offer.waitlist_offer_id,
          customerId: customer.id,
          error: tokenDeleteError.message
        }
      })
    }
  }

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        waitlist_offer_id: offer.waitlist_offer_id,
        waitlist_entry_id: offer.waitlist_entry_id,
        event_id: offer.event_id,
        template_key: 'event_waitlist_offer'
      }
    })
  } catch (smsError) {
    await cleanupWaitlistGuestTokenAfterSmsFailure()
    const normalizedSmsSafety = normalizeThrownSmsSafety(smsError)
    logger.warn('Waitlist offer SMS send threw unexpectedly', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: smsError instanceof Error ? smsError.message : String(smsError),
        code: normalizedSmsSafety.code,
        logFailure: normalizedSmsSafety.logFailure
      }
    })
    return {
      success: false,
      reason: 'sms_send_failed',
      code: normalizedSmsSafety.code,
      logFailure: normalizedSmsSafety.logFailure
    }
  }

  const smsCode = smsResult.code
  // Normalize fatal logging failures so callers can reliably abort fanout loops.
  const smsLogFailure =
    smsResult.logFailure === true || smsCode === 'logging_failed' ? true : smsResult.logFailure

  if (!smsResult.success) {
    await cleanupWaitlistGuestTokenAfterSmsFailure()

    logger.warn('Failed to send waitlist offer SMS', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: smsResult.error
      }
    })

    return {
      success: false,
      reason: 'sms_send_failed',
      code: smsCode,
      logFailure: smsLogFailure
    }
  }

  const scheduledSendAt = smsResult.scheduledFor || new Date().toISOString()
  const effectiveExpiresAt = computeOfferExpiryFromScheduledSend(scheduledSendAt, eventStartDateTimeIso)
  let criticalPersistenceError = false

  try {
    await recordAnalyticsEvent(supabase, {
      customerId: customer.id,
      eventType: 'waitlist_offer_sent',
      metadata: {
        waitlist_offer_id: offer.waitlist_offer_id,
        event_id: offer.event_id,
        scheduled_send_at: scheduledSendAt,
        expires_at: effectiveExpiresAt
      }
    })
  } catch (analyticsError) {
    logger.warn('Failed to record waitlist offer sent analytics event', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }

  const { data: updatedOffer, error: offerUpdateError } = await supabase
    .from('waitlist_offers')
    .update({
      scheduled_sms_send_time: scheduledSendAt,
      sent_at: scheduledSendAt,
      expires_at: effectiveExpiresAt
    })
    .eq('id', offer.waitlist_offer_id)
    .select('id')
    .maybeSingle()

  if (offerUpdateError) {
    criticalPersistenceError = true
    logger.error('Failed to persist waitlist offer SMS send timestamps', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: offerUpdateError.message
      }
    })
  } else if (!updatedOffer) {
    criticalPersistenceError = true
    logger.warn('Waitlist offer SMS send timestamp update affected no rows', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id
      }
    })
  }

  const { data: updatedHolds, error: holdUpdateError } = await supabase
    .from('booking_holds')
    .update({
      scheduled_sms_send_time: scheduledSendAt,
      expires_at: effectiveExpiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('waitlist_offer_id', offer.waitlist_offer_id)
    .eq('status', 'active')
    .select('id')

  if (holdUpdateError) {
    criticalPersistenceError = true
    logger.error('Failed to persist waitlist hold SMS send timestamps', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: holdUpdateError.message
      }
    })
  } else if (!updatedHolds || updatedHolds.length === 0) {
    criticalPersistenceError = true
    logger.warn('Waitlist hold SMS send timestamp update affected no rows', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id
      }
    })
  }

  const { data: updatedToken, error: tokenUpdateError } = await supabase
    .from('guest_tokens')
    .update({
      expires_at: effectiveExpiresAt
    })
    .eq('hashed_token', hashedToken)
    .select('id')
    .maybeSingle()

  if (tokenUpdateError) {
    criticalPersistenceError = true
    logger.error('Failed to persist waitlist guest token expiry after SMS send', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id,
        error: tokenUpdateError.message
      }
    })
  } else if (!updatedToken) {
    criticalPersistenceError = true
    logger.warn('Waitlist guest token expiry update affected no rows', {
      metadata: {
        offerId: offer.waitlist_offer_id,
        customerId: customer.id
      }
    })
  }

  if (criticalPersistenceError) {
    return {
      // SMS was sent (or scheduled) but we could not persist critical state updates.
      // Treat this as `logging_failed` so callers abort rather than retrying and fanning out duplicates.
      success: true,
      scheduledSendAt,
      reason: 'post_send_persistence_failed',
      code: 'logging_failed',
      logFailure: true
    }
  }

  return {
    success: true,
    scheduledSendAt,
    code: smsCode,
    logFailure: smsLogFailure
  }
}

export async function getWaitlistOfferPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<WaitlistOfferPreviewResult> {
  const hashedToken = hashGuestToken(rawToken)

  const { data: token, error: tokenError } = await supabase
    .from('guest_tokens')
    .select('customer_id, waitlist_offer_id, expires_at, consumed_at')
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
    customer_id: token.customer_id,
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
