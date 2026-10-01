/**
 * How a note on a payment is stored: a timestamp, a separator, then what the person typed.
 *
 * Notes written before October 2026 used a long dash as the separator. New notes use a plain
 * bar. Both are read. The long dash is built from its code point so that this file contains
 * none: the repository's writing rules refuse the character in source.
 */

import { formatDateTimeInLondon } from '@/lib/dateUtils'

const LEGACY_SEPARATOR = ` ${String.fromCharCode(0x2014)} `
const SEPARATOR = ' | '

/** "01 Oct 2026, 14:30", as `composeReceiptNote` writes it, with or without the comma. */
const STAMP_PATTERN = /^\d{1,2} [A-Za-z]{3,9} \d{4},? (?:at )?\d{1,2}:\d{2}$/

export type ReceiptNoteParts = {
  /** When the note was written, as stored. Null for a note with no timestamp. */
  stamp: string | null
  text: string
}

/** Splits a stored note into its timestamp and its text. A note with no timestamp is all text. */
export function splitReceiptNote(raw: string | null | undefined): ReceiptNoteParts {
  const value = (raw ?? '').trim()
  if (!value) return { stamp: null, text: '' }

  for (const separator of [LEGACY_SEPARATOR, SEPARATOR]) {
    const index = value.indexOf(separator)
    if (index <= 0) continue
    const stamp = value.slice(0, index).trim()
    // Only a real timestamp counts: a note that merely contains a bar is left whole.
    if (STAMP_PATTERN.test(stamp)) {
      return { stamp, text: value.slice(index + separator.length).trim() }
    }
  }

  return { stamp: null, text: value }
}

/** The note as it is stored: stamped with London time. An empty note is stored as nothing. */
export function composeReceiptNote(text: string, now: Date = new Date()): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const stamp = formatDateTimeInLondon(now, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${stamp}${SEPARATOR}${trimmed}`
}
