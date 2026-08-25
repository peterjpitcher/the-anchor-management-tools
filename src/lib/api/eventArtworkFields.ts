/**
 * The scoped artwork contract: GET /api/events/{id}/artwork.
 *
 * Deliberately separate from `eventImageFields.ts`. That module is the
 * website-facing shape, and the rule that it never carries story or print
 * poster URLs is load-bearing: the-anchor.pub reads `image[0]` ahead of every
 * named field and prefers `posterImageUrl` over the hero, so a story crop or an
 * A4 PDF appearing there would be published on live pages and downloaded by
 * social crawlers. Keeping the two builders apart means the guarantee is
 * structural, not a matter of remembering.
 *
 * This one exists for a single consumer holding `read:events:artwork`, and is
 * allowed to carry everything.
 */

export const EVENT_ARTWORK_VARIANTS = ['square', 'story', 'landscape'] as const

export type EventArtworkVariant = (typeof EVENT_ARTWORK_VARIANTS)[number]

export interface EventArtworkFile {
  url: string
  mimeType: string | null
  sizeBytes: number | null
  updatedAt: string | null
  /**
   * True when the URL came from the cache column on `events` with no matching
   * `event_images` row. New events inherit `event_categories.default_image_url`
   * verbatim, so a square can exist as a URL that this event does not own and
   * has no metadata for. The consumer needs to know, because an inherited
   * square is a category stock image rather than artwork designed for this
   * event.
   */
  inherited: boolean
}

export type EventArtworkVariants = Record<EventArtworkVariant, EventArtworkFile | null>

export interface EventArtworkPayload {
  eventId: string
  slug: string | null
  /** Newest `updatedAt` across the emitted variants, or null when none is owned. */
  kitUpdatedAt: string | null
  variants: EventArtworkVariants
}

export interface EventArtworkEventRow {
  id: string
  slug?: string | null
  hero_image_url?: string | null
  story_image_url?: string | null
  landscape_image_url?: string | null
}

/**
 * Cache column on `events` backing each artwork variant.
 *
 * Note that the square lives in `hero_image_url`: that column has always held
 * the square, and the 20260812 migration deliberately left it alone so the
 * website kept seeing exactly what it saw before.
 */
const CACHE_COLUMN: Record<EventArtworkVariant, keyof EventArtworkEventRow> = {
  square: 'hero_image_url',
  story: 'story_image_url',
  landscape: 'landscape_image_url',
}

export interface EventArtworkImageRow {
  image_type: string
  file_name?: string | null
  mime_type?: string | null
  file_size_bytes?: number | null
  updated_at?: string | null
  created_at?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function toIso(value: unknown): string | null {
  const raw = clean(value)
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Build the artwork block.
 *
 * The URL always comes from the cache column, never from `event_images`, so the
 * consumer receives exactly what the website would resolve. The metadata row
 * only supplies the descriptive fields, and its absence downgrades the variant
 * to `inherited` rather than dropping it.
 */
export function buildEventArtworkPayload(
  event: EventArtworkEventRow,
  imageRows: EventArtworkImageRow[]
): EventArtworkPayload {
  const rowByType = new Map<string, EventArtworkImageRow>()
  for (const row of imageRows) {
    if (row && typeof row.image_type === 'string') {
      rowByType.set(row.image_type, row)
    }
  }

  const variants = {} as EventArtworkVariants
  const timestamps: string[] = []

  for (const variant of EVENT_ARTWORK_VARIANTS) {
    const url = clean(event[CACHE_COLUMN[variant]])

    if (!url) {
      variants[variant] = null
      continue
    }

    const row = rowByType.get(variant)
    const updatedAt = row ? toIso(row.updated_at ?? row.created_at) : null

    variants[variant] = {
      url,
      mimeType: row ? clean(row.mime_type) : null,
      sizeBytes: row && typeof row.file_size_bytes === 'number' ? row.file_size_bytes : null,
      updatedAt,
      inherited: !row,
    }

    if (updatedAt) timestamps.push(updatedAt)
  }

  timestamps.sort()

  return {
    eventId: event.id,
    slug: clean(event.slug),
    kitUpdatedAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
    variants,
  }
}
