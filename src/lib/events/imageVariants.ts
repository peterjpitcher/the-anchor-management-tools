/**
 * The single definition of an event's artwork variants.
 *
 * Validation, the upload panel, the public API mapping and the tests all read
 * from here so the rules cannot drift apart. A contract test asserts these keys
 * match the database CHECK constraint on event_images.image_type.
 */

import { TABLE_TALKER_PANEL_WIDTH_MM } from './artwork/print-sheet'

export const EVENT_IMAGE_BUCKET = 'event-images'

export type EventImageVariant =
  | 'square'
  | 'landscape'
  | 'social'
  | 'story'
  | 'print_poster'
  | 'table_talker'

/** Column on `events` that caches the public URL for a variant. */
export type EventImageCacheColumn =
  | 'hero_image_url'
  | 'landscape_image_url'
  | 'social_image_url'
  | 'story_image_url'
  | 'print_poster_url'
  | 'table_talker_url'

/**
 * How a print variant reaches paper. Null on every screen variant.
 *
 * A QR code's printable minimum is a PHYSICAL size, but the placement geometry
 * works in fractions of the image width. The two only line up once the width
 * the artwork is actually printed at is known, and that differs per surface:
 * the poster prints the full A4 width, a table talker far narrower. Keeping the
 * pair here, beside the variant, is what stops a new print surface quietly
 * inheriting the poster's fraction and printing a code a third of the size.
 */
/**
 * The marketing channels a printed QR code may carry, one per print surface.
 * Closed on purpose: a code minted on the wrong channel reports its scans
 * against another surface.
 */
export type PrintQrChannel = 'poster' | 'table_talker'

export interface EventImagePrintSpec {
  /** The width the artwork is printed at, in millimetres. */
  printedWidthMm: number
  /** The smallest printed QR code a phone reliably scans on this surface. */
  qrMinMm: number
  /**
   * `qrMinMm` as a fraction of the image width, rounded UP at the fourth
   * decimal place so a code at the floor can never print under the minimum.
   *
   * A literal rather than a division, because the poster's value is pinned to
   * the `event_images_qr_width_frac_check` floor and must not drift with
   * floating point. A test holds every literal to its millimetres, and holds
   * every one inside the database floor and ceiling.
   */
  qrMinWidthFrac: number
  /**
   * The marketing channel whose short link the QR carries. Each printed
   * surface has its own, so its scans are reported on their own.
   */
  qrChannel: PrintQrChannel
  /** What staff call the printed thing, e.g. "Put a QR code on the poster". */
  surfaceName: string
  /** Where the printed size is quoted, e.g. "21 mm on the A4 poster". */
  printedSizeLabel: string
}

export interface EventImageVariantConfig {
  key: EventImageVariant
  label: string
  /**
   * How the variant is named in the copyable prompt. Spelled out more than the
   * tile label, because an image tool reading "Story" has no idea what shape
   * that is, whereas "Instagram story" is unambiguous.
   */
  promptLabel: string
  /**
   * Said after the size in the copyable prompt, for a shape an image tool is
   * likely to get wrong without being told.
   */
  promptNote?: string
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
  cacheColumn: EventImageCacheColumn
  /** Null for screen variants. Present means this variant is printed and may carry a QR code. */
  print: EventImagePrintSpec | null
}

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const
const TEN_MB = 10 * 1024 * 1024
const TWENTY_FIVE_MB = 25 * 1024 * 1024

export const EVENT_IMAGE_VARIANTS: Record<EventImageVariant, EventImageVariantConfig> = {
  square: {
    key: 'square',
    label: 'Square',
    promptLabel: 'Square (source image)',
    helpText: '1:1, 1080x1080. Event cards, listings and feed posts.',
    aspectRatio: 1,
    aspectLabel: '1:1',
    targetWidth: 1080,
    targetHeight: 1080,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'hero_image_url',
    print: null,
  },
  landscape: {
    key: 'landscape',
    label: 'Landscape',
    promptLabel: 'Landscape',
    helpText: '16:9, 1920x1080. The hero image on the event page.',
    aspectRatio: 16 / 9,
    aspectLabel: '16:9',
    targetWidth: 1920,
    targetHeight: 1080,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'landscape_image_url',
    print: null,
  },
  social: {
    key: 'social',
    label: 'Social / Facebook cover',
    promptLabel: 'Facebook event cover / link preview',
    helpText: '1.91:1, 1920x1005. Facebook event cover and link previews.',
    aspectRatio: 1.91,
    aspectLabel: '1.91:1',
    targetWidth: 1920,
    targetHeight: 1005,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: true,
    cacheColumn: 'social_image_url',
    print: null,
  },
  story: {
    key: 'story',
    label: 'Story',
    promptLabel: 'Instagram story',
    promptNote: 'Leave a little clear, uncluttered space at the top for the venue logo to be added later. Keep text and important artwork out of that space; do not draw a logo or placeholder.',
    helpText: '9:16, 1080x1920. Stories and reels. Not used on the website.',
    aspectRatio: 9 / 16,
    aspectLabel: '9:16',
    targetWidth: 1080,
    targetHeight: 1920,
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: false,
    cacheColumn: 'story_image_url',
    print: null,
  },
  print_poster: {
    key: 'print_poster',
    label: 'A4 poster (print)',
    promptLabel: 'A4 poster for print',
    promptNote: 'Leave a little clear, uncluttered space at the top for the venue logo and a clear area near the bottom for a booking QR code and its label to be added later. Keep text and important artwork out of those areas; do not draw a logo, QR code or placeholder.',
    helpText: 'A4 at 300dpi, 2480x3508, or a PDF. For printing only.',
    aspectRatio: 2480 / 3508,
    aspectLabel: 'A4 portrait',
    targetWidth: 2480,
    targetHeight: 3508,
    acceptedMimeTypes: [...IMAGE_MIME_TYPES, 'application/pdf'],
    maxBytes: TWENTY_FIVE_MB,
    webServed: false,
    cacheColumn: 'print_poster_url',
    // 10% of the full A4 width, which is the database floor as well.
    print: {
      printedWidthMm: 210,
      qrMinMm: 21,
      qrMinWidthFrac: 0.1,
      qrChannel: 'poster',
      surfaceName: 'poster',
      printedSizeLabel: 'the A4 poster',
    },
  },
  table_talker: {
    key: 'table_talker',
    label: 'Table talker (print)',
    promptLabel: 'Slim table talker for print',
    promptNote:
      'Tall and slim: stack the elements vertically rather than shrinking the square layout to fit the width. Leave a little clear, uncluttered space at the top for the venue logo and a clear area near the bottom for a booking QR code and its label to be added later. Keep text and important artwork out of those areas; do not draw a logo, QR code or placeholder.',
    helpText: 'DL at 300dpi, 1169x2480. Printed three to an A4 sheet.',
    aspectRatio: 99 / 210,
    aspectLabel: 'DL portrait (99 x 210 mm)',
    targetWidth: 1169,
    targetHeight: 2480,
    // No PDF: a PDF cannot be branded, and this panel is only printed after it
    // has been.
    acceptedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: TEN_MB,
    webServed: false,
    cacheColumn: 'table_talker_url',
    // Printed at its panel width on the A4 sheet, not the DL design width.
    // 15mm is 0.16245 of 92.33mm, rounded up.
    print: {
      printedWidthMm: TABLE_TALKER_PANEL_WIDTH_MM,
      qrMinMm: 15,
      qrMinWidthFrac: 0.1625,
      qrChannel: 'table_talker',
      surfaceName: 'table talker',
      printedSizeLabel: 'each printed table talker',
    },
  },
}

/** Display order in the panel, and the order variants are uploaded from a queue. */
export const EVENT_IMAGE_VARIANT_ORDER: readonly EventImageVariant[] = [
  'square',
  'landscape',
  'social',
  'story',
  'print_poster',
  'table_talker',
]

export function isEventImageVariant(value: unknown): value is EventImageVariant {
  return typeof value === 'string' && value in EVENT_IMAGE_VARIANTS
}

/**
 * A print variant's QR minimum, in the shape the placement geometry takes
 * (`QrPrintMinimum` in `src/lib/events/artwork/geometry.ts`). Null for a screen
 * variant, which never carries a QR code.
 *
 * The one bridge between the two modules, so the editor and the compositor
 * cannot each assemble the minimum their own way.
 */
export function qrMinimumFor(
  variant: EventImageVariant
): { widthFrac: number; mm: number; surfaceName: string } | null {
  const print = EVENT_IMAGE_VARIANTS[variant].print
  if (!print) return null
  return { widthFrac: print.qrMinWidthFrac, mm: print.qrMinMm, surfaceName: print.surfaceName }
}

/**
 * The prompt staff copy into an image tool once the square artwork exists, to
 * get the other variants back at the sizes the tiles actually accept.
 *
 * Generated from the config rather than written out, so the numbers here can
 * never drift from the ones the upload validates against. The square is left
 * out because it is the image being handed over.
 */
export function buildVariantPrompt(): string {
  const sizes = EVENT_IMAGE_VARIANT_ORDER.filter((key) => key !== 'square').map((key) => {
    const variant = EVENT_IMAGE_VARIANTS[key]
    const dpi = variant.print ? ' at 300 dpi' : ''
    const note = variant.promptNote ? `. ${variant.promptNote}` : ''
    return `- ${variant.promptLabel}: ${variant.aspectLabel}, ${variant.targetWidth} x ${variant.targetHeight} px${dpi}${note}`
  })

  return [
    'Please recreate the attached image at each of the sizes below, keeping the same artwork, colours, typography and mood so they read as one set.',
    '',
    'Re-compose each one for its shape rather than stretching or cropping the original. Keep the subject and every piece of text comfortably inside the frame, and give portrait and landscape versions room to breathe instead of squashing the square layout into them.',
    '',
    ...sizes,
    '',
    'Return each one as a separate JPG or PNG at exactly the pixel dimensions listed.',
  ].join('\n')
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

/**
 * The folder every branded composite is written to, under its variant, and
 * nothing else ever is: staff uploads sit directly in the variant folder and
 * their sanitised names cannot contain a slash. So the path alone says whether
 * a file carries branding, without trusting a database column a failed write
 * may have left behind. The storage layout is set out in
 * `src/lib/events/artwork/branding-service.ts`.
 */
export const BRANDED_COMPOSITE_FOLDER = 'branded'

/** True when a storage object is a branded composite rather than an upload. */
export function isBrandedCompositePath(storagePath: string | null | undefined): boolean {
  return Boolean(storagePath && storagePath.includes(`/${BRANDED_COMPOSITE_FOLDER}/`))
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

/** Return the file extension from an image URL, without its leading dot. */
export function eventImageFileExtension(imageUrl: string): string | null {
  try {
    const fileName = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '')
    const match = fileName.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Supabase public files need its `download` query parameter to send an
 * attachment response. The HTML download attribute alone is ignored for the
 * cross-origin storage URL, so Chrome otherwise opens the image in a new tab.
 */
export function buildEventImageDownloadUrl(imageUrl: string, fileName?: string | null): string {
  try {
    const url = new URL(imageUrl)
    const pathFileName = decodeURIComponent(url.pathname.split('/').pop() ?? '')
    url.searchParams.set('download', fileName?.trim() || pathFileName || 'event-artwork')
    return url.toString()
  } catch {
    return imageUrl
  }
}

/** A file-name-safe slug of an event name, or `event` when nothing usable is left. */
function eventFileNameSlug(eventName: string): string {
  return (
    eventName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  )
}

/** Give Marketing-tab downloads short, useful names instead of storage keys. */
export function buildEventImageDownloadFileName(
  eventName: string,
  variant: EventImageVariant,
  imageUrl: string
): string {
  const eventPart = eventFileNameSlug(eventName)
  const variantPart = variant.replace(/_/g, '-')
  const extension = eventImageFileExtension(imageUrl)
  return `${eventPart}-${variantPart}${extension ? `.${extension}` : ''}`
}

/**
 * The name the A4 table talker sheet downloads under. Plain ASCII by
 * construction, so it is safe in a Content-Disposition header as it stands.
 */
export function buildTableTalkerSheetFileName(eventName: string): string {
  return `${eventFileNameSlug(eventName)}-table-talkers-a4.pdf`
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
