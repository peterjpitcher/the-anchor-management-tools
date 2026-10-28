/**
 * Shortens a guest link before it is put into a message.
 *
 * `sendSMS` rewrites every URL in an outbound body at send time
 * (src/lib/twilio.ts), but `sendEmail` does not. So any flow that emails a guest
 * a token link ships the raw ~80-character URL. Measured in production over the
 * 90 days to 2026-09-07, every stored booking-confirmation email carried one.
 *
 * Shortening HERE, where the message is composed, rather than inside `sendEmail`
 * or inside the token minters:
 *
 * - `sendEmail` is the wrong place. It would also rewrite unsubscribe links
 *   (leaving the body disagreeing with the `List-Unsubscribe` header), PayPal
 *   approve URLs (off the destination allowlist, which THROWS), marketing links
 *   that already carry per-recipient tracking, and the cron alert email that
 *   fires when the system is unhealthy. It would also need an HTML-aware parser,
 *   because the SMS shortener's bare-URL regex eats `"` and `>` out of an anchor.
 * - The token minters are the wrong place too. `createTableManageToken`,
 *   `createTablePaymentToken`, `createEventManageToken` and
 *   `createEventPaymentToken` each return a URL that is ALSO handed back to API
 *   callers as `next_step_url` / `fallback_payment_url`, which the website uses
 *   to redirect a booker straight to the payment page. Shortening there would
 *   put a redirect hop and a bogus click in front of every website booking.
 *
 * Doing it at the message-composition site means the email and the SMS for the
 * same booking carry the same destination, and `createShortLinkInternal` dedupes
 * on `destination_url`, so both channels resolve to ONE short code and one click
 * count.
 *
 * SAFETY IS AN ALLOWLIST, not a denylist. A link can only be shortened if its
 * kind is named in `GuestShortLinkKind` and its path matches that kind's shape.
 * A denylist would have to anticipate every email the business will ever send;
 * this way a link cannot be shortened unless somebody deliberately adds a kind
 * for it, and `tsc` rejects anything else at the call site.
 *
 * FAILURE BEHAVIOUR: never throws, never blocks a send. On any failure the long
 * URL is returned and the caller records the fallback somewhere durable. A
 * shorter message is a nicety; a booking confirmation that never arrives is a
 * lost booking.
 */

import { randomInt } from 'crypto'
import { hashGuestToken } from '@/lib/guest/tokens'
import { logger } from '@/lib/logger'
import { isShortLinkHost } from '@/lib/short-links/routing'
import { ShortLinkService } from '@/services/short-links'

export type GuestShortLinkKind =
  | 'guest_review'
  | 'table_manage'
  | 'table_payment'
  | 'event_manage'
  | 'event_payment'
  | 'booking_confirm'
  | 'private_booking_portal'

/**
 * The only path shapes that may be shortened, one per kind. Verified against the
 * minters: table-manage `src/lib/table-bookings/manage-booking.ts:286`,
 * table-payment `src/lib/table-bookings/bookings.ts:663`, event-manage
 * `src/lib/events/manage-booking.ts:652`, event-payment
 * `src/lib/events/event-payments.ts:241`, review `src/app/r/[token]/route.ts`,
 * booking-confirm `createBookingConfirmToken` in `src/lib/table-bookings/manage-booking.ts`.
 *
 * booking_confirm points at the "are you still coming?" page, a GET that only asks. The
 * answer is a POST from that page, so a mail scanner or link preview that follows the short
 * link sees the question and cannot answer it for the guest.
 */
const LINK_KIND_PATH: Record<GuestShortLinkKind, RegExp> = {
  guest_review: /^\/r\/([^/]+)\/?$/,
  table_manage: /^\/g\/([^/]+)\/table-manage\/?$/,
  table_payment: /^\/g\/([^/]+)\/table-payment\/?$/,
  event_manage: /^\/g\/([^/]+)\/manage-booking\/?$/,
  event_payment: /^\/g\/([^/]+)\/event-payment\/?$/,
  booking_confirm: /^\/g\/([^/]+)\/confirm-booking\/?$/,
  // The private hire booking page, signed and time-limited (BK-172, BK-204).
  private_booking_portal: /^\/booking-portal\/([^/]+)\/?$/,
}

const LINK_KIND_ACTION_TYPE: Record<GuestShortLinkKind, string> = {
  guest_review: 'review_redirect',
  table_manage: 'manage',
  table_payment: 'payment',
  event_manage: 'manage',
  event_payment: 'payment',
  booking_confirm: 'booking_confirm',
  private_booking_portal: 'manage',
}

/**
 * Kept per kind so the review links already live in production keep saying
 * `guest_review_ask`. Relabelling them would split one kind of link across two
 * sources in the same table.
 */
const LINK_KIND_SOURCE: Record<GuestShortLinkKind, string> = {
  guest_review: 'guest_review_ask',
  table_manage: 'guest_link_builder',
  table_payment: 'guest_link_builder',
  event_manage: 'guest_link_builder',
  event_payment: 'guest_link_builder',
  booking_confirm: 'guest_link_builder',
  private_booking_portal: 'guest_link_builder',
}

/**
 * Guest short codes are 12 characters of a-z and 0-9 from Node's secure random generator
 * (BK-203, customer bookings review of 24 October 2026), about 4.7 million million million codes.
 *
 * They used to be the database's 6-character codes (about 2.2 billion, made with Postgres
 * random()), so the long secret inside a manage, payment or confirm link was only as strong as
 * the short code in front of it. 12 fits the 20-character short_code column, and the redirect
 * route counts wrong guesses per address.
 */
export const GUEST_SHORT_CODE_LENGTH = 12
const GUEST_SHORT_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateGuestShortCode(): string {
  let code = ''
  for (let i = 0; i < GUEST_SHORT_CODE_LENGTH; i += 1) {
    code += GUEST_SHORT_CODE_ALPHABET[randomInt(GUEST_SHORT_CODE_ALPHABET.length)]
  }
  return code
}

export interface GuestShortLinkInput {
  /** The full long URL, exactly as the token minter returned it. */
  longUrl: string
  linkKind: GuestShortLinkKind
  /** Null for a private booking not yet linked to a customer. */
  customerId: string | null
  privateBookingId?: string | null
  eventBookingId?: string | null
  tableBookingId?: string | null
}

export interface GuestShortLinkResult {
  /** The URL to put in front of the guest. Short when shortening worked. */
  url: string
  /** False when we fell back to the long URL. Record it, do not just log it. */
  shortened: boolean
}

function refuse(
  longUrl: string,
  reasonCode: string,
  input: GuestShortLinkInput,
  error?: unknown
): GuestShortLinkResult {
  logger.warn('Sending the full-length guest link; it could not be shortened', {
    ...(error ? { error: error instanceof Error ? error : new Error(String(error)) } : {}),
    metadata: {
      reason_code: reasonCode,
      link_kind: input.linkKind,
      customer_id: input.customerId,
      event_booking_id: input.eventBookingId ?? null,
      table_booking_id: input.tableBookingId ?? null,
      private_booking_id: input.privateBookingId ?? null,
    },
  })

  return { url: longUrl, shortened: false }
}

export async function buildGuestShortLink(input: GuestShortLinkInput): Promise<GuestShortLinkResult> {
  const longUrl = input.longUrl

  let parsed: URL
  try {
    parsed = new URL(longUrl)
  } catch {
    return refuse(longUrl, 'unparseable_url', input)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return refuse(longUrl, 'unsupported_protocol', input)
  }

  // Already short. Not a failure, and not worth a second row: return it as it is
  // and report success so the caller does not count a fallback.
  if (isShortLinkHost(parsed.hostname)) {
    return { url: longUrl, shortened: true }
  }

  // A query string or fragment is refused outright. The redirector sets
  // `short_code` on every destination, which re-serialises the whole query, and
  // that mangles a placeholder such as Stripe's `{CHECKOUT_SESSION_ID}` into
  // `%7BCHECKOUT_SESSION_ID%7D`, which Stripe substitutes by exact match.
  if (parsed.search || parsed.hash) {
    return refuse(longUrl, 'url_has_query_or_fragment', input)
  }

  const match = LINK_KIND_PATH[input.linkKind]?.exec(parsed.pathname)
  if (!match) {
    return refuse(longUrl, 'path_does_not_match_link_kind', input)
  }

  const rawToken = match[1]
  if (!rawToken) {
    return refuse(longUrl, 'no_token_in_path', input)
  }

  try {
    const result = await ShortLinkService.createShortLinkInternal({
      destination_url: longUrl,
      // 'custom' is what all existing guest short links use and the CHECK
      // constraint already allows it, so no migration. These rows stay out of the
      // staff /short-links list because createShortLinkInternal leaves created_by
      // NULL, which is exactly what getShortLinks filters on.
      link_type: 'custom',
      generate_code: generateGuestShortCode,
      // No name: deriveShortLinkName already turns these paths into readable
      // labels ('Table Manage', 'Event Payment', 'Review Link').
      metadata: {
        source: LINK_KIND_SOURCE[input.linkKind],
        guest_link_kind: input.linkKind,
        guest_action_type: LINK_KIND_ACTION_TYPE[input.linkKind],
        // The hash, never the raw token: `authenticated` holds SELECT on
        // short_links, and the raw token IS the credential.
        guest_token_hash: hashGuestToken(rawToken),
        customer_id: input.customerId,
        event_booking_id: input.eventBookingId ?? null,
        table_booking_id: input.tableBookingId ?? null,
        ...(input.privateBookingId ? { private_booking_id: input.privateBookingId } : {}),
      },
    })

    if (!result?.full_url) {
      return refuse(longUrl, 'short_link_returned_no_url', input)
    }

    return { url: result.full_url, shortened: true }
  } catch (error) {
    // Includes assertAllowedShortLinkDestination throwing on an off-allowlist
    // host, which is a deliberate refusal rather than an outage.
    return refuse(longUrl, 'short_link_creation_failed', input, error)
  }
}
