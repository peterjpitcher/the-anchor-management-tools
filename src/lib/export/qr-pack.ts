// src/lib/export/qr-pack.ts
// Building blocks for the designer QR pack: the QR options, the per-event brief,
// and the manifest. Kept out of the route so they can be unit tested.

import QRCode from 'qrcode'
import type { EventMarketingLink } from '@/services/event-marketing'
import type { EventMarketingChannelConfig } from '@/lib/event-marketing-links'
import { formatDateInLondon } from '@/lib/dateUtils'

/**
 * One options object for both formats.
 *
 * They have to match. A PNG and an SVG of the same link that encode different
 * error correction, or a different quiet zone, are not the same asset, and a
 * designer will reasonably assume they are interchangeable.
 *
 * Margin 4 is the specified quiet zone. Anything less is below spec for print and
 * is the usual cause of a code that scans on screen and fails off paper.
 */
export const QR_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 4,
  color: { dark: '#000000', light: '#FFFFFF' },
} as const

/**
 * 1200px is a measured choice, not a round number. At 300dpi it prints crisp to
 * about 100mm, comfortably past the largest poster code anyone here uses, and it
 * renders in 42ms against 125ms at 2048px. Over a 40-event pack that is the
 * difference between 48 and 140 seconds of pure rendering. The SVG is the
 * answer for anything larger, being resolution-independent and 2KB.
 */
export const QR_PNG_WIDTH = 1200

/** The designer pack is for artwork that will be physically printed. */
export function isPrintedMediaQrChannel(
  channel: Pick<EventMarketingChannelConfig, 'type'>,
): boolean {
  return channel.type === 'print'
}

export async function renderQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: QR_PNG_WIDTH })
}

export async function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
}

export interface BriefEvent {
  id: string
  name: string
  date: string
  time: string | null
  end_time: string | null
  doors_time: string | null
  last_entry_time: string | null
  capacity: number | null
  price: number | null
  is_free: boolean | null
  short_description: string | null
  brief: string | null
  image_alt_text: string | null
  accessibility_notes: string | null
  slug: string | null
  performer_name: string | null
  performer_type: string | null
  category?: { name: string } | { name: string }[] | null
}

function categoryName(event: BriefEvent): string {
  const c = event.category
  if (!c) return ''
  return Array.isArray(c) ? (c[0]?.name ?? '') : c.name
}

function clock(value: string | null): string {
  if (!value) return ''
  const [h, m] = value.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return value
  const suffix = hour >= 12 ? 'pm' : 'am'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return m && m !== '00' ? `${display}:${m}${suffix}` : `${display}${suffix}`
}

function price(event: BriefEvent): string {
  if (event.is_free) return 'Free'
  if (event.price == null) return ''
  return `£${Number(event.price).toFixed(2).replace(/\.00$/, '')}`
}

/** Rows that have a value, so the table never shows empty cells. */
function detailRows(event: BriefEvent): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Date', formatDateInLondon(event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    ['Doors', clock(event.doors_time)],
    ['Starts', clock(event.time)],
    ['Ends', clock(event.end_time)],
    ['Last entry', clock(event.last_entry_time)],
    ['Category', categoryName(event)],
    ['Host', event.performer_name ?? ''],
    ['Price', price(event)],
    ['Capacity', event.capacity != null ? String(event.capacity) : ''],
  ]
  return rows.filter(([, value]) => value !== '')
}

const PUBLIC_EVENT_BASE = 'https://www.the-anchor.pub/events'

/**
 * The designer's brief for one event.
 *
 * `brief` arrives with CRLF line endings from the database. Left alone, a
 * markdown table written above it renders correctly and the body below does not,
 * which looks like a broken export rather than a data quirk.
 */
export function buildBriefMarkdown(event: BriefEvent, links: EventMarketingLink[]): string {
  const lines: string[] = []

  lines.push(`# ${event.name}`, '')
  lines.push('| | |', '|---|---|')
  for (const [label, value] of detailRows(event)) lines.push(`| ${label} | ${value} |`)
  lines.push('')

  if (event.short_description) {
    lines.push(`**In one line:** ${event.short_description}`, '')
  }

  if (links.length > 0) {
    lines.push('## QR codes in this folder', '')
    lines.push('| File | Placement | Scans to | Short link |', '|---|---|---|---|')
    for (const link of links) {
      lines.push(
        `| ${qrFileStem(link)} | ${link.label} | the event page | ${link.shortUrl} |`,
      )
    }
    lines.push('')
    lines.push(
      'Every code is tracked, so each placement reports its own scans. Please use the file',
      'named for the placement it is going on, and do not swap one for another or reuse a',
      'code from a previous event.',
      '',
    )
  }

  if (event.slug) {
    lines.push(`**Event page:** ${PUBLIC_EVENT_BASE}/${event.slug}`, '')
  }

  if (event.image_alt_text) {
    lines.push('## Image alt text', '', event.image_alt_text, '')
  }

  if (event.accessibility_notes) {
    lines.push('## Accessibility', '', event.accessibility_notes, '')
  }

  if (event.brief) {
    lines.push('## Full brief', '', event.brief.replaceAll('\r\n', '\n').trim(), '')
  }

  return lines.join('\n')
}

/** Numbered so the files sort in catalogue order rather than alphabetically. */
export function qrFileStem(link: EventMarketingLink, index?: number): string {
  const prefix = index != null ? `${String(index + 1).padStart(2, '0')}-` : ''
  return `${prefix}${link.channel}`
}

export interface ManifestEntry {
  eventId: string
  eventName: string
  eventDate: string
  folder: string
  links: Array<{
    channel: string
    label: string
    type: string
    shortCode: string
    shortUrl: string
    destinationUrl: string
    files: string[]
  }>
}

export function buildReadme(
  startDate: string,
  endDate: string,
  entries: ManifestEntry[],
): string {
  const lines: string[] = []
  lines.push('# QR pack', '')
  lines.push(
    `Events from ${formatDateInLondon(startDate, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    `to ${formatDateInLondon(endDate, { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    '',
  )
  lines.push(`${entries.length} event${entries.length === 1 ? '' : 's'}, one folder each.`, '')

  lines.push('## Using these codes', '')
  lines.push(
    '- Every code is unique to one event and one placement, and reports its own scans.',
    '  Please do not reuse a code across placements or events.',
    '- Both formats hold the same code. Use the SVG wherever you can: it is vector, so it',
    '  stays sharp at any size. The PNG is 1200px, which prints cleanly up to about 100mm.',
    '- Keep the white border. It is part of the code, and cropping it is the most common',
    '  reason a code scans on screen and then fails on paper.',
    '- Do not stretch, rotate or recolour to low contrast. Dark on light, roughly square.',
    '- Minimum printed size: about 25mm for a table talker, 40mm for a poster.',
    '- Please scan a printed proof before the full run.',
    '',
  )

  lines.push('## Events', '')
  lines.push('| Date | Event | Folder | Codes |', '|---|---|---|---|')
  for (const entry of entries) {
    lines.push(`| ${entry.eventDate} | ${entry.eventName} | ${entry.folder} | ${entry.links.length} |`)
  }
  lines.push('')
  lines.push('`manifest.json` holds the same information in machine-readable form.', '')

  return lines.join('\n')
}
