/**
 * The unsubscribe link that has to appear in every marketing email.
 *
 * The venue's marketing email sits on a soft opt-in basis, the same one the SMS audience
 * moved to on 8 August. That basis holds only while a working opt-out is offered in every
 * message, so this is not a nicety: it is the thing that makes the sending lawful.
 *
 * ONE DURABLE TOKEN PER CUSTOMER, and it never expires. Not a per-message expiring token,
 * because a guest who digs out an email from last Christmas and taps unsubscribe must
 * actually be unsubscribed. A link that has quietly expired is worse than no link, since
 * it looks like an opt-out and does nothing.
 *
 * WHY THE TOKEN IS STORED IN THE CLEAR, unlike guest_tokens. Those are hashed because
 * they can cancel a booking or authorise a payment. This one can do exactly one thing:
 * stop marketing email reaching one person. That is low harm, fully reversible by the
 * guest or by staff, and it is the outcome the guest was asking for anyway. Set against
 * that, a hash cannot be reversed, so a hashed token could never be put back into next
 * month's email, and the link would have to rotate on every send. Rotating breaks every
 * link already sitting in somebody's inbox, which defeats the entire point. The table is
 * service-role only with RLS on.
 */

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function resolveBaseUrl(appBaseUrl?: string): string {
  const base = appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
  return base.replace(/\/+$/, '')
}

export function buildUnsubscribeUrl(rawToken: string, appBaseUrl?: string): string {
  return `${resolveBaseUrl(appBaseUrl)}/api/unsubscribe?t=${encodeURIComponent(rawToken)}`
}

/**
 * This customer's unsubscribe URL, minting the token on first use and reusing it forever
 * after.
 *
 * Returns null rather than throwing. A failure to build an unsubscribe link must never be
 * the reason a booking confirmation does not reach a guest: the caller decides, and for
 * transactional mail the right answer is to send it anyway without the header.
 */
export async function getOrCreateUnsubscribeUrl(
  supabase: SupabaseClient<any, 'public', any>,
  customerId: string,
  appBaseUrl?: string
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('customer_id', customerId)
      .maybeSingle()

    if (existing?.token) {
      return buildUnsubscribeUrl(existing.token as string, appBaseUrl)
    }

    const rawToken = generateToken()
    const { error } = await supabase
      .from('email_unsubscribe_tokens')
      .insert({ token: rawToken, customer_id: customerId })

    if (error) {
      // Most likely another send raced us to the same customer. Read theirs rather than
      // failing, so both messages carry a working link and both carry the SAME link.
      const { data: raced } = await supabase
        .from('email_unsubscribe_tokens')
        .select('token')
        .eq('customer_id', customerId)
        .maybeSingle()
      return raced?.token ? buildUnsubscribeUrl(raced.token as string, appBaseUrl) : null
    }

    return buildUnsubscribeUrl(rawToken, appBaseUrl)
  } catch {
    return null
  }
}

/**
 * This business contact's unsubscribe URL.
 *
 * Same token scheme and the same reasoning as the customer version above. A token belongs
 * to exactly one subject, enforced by a CHECK constraint on the table, so a contact and a
 * customer can never share one.
 */
export async function getOrCreateContactUnsubscribeUrl(
  supabase: SupabaseClient<any, 'public', any>,
  businessContactId: string,
  appBaseUrl?: string
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('business_contact_id', businessContactId)
      .maybeSingle()

    if (existing?.token) {
      return buildUnsubscribeUrl(existing.token as string, appBaseUrl)
    }

    const rawToken = generateToken()
    const { error } = await supabase
      .from('email_unsubscribe_tokens')
      .insert({ token: rawToken, business_contact_id: businessContactId })

    if (error) {
      const { data: raced } = await supabase
        .from('email_unsubscribe_tokens')
        .select('token')
        .eq('business_contact_id', businessContactId)
        .maybeSingle()
      return raced?.token ? buildUnsubscribeUrl(raced.token as string, appBaseUrl) : null
    }

    return buildUnsubscribeUrl(rawToken, appBaseUrl)
  } catch {
    return null
  }
}

export type UnsubscribeLookup =
  | { ok: true; subjectType: 'customer'; customerId: string; businessContactId: null }
  | { ok: true; subjectType: 'business_contact'; customerId: null; businessContactId: string }
  | { ok: false }

/**
 * Resolve a raw token to its subject, which is either a customer or a business contact.
 *
 * Says nothing about why a token failed. Somebody probing tokens learns the same from
 * every miss, and a guest sees the same page either way.
 */
export async function lookupUnsubscribeToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<UnsubscribeLookup> {
  // A short or absent token cannot be one of ours: 32 random bytes is 43 base64url
  // characters. Rejecting early keeps obvious junk off the database.
  if (!rawToken || rawToken.length < 20) return { ok: false }

  const { data, error } = await supabase
    .from('email_unsubscribe_tokens')
    .select('customer_id, business_contact_id')
    .eq('token', rawToken)
    .maybeSingle()

  if (error || !data) return { ok: false }

  if (data.customer_id) {
    return {
      ok: true,
      subjectType: 'customer',
      customerId: data.customer_id as string,
      businessContactId: null,
    }
  }

  if (data.business_contact_id) {
    return {
      ok: true,
      subjectType: 'business_contact',
      customerId: null,
      businessContactId: data.business_contact_id as string,
    }
  }

  return { ok: false }
}

/** Best-effort usage stamp. Never blocks the opt-out itself. */
export async function recordUnsubscribeUse(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<void> {
  try {
    await supabase.rpc('record_unsubscribe_token_use', { p_token: rawToken })
  } catch {
    // Deliberately swallowed. Losing a usage counter is not a reason to tell a guest
    // their unsubscribe failed.
  }
}
