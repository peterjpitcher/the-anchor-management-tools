import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import { logger } from '@/lib/logger'
import { buildPrivateBookingPortalUrl } from './booking-token'

/**
 * The guest's private hire booking page, as a short l.the-anchor.pub link (BK-172).
 *
 * Every deposit email printed the full 140-character /booking-portal/<token> address, which looks
 * like phishing and wraps badly on a phone; table and event emails already used short links. When
 * the short link cannot be made, the full one is used and the fallback is logged at warn with
 * `link: 'full_url'`, which production keeps, so it can be counted.
 *
 * The link stops working 30 days after the event (BK-204). Null when the app URL is not an http or
 * https address, as buildPrivateBookingPortalUrl.
 */
export async function privateBookingPortalLink(booking: {
  id: string
  customer_id?: string | null
  event_date?: string | null
  date_tbd?: boolean | null
}): Promise<string | null> {
  const longUrl = buildPrivateBookingPortalUrl(booking.id, { eventDate: booking.event_date, dateTbd: booking.date_tbd })
  if (!longUrl) return null
  const result = await buildGuestShortLink({
    longUrl,
    linkKind: 'private_booking_portal',
    customerId: booking.customer_id ?? null,
    privateBookingId: booking.id,
  })
  if (!result.shortened) {
    logger.warn('Private booking page link sent in full', {
      metadata: { privateBookingId: booking.id, link: 'full_url' },
    })
  }
  return result.url
}
