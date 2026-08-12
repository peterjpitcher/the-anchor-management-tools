/**
 * The image half of the public event contract, shared by the list and detail
 * routes so the two cannot drift.
 *
 * Two rules matter here:
 *
 * 1. `image[0]` must stay the square. the-anchor.pub takes the first entry of
 *    `image` ahead of every named field (lib/event-image.ts), and drops it into
 *    aspect-square card slots with object-cover (RelatedEvents.tsx). Putting the
 *    landscape first would crop the sides off designed artwork on live pages
 *    before any website deploy.
 * 2. Story and print poster URLs are never emitted. They are AMS-only.
 */

interface EventImageSource {
  hero_image_url?: string | null
  thumbnail_image_url?: string | null
  poster_image_url?: string | null
  landscape_image_url?: string | null
  social_image_url?: string | null
  gallery_image_urls?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Distinct image URLs for schema.org, square first.
 *
 * Previously this pushed hero, thumbnail and poster, which hold the same square
 * on every event in production, so the same URL was published three times.
 */
export function buildEventImageList(event: EventImageSource): string[] {
  const gallery = Array.isArray(event.gallery_image_urls) ? event.gallery_image_urls : []

  const candidates = [
    clean(event.hero_image_url),
    clean(event.landscape_image_url),
    clean(event.social_image_url),
    ...gallery.map(clean),
  ]

  return Array.from(new Set(candidates.filter((url): url is string => url !== null)))
}

export interface EventImageFields {
  heroImageUrl: string | null
  thumbnailImageUrl: string | null
  posterImageUrl: string | null
  squareImageUrl: string | null
  landscapeImageUrl: string | null
  socialImageUrl: string | null
}

/**
 * The legacy three keep their current values exactly, so an event that has only
 * a square returns what it returns today. `squareImageUrl` is the same value
 * under an honest name: hero_image_url has always held the square.
 */
export function buildEventImageFields(event: EventImageSource): EventImageFields {
  const hero = clean(event.hero_image_url)

  return {
    heroImageUrl: hero,
    thumbnailImageUrl: clean(event.thumbnail_image_url) ?? hero,
    posterImageUrl: clean(event.poster_image_url) ?? hero,
    squareImageUrl: hero,
    landscapeImageUrl: clean(event.landscape_image_url),
    socialImageUrl: clean(event.social_image_url),
  }
}
