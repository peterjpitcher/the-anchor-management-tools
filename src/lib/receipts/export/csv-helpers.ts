/**
 * Shared CSV helpers for quarterly export.
 *
 * All CSVs follow the same pattern as the existing receipts CSV:
 * - BOM prefix for Excel compatibility
 * - Formula injection protection (tab-prefix on leading =, +, -, @)
 * - papaparse for generation
 * - DD/MM/YYYY date format
 */

import Papa from 'papaparse'

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@'])

/**
 * Makes free text safe to open in a spreadsheet: a cell that would be read as a formula is
 * prefixed with a tab, so it is shown as text.
 *
 * A spreadsheet ignores spaces, tabs and line breaks in front of a formula, so `" =1+1"` and
 * `"\r=1+1"` are formulas too. Those leading characters are dropped and the rest is then
 * prefixed. A cell that begins with a tab or a carriage return and is not a formula has them
 * dropped: both are themselves ways of starting one.
 *
 * Only for free-text columns. Numbers and dates are written as they are.
 */
export function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value
  const trimmed = value.replace(/^[\s\u0000-\u001f]+/, '')
  if (trimmed && FORMULA_TRIGGERS.has(trimmed[0])) {
    return '\t' + trimmed
  }
  if (value[0] === '\t' || value[0] === '\r' || value[0] === '\n') {
    return trimmed
  }
  return value
}

/**
 * Formats a YYYY-MM-DD date string as DD/MM/YYYY for UK locale.
 */
export function formatDateDdMmYyyy(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

/**
 * Formats a number as GBP with 2 decimal places.
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Converts a summary + header + data array into a BOM-prefixed CSV buffer.
 */
export function buildCsvBuffer(rows: string[][]): Buffer {
  const csv = Papa.unparse(rows, { newline: '\n' })
  return Buffer.from(`\ufeff${csv}`, 'utf-8')
}

/**
 * Returns human-readable quarter month range, e.g. "January — March".
 */
export function quarterMonthRange(quarter: number): string {
  const ranges: Record<number, string> = {
    1: 'January \u2014 March',
    2: 'April \u2014 June',
    3: 'July \u2014 September',
    4: 'October \u2014 December',
  }
  return ranges[quarter] ?? ''
}
