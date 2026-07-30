// Voucher number formatting and input normalisation (spec 2.7, F49/F50)
// Canonical format: AN-YYMM-NNNN, uppercase, monthly sequence reset, no five-digit fallback.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_KEY_PATTERN = /^\d{4}$/
const FULL_NUMBER_PATTERN = /^AN-\d{4}-\d{4}$/
const PREFIXED_COMPACT_PATTERN = /^AN(\d{4})(\d{4})$/
const BARE_COMPACT_PATTERN = /^(\d{4})(\d{4})$/

// Derives the 'YYMM' counter key from a London calendar date string (yyyy-mm-dd),
// e.g. '2026-07-30' becomes '2607'. Callers get the London date from dateUtils
// (getTodayIsoDate / toLocalIsoDate), never from raw new Date() maths.
export function voucherMonthKey(londonDate: string): string {
  if (!ISO_DATE_PATTERN.test(londonDate)) {
    throw new Error(`Invalid London date for voucher month key: ${londonDate}`)
  }
  return `${londonDate.slice(2, 4)}${londonDate.slice(5, 7)}`
}

// Formats a canonical voucher number from a month key and a 1-based sequence.
// Sequences above 9999 are a hard failure per spec 2.7 (generation stops, no fallback).
export function formatVoucherNumber(monthKey: string, seq: number): string {
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new Error(`Invalid voucher month key: ${monthKey}`)
  }
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) {
    throw new Error(`Voucher sequence out of range (1-9999): ${seq}`)
  }
  return `AN-${monthKey}-${String(seq).padStart(4, '0')}`
}

// Normalises raw lookup or scanner input per F50: uppercase, trim, strip all
// whitespace (covers trailing \n \t \r scanner suffixes and internal spaces),
// hyphens optional. Returns the canonical AN-YYMM-NNNN when a full number is
// recognisable (with or without the AN prefix), otherwise the cleaned string
// for partial search. Partials keep any hyphens the user typed so they can
// substring-match the canonical stored format.
export function normaliseVoucherNumberInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/\s+/g, '')
  const compact = cleaned.replace(/-/g, '')
  const prefixed = PREFIXED_COMPACT_PATTERN.exec(compact)
  if (prefixed) {
    return `AN-${prefixed[1]}-${prefixed[2]}`
  }
  const bare = BARE_COMPACT_PATTERN.exec(compact)
  if (bare) {
    return `AN-${bare[1]}-${bare[2]}`
  }
  return cleaned
}

// True only for the canonical uppercase hyphenated form. Run inputs through
// normaliseVoucherNumberInput first.
export function isFullVoucherNumber(value: string): boolean {
  return FULL_NUMBER_PATTERN.test(value)
}
