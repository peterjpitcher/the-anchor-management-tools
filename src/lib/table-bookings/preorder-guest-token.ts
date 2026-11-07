/**
 * The link one guest is sent to choose their own Christmas dinner (A4).
 *
 * A `preorder_guest` token is scoped to ONE seat (`preorder_cover_id`) on one booking, and it stops
 * working at the booking's pre-order cutoff, so a guest's link can never reach anyone else's dinner,
 * cancel or change the booking, or edit a choice after the kitchen has the order. Only the hash is
 * stored, the same as every other guest link.
 *
 * Resolving a token proves which seat the visitor may change. Pass that seat to `savePreorderCover`
 * as `actor: { savedBy: 'guest', coverId }` with the booking as `tableBookingId`, and the save refuses
 * any other seat.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUrl } from '@/lib/env'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'

// `any` on purpose: the same loose client type the other guest token helpers take.
type Db = SupabaseClient<any, 'public', any>

export const PREORDER_GUEST_TOKEN_ACTION_TYPE = 'preorder_guest' as const

export type CreatePreorderGuestTokenInput = {
  /** The booking's customer. Every guest token is owned by the booking's customer. */
  customerId: string
  tableBookingId: string
  /** The one seat this link may change. */
  coverId: string
  /** When the link stops working: the booking's pre-order cutoff, as an ISO instant. */
  expiresAt: string
  appBaseUrl?: string
}

export type PreorderGuestToken = {
  rawToken: string
  /** The guest's page, `/g/<token>/christmas-choice`. */
  url: string
  expiresAt: string
}

export type PreorderGuestTokenResolution =
  | { ok: true; tableBookingId: string; coverId: string; customerId: string; expiresAt: string }
  | { ok: false; reason: 'invalid_token' | 'expired_token' }

/**
 * Create a guest's own food link. Refuses an expiry that is not a real instant, because a link with
 * no usable cutoff would stay open after the kitchen has the order.
 */
export async function createPreorderGuestToken(
  supabase: Db,
  input: CreatePreorderGuestTokenInput,
): Promise<PreorderGuestToken> {
  const expiresMs = Date.parse(input.expiresAt)
  if (!Number.isFinite(expiresMs)) {
    throw new Error('A guest food link needs the pre-order cutoff as its expiry.')
  }
  const expiresAt = new Date(expiresMs).toISOString()

  const token = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: PREORDER_GUEST_TOKEN_ACTION_TYPE,
    tableBookingId: input.tableBookingId,
    preorderCoverId: input.coverId,
    expiresAt,
  })

  const baseUrl = (input.appBaseUrl || getAppUrl()).replace(/\/+$/, '')
  return {
    rawToken: token.rawToken,
    url: `${baseUrl}/g/${token.rawToken}/christmas-choice`,
    expiresAt,
  }
}

/**
 * Which seat a guest's link may change, or why it cannot be used. A token of any other type is
 * `invalid_token`, even a valid manage link for the same booking: a manage link reaches the whole
 * booking, and this page must never be a way in to it. Expired means the cutoff has passed.
 *
 * `now` is injectable for tests; it defaults to the current time.
 */
export async function resolvePreorderGuestToken(
  supabase: Db,
  rawToken: string,
  now: Date = new Date(),
): Promise<PreorderGuestTokenResolution> {
  if (typeof rawToken !== 'string' || rawToken.trim() === '') return { ok: false, reason: 'invalid_token' }

  const { data, error } = await supabase
    .from('guest_tokens')
    .select('customer_id, table_booking_id, preorder_cover_id, action_type, expires_at, consumed_at')
    .eq('hashed_token', hashGuestToken(rawToken))
    .eq('action_type', PREORDER_GUEST_TOKEN_ACTION_TYPE)
    .maybeSingle()

  if (error) throw error

  const row = data as {
    customer_id: string | null
    table_booking_id: string | null
    preorder_cover_id: string | null
    action_type: string | null
    expires_at: string | null
    consumed_at: string | null
  } | null

  // The type is checked again here, not only in the query, so a looser query can never widen it.
  if (
    !row ||
    row.action_type !== PREORDER_GUEST_TOKEN_ACTION_TYPE ||
    !row.customer_id ||
    !row.table_booking_id ||
    !row.preorder_cover_id ||
    row.consumed_at
  ) {
    return { ok: false, reason: 'invalid_token' }
  }

  const expiresMs = Date.parse(row.expires_at ?? '')
  if (!Number.isFinite(expiresMs)) return { ok: false, reason: 'invalid_token' }
  if (expiresMs <= now.getTime()) return { ok: false, reason: 'expired_token' }

  return {
    ok: true,
    tableBookingId: row.table_booking_id,
    coverId: row.preorder_cover_id,
    customerId: row.customer_id,
    expiresAt: new Date(expiresMs).toISOString(),
  }
}
