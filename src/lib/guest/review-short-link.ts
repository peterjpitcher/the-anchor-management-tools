/**
 * The review-ask link a guest receives, shortened.
 *
 * This is a thin wrapper over `buildGuestShortLink` (src/lib/guest/guest-short-link.ts),
 * which owns the shortening rules for every guest link kind. It stays as its own
 * module because the review ask is the one caller that needs the `/r/` URL built
 * for it from an app base and a raw token, rather than handed a URL a token
 * minter already produced.
 *
 * Why the review ask is shortened at all, and why here rather than at send time:
 * the table-booking review ask is email-first, and only `sendSMS` rewrites URLs
 * (src/lib/twilio.ts). Before this, a guest with an email address got the full
 * 81-character URL while a guest with only a mobile got a short one. Doing it
 * once, up front, fixes the email and gives the email and the SMS fallback the
 * same short code, so a click is counted once whichever channel the guest used.
 *
 * FAILURE BEHAVIOUR: never throws. On failure the long URL is returned and the
 * caller counts the fallback into the cron's response.
 */

import { buildGuestShortLink } from '@/lib/guest/guest-short-link'

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
  return buildGuestShortLink({
    longUrl: buildLongGuestReviewUrl(input.appBaseUrl, input.rawToken),
    linkKind: 'guest_review',
    customerId: input.customerId,
    eventBookingId: input.eventBookingId ?? null,
    tableBookingId: input.tableBookingId ?? null,
  })
}
