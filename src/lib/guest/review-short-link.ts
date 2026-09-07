/**
 * Builds the review-ask link a guest actually receives, shortened.
 *
 * The raw link is `${appBaseUrl}/r/${rawToken}` where the token is 32 random
 * bytes base64url, 43 characters on top of a 38-character origin. At 81
 * characters it is the longest thing in the message by a wide margin.
 *
 * Why this exists when `shortenUrlsInSmsBody` already shortens outbound SMS:
 *
 * 1. **Email was never covered.** `sendSMS` rewrites URLs at send time
 *    (src/lib/twilio.ts), but `sendEmail` does not, and the table-booking
 *    review ask is email-first. So a guest with an email address received the
 *    full 81-character URL in the message body while a guest with only a mobile
 *    received a short one. Shortening here, at the point the link is built,
 *    fixes the email and covers both channels from one place.
 *
 * 2. **One link per guest, not one per channel.** Both the email and the SMS
 *    fallback now carry the same short code, so a click is one click no matter
 *    which channel the guest used.
 *
 * 3. **Metadata worth having.** The generic SMS shortener can only tag a link
 *    `source: 'sms_auto_shortener'`. Here we know the customer and the booking,
 *    so the row can say what it is and be traced back later.
 *
 * Double-shortening is not a risk: `shortenUrlsInSmsBody` skips any URL already
 * on a short-link host, so an SMS carrying the output of this module passes
 * through untouched.
 *
 * FAILURE BEHAVIOUR: never throws, and never blocks the send. If the short link
 * cannot be created the long URL is returned and the message still goes out
 * with a working link. A shorter message is a nicety; a review ask that never
 * arrives is a lost review. The failure is logged with the booking and customer
 * so it is visible in Vercel logs rather than silent.
 */

import { hashGuestToken } from '@/lib/guest/tokens'
import { logger } from '@/lib/logger'
import { ShortLinkService } from '@/services/short-links'

export interface GuestReviewLinkInput {
  /** Origin of the management app, e.g. https://management.orangejelly.co.uk */
  appBaseUrl: string
  /** The raw (unhashed) guest token returned by createGuestToken. */
  rawToken: string
  customerId: string
  eventBookingId?: string | null
  tableBookingId?: string | null
}

export interface GuestReviewLinkResult {
  /** The URL to put in front of the guest. Short when shortening worked. */
  url: string
  /** False when we fell back to the long /r/ URL. */
  shortened: boolean
}

export function buildLongGuestReviewUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/r/${rawToken}`
}

export async function buildGuestReviewUrl(input: GuestReviewLinkInput): Promise<GuestReviewLinkResult> {
  const longUrl = buildLongGuestReviewUrl(input.appBaseUrl, input.rawToken)

  try {
    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: longUrl,
      // 'custom' is the only value in the short_links link_type CHECK constraint
      // that fits a one-off guest link, so no migration is needed. The row is
      // told apart from a staff-made link by metadata.guest_link_kind, and it
      // stays out of the staff /short-links list because createShortLinkInternal
      // leaves created_by NULL (see ShortLinkService.getShortLinks includeSystem).
      link_type: 'custom',
      // No explicit name: deriveShortLinkName already special-cases an `/r/` path
      // and returns 'Review Link' (src/lib/short-links/names.ts). Review links
      // shortened at SMS send time have carried that name for as long as the
      // auto-shortener has existed, so naming these anything else would leave one
      // kind of link with two names in the table.
      metadata: {
        source: 'guest_review_ask',
        guest_link_kind: 'guest_review',
        guest_action_type: 'review_redirect',
        // The hash, never the raw token: this row is readable by every member of
        // staff who can see short links, and the raw token IS the credential.
        guest_token_hash: hashGuestToken(input.rawToken),
        customer_id: input.customerId,
        event_booking_id: input.eventBookingId ?? null,
        table_booking_id: input.tableBookingId ?? null,
      },
    })

    if (!result?.full_url) {
      throw new Error('Short link service returned no URL')
    }

    return { url: result.full_url, shortened: true }
  } catch (error) {
    logger.warn('Failed to shorten guest review link; sending the full-length URL', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        customerId: input.customerId,
        eventBookingId: input.eventBookingId ?? null,
        tableBookingId: input.tableBookingId ?? null,
      },
    })

    return { url: longUrl, shortened: false }
  }
}
