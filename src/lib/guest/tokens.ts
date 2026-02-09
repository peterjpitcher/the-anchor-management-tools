import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type GuestTokenActionType =
  | 'manage'
  | 'sunday_preorder'
  | 'card_capture'
  | 'payment'
  | 'review_redirect'
  | 'charge_approval'
  | 'waitlist_offer'
  | 'private_feedback'

export type CreateGuestTokenInput = {
  customerId: string
  actionType: GuestTokenActionType
  expiresAt: string
  eventBookingId?: string | null
  tableBookingId?: string | null
  privateBookingId?: string | null
  chargeRequestId?: string | null
  waitlistOfferId?: string | null
}

export function generateGuestToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashGuestToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export async function createGuestToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: CreateGuestTokenInput
): Promise<{ rawToken: string; hashedToken: string }> {
  const rawToken = generateGuestToken()
  const hashedToken = hashGuestToken(rawToken)

  const { error } = await supabase
    .from('guest_tokens')
    .insert({
      hashed_token: hashedToken,
      customer_id: input.customerId,
      event_booking_id: input.eventBookingId ?? null,
      table_booking_id: input.tableBookingId ?? null,
      private_booking_id: input.privateBookingId ?? null,
      charge_request_id: input.chargeRequestId ?? null,
      waitlist_offer_id: input.waitlistOfferId ?? null,
      action_type: input.actionType,
      expires_at: input.expiresAt
    })

  if (error) {
    throw error
  }

  return { rawToken, hashedToken }
}
