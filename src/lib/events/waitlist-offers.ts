import type { SupabaseClient } from '@supabase/supabase-js'
import { hashGuestToken } from '@/lib/guest/tokens'

/**
 * The waiting list was removed on 28 October 2026 (owner decision D11, BK-138): nobody had ever
 * joined it, and its offers went by text only. Nothing creates an offer any more (the join
 * endpoint answers 410 and the offer cron is gone). The preview and accept paths stay so that a
 * link already in someone's hands still answers honestly rather than 404ing.
 */

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
