/**
 * Reads a bank or American Express statement CSV into payments.
 *
 * Every data record in the file is accounted for: it is either returned as a payment or
 * returned as rejected with its record number and a plain reason. Nothing is dropped quietly.
 * A data record is one parsed CSV record after the header, not counting wholly blank ones; a
 * quoted field that runs over several lines is still one record.
 *
 * Money and dates are read strictly. The parsers this replaces took "12abc" as 12 and "1,23"
 * as 123, turned 02/13/2026 into 2 January 2027, and skipped any line they could not read
 * without saying so.
 *
 * Pure: no database access.
 */

import { createHash } from 'crypto'
import Papa from 'papaparse'
import { parseStatementDate, type StatementDateResult } from '@/lib/dateUtils'
import type { ReceiptExpenseCategory } from '@/types/database'
import type { AmexCsvRow, CsvRow, ParsedTransactionRow } from './types'

export type StatementRejectionReason =
  | 'columns'
  | 'no_description'
  | 'no_date'
  | 'bad_date'
  | 'impossible_date'
  | 'future_date'
  | 'bad_amount'
  | 'no_amount'
  | 'zero_amount'
  | 'both_amounts'
  | 'bad_balance'

export type RejectedStatementRecord = {
  /** 1 for the first data record after the header. */
  record: number
  reason: StatementRejectionReason
  /** Plain English, ready to show. */
  message: string
  /** Enough of the record to find it in the file. */
  excerpt: string
}

export type StatementParseResult = {
  rows: ParsedTransactionRow[]
  rejected: RejectedStatementRecord[]
  /** Data records in the file. Always rows.length + rejected.length. */
  recordsInFile: number
  /** Records identical to an earlier one in the same file, kept as separate payments. */
  repeatedInFile: number
}

type MoneyParse = { kind: 'blank' } | { kind: 'value'; value: number } | { kind: 'invalid' }

// ---------------------------------------------------------------------------
// Text, money and identity
// ---------------------------------------------------------------------------

function collapseWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

/**
 * Statement exports are UTF-8, sometimes with a byte order mark. A file saved from Excel on
 * Windows can be Windows-1252, where a pound sign is a single byte that UTF-8 cannot read;
 * decoding that as UTF-8 quietly turns it into a replacement character.
 */
export function decodeStatement(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

// Optional pound sign, then digits with correctly placed thousands separators or none at all,
// then an optional one or two decimal places. Nothing else: no letters, no stray commas, no
// third decimal place.
const MONEY_PATTERN = /^£?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/**
 * Reads one money cell. Blank is not the same as unreadable: a blank cell is normal (a line has
 * an In or an Out, not both), an unreadable one rejects the record.
 */
export function parseStatementMoney(
  raw: string | null | undefined,
  options: { allowNegative?: boolean } = {}
): MoneyParse {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { kind: 'blank' }

  let body = trimmed
  let sign = 1
  if (body.startsWith('-')) {
    if (!options.allowNegative) return { kind: 'invalid' }
    sign = -1
    body = body.slice(1).trim()
  }

  const match = MONEY_PATTERN.exec(body)
  if (!match) return { kind: 'invalid' }

  const whole = match[1].replace(/,/g, '')
  const pence = (match[2] ?? '').padEnd(2, '0')
  const value = Number(`${whole}.${pence}`)
  if (!Number.isFinite(value)) return { kind: 'invalid' }

  return { kind: 'value', value: sign * value }
}

/**
 * The signed amount on an American Express line: positive is spend, negative is a payment or
 * credit. Null when the cell is blank, unreadable or zero.
 */
export function parseSignedAmount(value: string | null | undefined): number | null {
  const parsed = parseStatementMoney(value, { allowNegative: true })
  if (parsed.kind !== 'value' || parsed.value === 0) return null
  return parsed.value
}

/**
 * The identity of a bank line. Existing rows were imported with exactly this recipe, so it
 * must not change: a different hash for the same line would import it a second time.
 */
export function createTransactionHash(input: {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
}): string {
  const hash = createHash('sha256')
  hash.update([input.transactionDate, input.details, input.transactionType ?? '', input.amountIn ?? '', input.amountOut ?? '', input.balance ?? ''].join('|'))
  return hash.digest('hex')
}

/**
 * The identity of an American Express line. The 'amex' prefix guarantees no collision with a
 * bank hash. The description is part of it, because most Amex lines carry no reference
 * (98 of the first 136 had none), so the reference alone cannot tell two lines apart.
 * Existing rows were imported with this recipe, so it must not change.
 */
export function createAmexTransactionHash(input: {
  transactionDate: string
  signedAmount: number
  cardAccount: string | null
  rawCardMember: string | null
  externalReference: string | null
  details: string
}): string {
  const hash = createHash('sha256')
  hash.update(
    [
      'amex',
      input.transactionDate,
      input.signedAmount.toFixed(2),
      input.cardAccount ?? '',
      input.rawCardMember ?? '',
      input.externalReference ?? '',
      input.details,
    ].join('|'),
  )
  return hash.digest('hex')
}

/**
 * Two lines that are identical in every field are still two payments (two coffees from one
 * shop on one day). The first keeps its hash, so rows already imported stay matched; each
 * later one gets the hash with its occurrence number appended. Returns how many were kept
 * this way.
 */
function distinguishRepeats(rows: ParsedTransactionRow[]): number {
  const seen = new Map<string, number>()
  let repeated = 0
  for (const row of rows) {
    const occurrence = (seen.get(row.dedupeHash) ?? 0) + 1
    seen.set(row.dedupeHash, occurrence)
    if (occurrence > 1) {
      row.dedupeHash = `${row.dedupeHash}#${occurrence}`
      repeated += 1
    }
  }
  return repeated
}

// ---------------------------------------------------------------------------
// Shared record handling
// ---------------------------------------------------------------------------

const DATE_REJECTIONS: Record<Exclude<StatementDateResult, { ok: true }>['reason'], {
  reason: StatementRejectionReason
  message: (raw: string) => string
}> = {
  missing: { reason: 'no_date', message: () => 'No date' },
  format: { reason: 'bad_date', message: (raw) => `The date "${raw}" is not in day/month/year form` },
  impossible: { reason: 'impossible_date', message: (raw) => `The date "${raw}" is not a real date` },
  future: { reason: 'future_date', message: (raw) => `The date "${raw}" is in the future` },
}

function excerptOf(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => collapseWhitespace(part ?? ''))
    .filter(Boolean)
    .join(' | ')
    .slice(0, 120)
}

type ParsedCsv<T> = { fields: string[]; records: T[]; miscounted: Set<number> }

function readCsv<T>(buffer: Buffer): ParsedCsv<T> {
  const parsed = Papa.parse<T>(decodeStatement(buffer), {
    header: true,
    // 'greedy' also skips a line of nothing but commas or spaces, which is how a blank
    // spreadsheet row is exported.
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })

  // A record with too many or too few fields has had its columns shifted, usually by a comma
  // inside an unquoted description. Its amount may be sitting in the wrong column.
  const miscounted = new Set<number>()
  for (const error of parsed.errors) {
    if (error.type === 'FieldMismatch' && typeof error.row === 'number') {
      miscounted.add(error.row)
    }
  }

  return { fields: parsed.meta.fields ?? [], records: parsed.data, miscounted }
}

function missingColumns(fields: string[], required: string[]): string[] {
  return required.filter((name) => !fields.includes(name))
}

// ---------------------------------------------------------------------------
// Bank statement
// ---------------------------------------------------------------------------

const BANK_LAYOUT = 'Date, Details, Transaction Type, In, Out, Balance'

export function parseBankStatement(buffer: Buffer, options: { today?: string } = {}): StatementParseResult {
  const { fields, records, miscounted } = readCsv<CsvRow>(buffer)

  const missing = missingColumns(fields, ['Date', 'Details'])
  if (!fields.includes('In') && !fields.includes('Out')) missing.push('In or Out')
  if (missing.length) {
    throw new Error(
      `This does not look like a bank statement CSV: the ${missing.map((name) => `"${name}"`).join(' and ')} column${missing.length === 1 ? ' is' : 's are'} missing. The file needs these columns: ${BANK_LAYOUT}.`,
    )
  }

  const rows: ParsedTransactionRow[] = []
  const rejected: RejectedStatementRecord[] = []

  records.forEach((record, index) => {
    const recordNumber = index + 1
    const excerpt = excerptOf([record.Date, record.Details, record.In, record.Out])
    const reject = (reason: StatementRejectionReason, message: string) => {
      rejected.push({ record: recordNumber, reason, message, excerpt })
    }

    if (miscounted.has(index)) {
      return reject('columns', 'The number of columns is wrong, usually an unquoted comma in the description')
    }

    // The bank leaves the description blank on its own charges ("Transaction Charges",
    // "Account Maintenance Fee") and on some withdrawals and transfers. Those are real money
    // movements, so the transaction type stands in as the description. The parser this
    // replaces skipped them without a word: 45 lines across the 2019 to 2025 statements.
    const transactionType = collapseWhitespace(record['Transaction Type'] || '') || null
    const details = collapseWhitespace(record.Details || '') || transactionType
    if (!details) return reject('no_description', 'No description and no transaction type')

    const date = parseStatementDate(record.Date, options)
    if (!date.ok) {
      const rejection = DATE_REJECTIONS[date.reason]
      return reject(rejection.reason, rejection.message(collapseWhitespace(record.Date || '')))
    }

    const moneyIn = parseStatementMoney(record.In)
    const moneyOut = parseStatementMoney(record.Out)
    if (moneyIn.kind === 'invalid') return reject('bad_amount', `The In amount "${collapseWhitespace(record.In || '')}" could not be read`)
    if (moneyOut.kind === 'invalid') return reject('bad_amount', `The Out amount "${collapseWhitespace(record.Out || '')}" could not be read`)

    const inValue = moneyIn.kind === 'value' ? moneyIn.value : 0
    const outValue = moneyOut.kind === 'value' ? moneyOut.value : 0
    if (inValue > 0 && outValue > 0) return reject('both_amounts', 'Both In and Out have an amount')
    if (inValue === 0 && outValue === 0) {
      const explicitZero = moneyIn.kind === 'value' || moneyOut.kind === 'value'
      return explicitZero ? reject('zero_amount', 'The amount is zero') : reject('no_amount', 'No amount')
    }

    const balance = parseStatementMoney(record.Balance, { allowNegative: true })
    if (balance.kind === 'invalid') return reject('bad_balance', `The balance "${collapseWhitespace(record.Balance || '')}" could not be read`)

    // A zero in the unused column is the same as a blank: the line is one-directional.
    const amountIn = inValue > 0 ? inValue : null
    const amountOut = outValue > 0 ? outValue : null
    const balanceValue = balance.kind === 'value' ? balance.value : null

    rows.push({
      transactionDate: date.date,
      details,
      transactionType,
      amountIn,
      amountOut,
      balance: balanceValue,
      dedupeHash: createTransactionHash({
        transactionDate: date.date,
        details,
        transactionType,
        amountIn,
        amountOut,
        balance: balanceValue,
      }),
    })
  })

  const repeatedInFile = distinguishRepeats(rows)
  return { rows, rejected, recordsInFile: records.length, repeatedInFile }
}

// ---------------------------------------------------------------------------
// American Express statement
// ---------------------------------------------------------------------------

const AMEX_VENDOR = 'American Express'
const AMEX_FEE_CATEGORY: ReceiptExpenseCategory = 'Bank Charges/Credit Card Commission'
const AMEX_LAYOUT = 'Date, Description, Card Member, Account #, Amount'

function toTitleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

type AmexClassification = Pick<
  ParsedTransactionRow,
  'status' | 'receiptRequired' | 'expenseCategory' | 'expenseCategorySource' | 'vendorName' | 'vendorSource'
>

function classifyAmexRow(details: string, signedAmount: number): AmexClassification {
  const upper = details.toUpperCase()
  const isPayment = upper.startsWith('PAYMENT RECEIVED') || upper.startsWith('CREDIT FOR')
  const isFee =
    upper.includes('INTEREST CHARGE') ||
    upper.includes('MEMBERSHIP FEE') ||
    upper.includes('LATE PAYMENT FEE')

  if (isPayment) {
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: null,
      expenseCategorySource: null,
      vendorName: AMEX_VENDOR,
      vendorSource: 'import',
    }
  }
  if (isFee) {
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: AMEX_FEE_CATEGORY,
      expenseCategorySource: 'import',
      vendorName: AMEX_VENDOR,
      vendorSource: 'import',
    }
  }
  if (signedAmount < 0) {
    // A merchant refund or other credit: not a purchase to chase.
    return {
      status: 'no_receipt_required',
      receiptRequired: false,
      expenseCategory: null,
      expenseCategorySource: null,
      vendorName: null,
      vendorSource: null,
    }
  }
  // Genuine spend. Vendor and category are left for the rules and the AI.
  return {
    status: 'pending',
    receiptRequired: true,
    expenseCategory: null,
    expenseCategorySource: null,
    vendorName: null,
    vendorSource: null,
  }
}

export function parseAmexStatement(buffer: Buffer, options: { today?: string } = {}): StatementParseResult {
  const { fields, records, miscounted } = readCsv<AmexCsvRow>(buffer)

  const missing = missingColumns(fields, ['Date', 'Card Member', 'Amount'])
  if (!fields.includes('Description') && !fields.includes('Appears On Your Statement As')) {
    missing.push('Description')
  }
  if (missing.length) {
    throw new Error(
      `This does not look like an American Express statement: the ${missing.map((name) => `"${name}"`).join(' and ')} column${missing.length === 1 ? ' is' : 's are'} missing. The file needs at least these columns: ${AMEX_LAYOUT}.`,
    )
  }

  const rows: ParsedTransactionRow[] = []
  const rejected: RejectedStatementRecord[] = []

  records.forEach((record, index) => {
    const recordNumber = index + 1
    const excerpt = excerptOf([record.Date, record.Description || record['Appears On Your Statement As'], record.Amount])
    const reject = (reason: StatementRejectionReason, message: string) => {
      rejected.push({ record: recordNumber, reason, message, excerpt })
    }

    if (miscounted.has(index)) {
      return reject('columns', 'The number of columns is wrong, usually an unquoted comma in the description')
    }

    const details = collapseWhitespace(record.Description || record['Appears On Your Statement As'] || '')
    if (!details) return reject('no_description', 'No description')

    const date = parseStatementDate(record.Date, options)
    if (!date.ok) {
      const rejection = DATE_REJECTIONS[date.reason]
      return reject(rejection.reason, rejection.message(collapseWhitespace(record.Date || '')))
    }

    const amount = parseStatementMoney(record.Amount, { allowNegative: true })
    if (amount.kind === 'blank') return reject('no_amount', 'No amount')
    if (amount.kind === 'invalid') return reject('bad_amount', `The amount "${collapseWhitespace(record.Amount || '')}" could not be read`)
    if (amount.value === 0) return reject('zero_amount', 'The amount is zero')

    const signedAmount = amount.value
    const amountOut = signedAmount > 0 ? signedAmount : null
    const amountIn = signedAmount < 0 ? Math.abs(signedAmount) : null

    const rawCardMember = collapseWhitespace(record['Card Member'] || '') || null
    const cardMember = rawCardMember ? toTitleCase(rawCardMember) : null
    const cardAccount = (record['Account #'] || '').replace(/[^0-9]/g, '') || null
    const merchantCategory = collapseWhitespace(record.Category || '') || null
    const merchantTown = collapseWhitespace(record['Town/City'] || '') || null
    const externalReference = (record.Reference || '').replace(/^'+|'+$/g, '').trim() || null

    rows.push({
      transactionDate: date.date,
      details,
      transactionType: null,
      amountIn,
      amountOut,
      balance: null,
      dedupeHash: createAmexTransactionHash({
        transactionDate: date.date,
        signedAmount,
        cardAccount,
        rawCardMember,
        externalReference,
        details,
      }),
      sourceType: 'amex',
      cardMember,
      cardAccount,
      merchantCategory,
      merchantTown,
      externalReference,
      ...classifyAmexRow(details, signedAmount),
    })
  })

  const repeatedInFile = distinguishRepeats(rows)
  return { rows, rejected, recordsInFile: records.length, repeatedInFile }
}

/** The payments in a bank statement. Use parseBankStatement to also see what was rejected. */
export function parseCsv(buffer: Buffer): ParsedTransactionRow[] {
  return parseBankStatement(buffer).rows
}

/** The payments in an American Express statement. Use parseAmexStatement to also see what was rejected. */
export function parseAmexCsv(buffer: Buffer): ParsedTransactionRow[] {
  return parseAmexStatement(buffer).rows
}
