import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

type GuestTokenActionType =
  | 'manage'
  | 'sunday_preorder'
  | 'payment'
  | 'review_redirect'
  | 'charge_approval'
  | 'waitlist_offer'
  | 'private_feedback'
  | 'private_booking_outcome'
  | 'booking_confirm'
  | 'email_capture'

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

/**
 * Exported because a token's raw value is needed BEFORE its row exists.
 *
 * The email-capture send builds the message (which embeds the token URL), sends it, and only
 * then writes the row, so that a send which never left the building leaves no trace and the
 * recipient stays eligible. See lib/sms/email-capture.ts for why that ordering matters.
 */
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
