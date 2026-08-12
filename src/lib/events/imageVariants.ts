/**
 * The single definition of an event's artwork variants.
 *
 * Validation, the upload panel, the public API mapping and the tests all read
 * from here so the rules cannot drift apart. A contract test asserts these keys
 * match the database CHECK constraint on event_images.image_type.
 */

export const EVENT_IMAGE_BUCKET = 'event-images'

export type EventImageVariant =
  | 'square'
  | 'landscape'
  | 'social'
  | 'story'
  | 'print_poster'

/** Column on `events` that caches the public URL for a variant. */
type CacheColumn =
  | 'hero_image_url'
  | 'landscape_image_url'
  | 'social_image_url'
  | 'story_image_url'
  | 'print_poster_url'

export interface EventImageVariantConfig {
  key: EventImageVariant
  label: string
  /** Shown under the tile so staff know what to export from Canva. */
  helpText: string
  /** width / height. Used for the tolerance check and the preview box. */
  aspectRatio: number
  /** Human form of the ratio, for error messages. */
  aspectLabel: string
  targetWidth: number
  targetHeight: number
  acceptedMimeTypes: readonly string[]
  maxBytes: number
  /** False means the URL is never emitted by the public API. */
  webServed: boolean
  cacheColumn: CacheColumn
}

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
const TEN_MB = 10 * 1024 * 1024
const TWENTY_FIVE_MB = 25 * 1024 * 1024

export const EVENT_IMAGE_VARIANTS: Record<EventImageVariant, EventImageVariantConfig> = {
  square: {
    key: 'square',
    label: 'Square',
    helpText: '1:1, 1080x1080. Event cards, listings and feed posts.',
    aspectRatio: 1,
    aspectLabel: '1:1',
    targetWidth: 1080,
    targetHeight: 1080,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'hero_image_url',
  },
  landscape: {
    key: 'landscape',
    label: 'Landscape',
    helpText: '16:9, 1920x1080. The hero image on the event page.',
    aspectRatio: 16 / 9,
    aspectLabel: '16:9',
    targetWidth: 1920,
    targetHeight: 1080,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'landscape_image_url',
  },
  social: {
    key: 'social',
    label: 'Social / Facebook cover',
    helpText: '1.91:1, 1920x1005. Facebook event cover and link previews.',
    aspectRatio: 1.91,
    aspectLabel: '1.91:1',
    targetWidth: 1920,
    targetHeight: 1005,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'social_image_url',
  },
  story: {
    key: 'story',
    label: 'Story',
    helpText: '9:16, 1080x1920. Stories and reels. Not used on the website.',
    aspectRatio: 9 / 16,
    aspectLabel: '9:16',
    targetWidth: 1080,
    targetHeight: 1920,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: false,
    cacheColumn: 'story_image_url',
  },
  print_poster: {
    key: 'print_poster',
    label: 'A4 poster (print)',
    helpText: 'A4 at 300dpi, 2480x3508, or a PDF. For printing only.',
    aspectRatio: 2480 / 3508,
    aspectLabel: 'A4 portrait',
    targetWidth: 2480,
    targetHeight: 3508,
    acceptedMimeTypes: [...IMAGE_MIME_TYPES, 'application/pdf'],
    maxBytes: TWENTY_FIVE_MB,
    webServed: false,
    cacheColumn: 'print_poster_url',
  },
}

/** Display order in the panel, and the order variants are uploaded from a queue. */
export const EVENT_IMAGE_VARIANT_ORDER: readonly EventImageVariant[] = [
  'square',
  'landscape',
  'social',
  'story',
  'print_poster',
]

export function isEventImageVariant(value: unknown): value is EventImageVariant {
  return typeof value === 'string' && value in EVENT_IMAGE_VARIANTS
}

/**
 * How far a file's shape may differ from its variant's target before it is
 * refused. Generous enough for real exports (a 1080x1350 "square" is refused,
 * a 1920x1004 social card is not), tight enough to catch a file dropped into
 * the wrong tile.
 */
export const ASPECT_RATIO_TOLERANCE = 0.05

export function aspectRatioMatches(
  variant: EventImageVariant,
  width: number,
  height: number
): boolean {
  if (!width || !height) return true // unknown dimensions are not a rejection reason
  const expected = EVENT_IMAGE_VARIANTS[variant].aspectRatio
  return Math.abs(width / height - expected) / expected <= ASPECT_RATIO_TOLERANCE
}

/** Plain-language ratio for an error message, e.g. "1:1" or "3:2". */
export function describeAspectRatio(width: number, height: number): string {
  if (!width || !height) return 'an unknown shape'
  const divisor = greatestCommonDivisor(width, height)
  const w = Math.round(width / divisor)
  const h = Math.round(height / divisor)
  // Reducing 1920x1005 gives 128:67, which tells nobody anything.
  if (w > 20 || h > 20) return `${(width / height).toFixed(2)}:1`
  return `${w}:${h}`
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * An entity owns a storage object only when it sits in that entity's own folder.
 * New events inherit event_categories.default_image_url verbatim, so an event's
 * image frequently belongs to its category and is shared with every other event
 * in it. Deleting by URL alone would take the file from all of them.
 */
export function isOwnedByEvent(storagePath: string | null, eventId: string): boolean {
  return Boolean(storagePath && storagePath.startsWith(`events/${eventId}/`))
}

const PUBLIC_URL_MARKER = `/storage/v1/object/public/${EVENT_IMAGE_BUCKET}/`

/** Recover the bucket-relative storage path from a public URL, or null if not ours. */
export function storagePathFromPublicUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  const markerAt = imageUrl.indexOf(PUBLIC_URL_MARKER)
  if (markerAt === -1) return null
  const rawPath = imageUrl.slice(markerAt + PUBLIC_URL_MARKER.length).split('?')[0]
  if (!rawPath) return null
  try {
    return decodeURIComponent(rawPath)
  } catch {
    return rawPath
  }
}

/** Strip anything that would make a storage key awkward, keeping it recognisable. */
export function sanitiseFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
  return cleaned || 'unnamed'
}

export function buildEventImageStoragePath(
  eventId: string,
  variant: EventImageVariant,
  fileName: string,
  now: number
): string {
  return `events/${eventId}/${variant}/${now}_${sanitiseFileName(fileName)}`
}
