/**
 * Builds the image-edit prompt for one generated event artwork variant, and the
 * event-copy snapshot that sits alongside it.
 *
 * Why this exists: the manual fallback prompt (`buildVariantPrompt()` in
 * `imageVariants.ts`) asks a model to keep "every piece of text comfortably
 * inside the frame" without ever telling it what that text says. The model then
 * re-draws whatever it thinks it can read off the source image, which is how
 * dates and prices come back mangled. Everything here exists to carry the
 * literal copy into the prompt, in quotes, as the authority.
 *
 * The snapshot is stored on the run so a later change to the event's name, date,
 * times or price can invalidate an approval that was given against the old copy.
 * Times are normalised to HH:MM on the way in, so a harmless '19:00' against
 * '19:00:00' does not read as a change.
 *
 * Pure module: no network, filesystem or database access.
 */

import { formatDateInLondon, formatTime12Hour, isValidIsoDate } from '@/lib/dateUtils'
import type { EventImageVariant } from '@/lib/events/imageVariants'

/**
 * Bump this whenever the wording below changes. It is stored on the run, so an
 * approval given against older wording can be told apart from a fresh one.
 */
export const PROMPT_VERSION = '2026-09-06.1'

/** The provider's cap on prompt length. Ours sits far below it. */
export const MAX_PROMPT_CHARACTERS = 32_000

/** Longest event name that survives a generated layout without being mangled. */
export const MAX_EVENT_NAME_LENGTH = 60

/** Matches `Venue: The Anchor` in `src/app/actions/event-content.ts`. */
export const DEFAULT_EVENT_VENUE = 'The Anchor'

export interface EventCopy {
  name: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  startTime: string | null
  doorsTime: string | null
  endTime: string | null
  lastEntryTime: string | null
  isFree: boolean | null
  price: number | null
  venue: string
}

/** The shape of an `events` row, as far as the copy is concerned. */
export interface EventCopySource {
  name?: string | null
  date?: string | null
  time?: string | null
  doors_time?: string | null
  end_time?: string | null
  last_entry_time?: string | null
  is_free?: boolean | null
  price?: number | null
  venue?: string | null
}

/** A rectangle on the target canvas, in pixels, that must be left clear. */
export interface ReservedArea {
  x: number
  y: number
  width: number
  height: number
}

export interface AdaptationPromptArgs {
  copy: EventCopy
  variant: EventImageVariant
  targetWidth: number
  targetHeight: number
  reservedLogoRect: ReservedArea | null
  reservedQrBand: ReservedArea | null
}

export type EventCopyValidation = { ok: true } | { ok: false; problems: string[] }

/**
 * How each target shape is described to the model. A model reasons far better
 * about "a tall 9:16 portrait for an Instagram story" than about "1080x1920",
 * so it gets both.
 */
const VARIANT_SHAPE_DESCRIPTIONS: Record<EventImageVariant, string> = {
  square: 'a square 1:1 image for event cards and feed posts',
  landscape: 'a wide 16:9 landscape image for the top of the event page',
  social: 'a wide 1.91:1 banner for a Facebook event cover and link previews',
  story: 'a tall 9:16 portrait for an Instagram story',
  print_poster: 'a tall A4 portrait poster for print',
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Normalise a stored time to HH:MM, or null when there isn't one.
 *
 * Postgres hands back '19:00:00' where a form hands back '19:00'. Storing the
 * two forms interchangeably in the snapshot would make an approval look stale
 * after a save that changed nothing.
 */
function normaliseTime(value: string | null | undefined): string | null {
  const raw = trimmed(value)
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 2) return null
  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Take the copy an event actually holds, ready to be stored on the run. */
export function buildEventCopySnapshot(event: EventCopySource): EventCopy {
  const price =
    typeof event.price === 'number' && Number.isFinite(event.price) ? event.price : null

  return {
    name: trimmed(event.name),
    date: trimmed(event.date),
    startTime: normaliseTime(event.time),
    doorsTime: normaliseTime(event.doors_time),
    endTime: normaliseTime(event.end_time),
    lastEntryTime: normaliseTime(event.last_entry_time),
    isFree: typeof event.is_free === 'boolean' ? event.is_free : null,
    price,
    venue: trimmed(event.venue) || DEFAULT_EVENT_VENUE,
  }
}

/**
 * The price as it should appear on the artwork, or null when it must not appear
 * at all.
 *
 * Three branches, and the third is the one that matters: an event flagged as not
 * free but carrying no price has an unknown price. Printing "Free" or "£0" there
 * would put a promise on a poster that the till will not honour, so nothing is
 * printed and the price simply does not appear. A zero price without the free
 * flag is the same contradiction and is treated the same way.
 */
function formatPriceLabel(copy: EventCopy): string | null {
  if (copy.isFree === true) return 'Free'
  if (typeof copy.price !== 'number' || !Number.isFinite(copy.price) || copy.price <= 0) {
    return null
  }
  const rounded = Math.round(copy.price * 100) / 100
  return Number.isInteger(rounded) ? `£${rounded}` : `£${rounded.toFixed(2)}`
}

/** The date as it should read on the artwork, or null when there isn't a usable one. */
function formatDateLabel(isoDate: string): string | null {
  if (!isoDate || !isValidIsoDate(isoDate)) return null
  return formatDateInLondon(isoDate, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The authoritative copy block.
 *
 * Shared by the prompt and the editor's "authoritative copy" panel, so what the
 * owner approves on screen is character for character what the model is told.
 */
export function formatEventCopyLines(copy: EventCopy): string[] {
  const lines: string[] = []

  if (copy.name) lines.push(`Event name: "${copy.name}"`)

  const dateLabel = formatDateLabel(copy.date)
  if (dateLabel) lines.push(`Date: ${dateLabel}`)

  if (copy.doorsTime) lines.push(`Doors: ${formatTime12Hour(copy.doorsTime)}`)
  if (copy.startTime) lines.push(`Start time: ${formatTime12Hour(copy.startTime)}`)
  if (copy.lastEntryTime) lines.push(`Last entry: ${formatTime12Hour(copy.lastEntryTime)}`)
  if (copy.endTime) lines.push(`Ends: ${formatTime12Hour(copy.endTime)}`)

  const priceLabel = formatPriceLabel(copy)
  if (priceLabel) lines.push(`Price: ${priceLabel}`)

  if (copy.venue) lines.push(`Venue: ${copy.venue}`)

  return lines
}

/** Where on the canvas a reserved rectangle sits, in words. */
function describeRegion(area: ReservedArea, targetWidth: number, targetHeight: number): string {
  const centreX = area.x + area.width / 2
  const centreY = area.y + area.height / 2

  const fullWidth = targetWidth > 0 && area.width / targetWidth >= 0.9
  const horizontal = fullWidth
    ? ''
    : centreX < targetWidth / 3
      ? 'left '
      : centreX > (targetWidth * 2) / 3
        ? 'right '
        : ''

  const vertical =
    centreY < targetHeight / 3 ? 'top' : centreY > (targetHeight * 2) / 3 ? 'bottom' : 'middle'

  if (fullWidth) return `${vertical} band`
  if (!horizontal) return `${vertical} centre`
  return `${vertical} ${horizontal}`.trim()
}

/**
 * A reserved rectangle in plain terms.
 *
 * Percentages rather than pixel coordinates, because the model handles
 * proportions of a frame reliably and pixel offsets not at all.
 */
function describeReservedArea(
  area: ReservedArea,
  targetWidth: number,
  targetHeight: number,
  purpose: string
): string | null {
  if (targetWidth <= 0 || targetHeight <= 0) return null
  if (area.width <= 0 || area.height <= 0) return null

  const widthPercent = Math.round((area.width / targetWidth) * 100)
  const heightPercent = Math.round((area.height / targetHeight) * 100)
  const region = describeRegion(area, targetWidth, targetHeight)
  const widthWords =
    widthPercent >= 90 ? 'the full width' : `about ${widthPercent}% of the width`

  return `Leave the ${region} of the image clear, ${widthWords} and about ${heightPercent}% of the height, for ${purpose} to be added afterwards. Keep artwork and text out of it.`
}

/**
 * The prompt for one variant, carrying the literal event copy.
 *
 * The copy block is the whole point: the model is told what the words are
 * instead of being asked to read them back off the source image.
 */
export function buildAdaptationPrompt(args: AdaptationPromptArgs): string {
  const { copy, variant, targetWidth, targetHeight, reservedLogoRect, reservedQrBand } = args

  const shape = VARIANT_SHAPE_DESCRIPTIONS[variant]
  const size = `${targetWidth} by ${targetHeight} pixels`

  const reservedLines = [
    reservedLogoRect
      ? describeReservedArea(reservedLogoRect, targetWidth, targetHeight, 'the venue logo')
      : null,
    reservedQrBand
      ? describeReservedArea(
          reservedQrBand,
          targetWidth,
          targetHeight,
          'a QR code and booking details'
        )
      : null,
  ].filter((line): line is string => Boolean(line))

  const sections: string[] = [
    `Adapt the attached event artwork into ${shape}, ${size}.`,
    '',
    'Re-compose the design for the new shape. Do not crop the original, do not stretch it and do not pad it with bars or borders. Keep the same artwork, palette, typography and mood so the whole set reads as one family, and give the new shape room to breathe rather than squashing the original layout into it.',
    '',
    'Use exactly the copy below, spelled, capitalised and punctuated as written. It is the authority, not the text in the attached image. Do not invent, translate, abbreviate, correct or add any other words, dates, times, prices or logos, and do not carry over any text from the original that is not listed here.',
    '',
    ...formatEventCopyLines(copy),
    '',
    'Set the event name as the largest text. Keep every piece of text fully inside the frame, upright, level, high in contrast against what sits behind it, and clear of the edges by at least 5% of the shortest side. Do not repeat a line, and do not add a caption, watermark, website address, phone number or social handle.',
  ]

  if (reservedLines.length > 0) {
    sections.push('', ...reservedLines)
  }

  sections.push('', `Return one image at ${size}.`)

  return sections.join('\n')
}

/**
 * Check the copy before any money is spent generating from it.
 *
 * Returns every problem rather than the first, because the editor shows this
 * list to the owner in one go and a one-at-a-time list turns a single fix into
 * several rounds.
 */
export function validateEventCopy(copy: EventCopy): EventCopyValidation {
  const problems: string[] = []

  const name = trimmed(copy.name)
  if (!name) {
    problems.push('The event needs a name before artwork can be generated.')
  } else if (name.length > MAX_EVENT_NAME_LENGTH) {
    problems.push(
      `The event name is ${name.length} characters. Keep it to ${MAX_EVENT_NAME_LENGTH} or fewer, because longer titles get mangled in generated layouts.`
    )
  }

  const date = trimmed(copy.date)
  if (!date) {
    problems.push('The event needs a date before artwork can be generated.')
  } else if (!isValidIsoDate(date)) {
    problems.push(`The event date "${date}" is not a valid date.`)
  }

  if (!trimmed(copy.startTime)) {
    problems.push('The event needs a start time before artwork can be generated.')
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}
