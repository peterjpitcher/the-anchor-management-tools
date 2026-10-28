/** The website's events section: every event has a page at `${PUBLIC_EVENT_BASE}/<slug>`. */
export const PUBLIC_EVENT_BASE = 'https://www.the-anchor.pub/events'

/**
 * Where a guest can book an event again (BK-173): the event's own booking link when staff set
 * one, otherwise its page on the website. Null only when the event has neither, so a message
 * then gives the pub's number instead of a dead link.
 *
 * Texts carrying it are shortened at send time (shortenUrlsInSmsBody), like every link in a text.
 */
export function resolvePublicEventLink(event: {
  booking_url?: string | null
  slug?: string | null
} | null | undefined): string | null {
  const bookingUrl = typeof event?.booking_url === 'string' ? event.booking_url.trim() : ''
  if (bookingUrl) return bookingUrl
  const slug = typeof event?.slug === 'string' ? event.slug.trim() : ''
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null
  return `${PUBLIC_EVENT_BASE}/${slug}`
}
