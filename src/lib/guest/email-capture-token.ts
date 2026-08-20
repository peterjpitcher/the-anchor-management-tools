/**
 * Reading and answering an email_capture token.
 *
 * Split from the page and the route for the same reason lookupConfirmToken is: the page
 * reads to render, the route reads to write, and a difference between the two reads is how
 * a guest gets told "thanks" for an address that was never stored.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { hashGuestToken } from '@/lib/guest/tokens'

export type EmailCaptureCustomer = {
  id: string
  firstName: string | null
  /** Already on file. Non-null means the guest, or staff, has since supplied one. */
  existingEmail: string | null
}

export type EmailCaptureLookup =
  | { ok: true; customer: EmailCaptureCustomer; alreadyDone: boolean }
  | { ok: false; reason: 'not_found' | 'expired' | 'customer_missing' }

/**
 * Resolve a raw token to its customer, or say precisely why not.
 *
 * A bad token and an expired token are distinguished for the guest, not the attacker:
 * every failure renders the same page offering the pub's phone number, and none of them
 * reveals whether the token ever existed.
 */
export async function lookupEmailCaptureToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<EmailCaptureLookup> {
  const hashedToken = hashGuestToken(rawToken)

  const { data: guestToken, error } = await supabase
    .from('guest_tokens')
    .select('id, customer_id, expires_at, consumed_at')
    .eq('hashed_token', hashedToken)
    .eq('action_type', 'email_capture')
    .maybeSingle()

  if (error || !guestToken || !guestToken.customer_id) {
    return { ok: false, reason: 'not_found' }
  }

  if (guestToken.expires_at && Date.parse(guestToken.expires_at) <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, email')
    .eq('id', guestToken.customer_id)
    .maybeSingle()

  if (!customer) {
    return { ok: false, reason: 'customer_missing' }
  }

  // "Already done" is deliberately derived from the customer record rather than from
  // consumed_at. A guest who taps the link twice, or who gave their address at the bar in
  // between, should be told it is already handled rather than asked a second time.
  const existingEmail = ((customer.email as string | null) ?? '').trim() || null

  return {
    ok: true,
    alreadyDone: existingEmail !== null || guestToken.consumed_at !== null,
    customer: {
      id: customer.id as string,
      firstName: (customer.first_name as string | null) ?? null,
      existingEmail,
    },
  }
}

/**
 * Loose shape check, matching the website's booking form exactly: something, an @,
 * something, a dot, at least two more, and no spaces.
 *
 * Deliberately not an RFC-shaped regex. Those reject real addresses, and a guest told
 * their own working address is invalid simply closes the page, which is the entire
 * conversion this feature exists to win.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}
