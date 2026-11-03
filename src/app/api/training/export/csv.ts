import { formatDateInLondon, formatTimeInLondon, toLocalIsoDate } from '@/lib/dateUtils'
import { buildCsvBuffer, escapeCsvCell } from '@/lib/receipts/export/csv-helpers'
import { TRAINING_EVENT_BADGE } from '@/lib/training/labels'
import type { ActivityItem } from '@/lib/training/types'

/**
 * The training log as a CSV (build contract 5.5; spec 9.4), for a duty manager to print for an
 * environmental health or licensing officer. It opens with an "As at" line, so a printed copy
 * says when it was true. Free text goes through the app's formula-safe CSV cell escape; dates
 * and times are on the London clock.
 */

const TRAINING_LOG_HEADER = [
  'Date (London)',
  'Time (London)',
  'Event',
  'Person',
  'Course',
  'Done by',
  'Note code',
  'Note',
  'Details',
] as const

/** "3 November 2026 at 09:05" on the London clock. */
function formatAsAt(now: Date): string {
  const date = formatDateInLondon(now, { day: 'numeric', month: 'long', year: 'numeric' })
  return `${date} at ${formatTimeInLondon(now)}`
}

function metaText(meta: ActivityItem['meta']): string {
  return Object.entries(meta ?? {})
    .filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('; ')
}

function buildTrainingLogRows(items: readonly ActivityItem[], now: Date, scope: { personName?: string | null } = {}): string[][] {
  const title = scope.personName ? `Staff training log: ${scope.personName}` : 'Staff training log'
  const rows: string[][] = [
    [escapeCsvCell(title)],
    [`As at ${formatAsAt(now)} (London time)`],
    [`${items.length} ${items.length === 1 ? 'entry' : 'entries'}, newest first`],
    [],
    [...TRAINING_LOG_HEADER],
  ]
  for (const item of items) {
    const at = new Date(item.createdAt)
    const valid = Number.isFinite(at.getTime())
    rows.push([
      valid ? toLocalIsoDate(at) : '',
      valid ? formatTimeInLondon(at) : '',
      TRAINING_EVENT_BADGE[item.eventType]?.label ?? item.eventType,
      escapeCsvCell(item.employeeName ?? ''),
      escapeCsvCell(item.courseTitle ?? ''),
      escapeCsvCell(item.actorName ?? ''),
      escapeCsvCell(item.noteCode ?? ''),
      escapeCsvCell(item.note ?? ''),
      escapeCsvCell(metaText(item.meta)),
    ])
  }
  return rows
}

export function buildTrainingLogCsv(items: readonly ActivityItem[], now: Date, scope: { personName?: string | null } = {}): Buffer {
  return buildCsvBuffer(buildTrainingLogRows(items, now, scope))
}
