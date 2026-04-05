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

/**
 * Prefixes formula-injection trigger characters with a tab so spreadsheet
 * applications treat the cell as text rather than a formula.
 */
export function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value
  if (['=', '+', '-', '@'].includes(value[0])) {
    return '\t' + value
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
