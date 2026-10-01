import { describe, expect, it } from 'vitest'
import {
  createAmexTransactionHash,
  createTransactionHash,
  decodeStatement,
  parseAmexStatement,
  parseBankStatement,
  parseCsv,
  parseSignedAmount,
  parseStatementMoney,
} from '@/services/receipts/statementParsing'
import { parseStatementDate } from '@/lib/dateUtils'

/**
 * The real statement parsers. Every record in a file must come back either as a payment or as a
 * rejection with its record number and reason: accepted + rejected = records in the file.
 */

const TODAY = '2026-10-01'
const BANK_HEADER = 'Date,Details,Transaction Type,In,Out,Balance'

function bank(lines: string[], header = BANK_HEADER) {
  return parseBankStatement(Buffer.from([header, ...lines].join('\n'), 'utf-8'), { today: TODAY })
}

const AMEX_HEADER = 'Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Town/City,Reference,Category'

function amex(lines: string[], header = AMEX_HEADER) {
  return parseAmexStatement(Buffer.from([header, ...lines].join('\n'), 'utf-8'), { today: TODAY })
}

describe('parseStatementMoney', () => {
  it.each([
    ['12.50', 12.5],
    ['12.5', 12.5],
    ['12', 12],
    ['0.01', 0.01],
    ['1,234.56', 1234.56],
    ['1,234,567.89', 1234567.89],
    ['£45.00', 45],
    [' 45.00 ', 45],
    ['0.00', 0],
  ])('reads %j as %d', (raw, expected) => {
    expect(parseStatementMoney(raw)).toEqual({ kind: 'value', value: expected })
  })

  it.each([
    '12abc',
    '1,23',
    '12,34.56',
    '1,2345',
    '12.345',
    '12..5',
    '1 234.56',
    '12.50 CR',
    '(12.50)',
    'abc',
    '.50',
    '12.',
    '£',
    '1e3',
  ])('refuses %j rather than guessing', (raw) => {
    expect(parseStatementMoney(raw)).toEqual({ kind: 'invalid' })
  })

  it('tells a blank cell apart from an unreadable one', () => {
    expect(parseStatementMoney('')).toEqual({ kind: 'blank' })
    expect(parseStatementMoney('   ')).toEqual({ kind: 'blank' })
    expect(parseStatementMoney(null)).toEqual({ kind: 'blank' })
    expect(parseStatementMoney(undefined)).toEqual({ kind: 'blank' })
  })

  it('refuses a negative unless the column is a signed one', () => {
    expect(parseStatementMoney('-50.00')).toEqual({ kind: 'invalid' })
    expect(parseStatementMoney('-1,234.56', { allowNegative: true })).toEqual({ kind: 'value', value: -1234.56 })
    expect(parseStatementMoney('-£12.00', { allowNegative: true })).toEqual({ kind: 'value', value: -12 })
  })

  it('does not lose a penny to floating point', () => {
    for (const raw of ['0.07', '0.29', '1.15', '4.35', '19.99', '1,000.10', '8.20']) {
      const parsed = parseStatementMoney(raw)
      expect(parsed.kind).toBe('value')
      if (parsed.kind === 'value') {
        expect(parsed.value.toFixed(2)).toBe(Number(raw.replace(/,/g, '')).toFixed(2))
      }
    }
  })
})

describe('parseSignedAmount (Amex)', () => {
  it('keeps the sign and reads thousands', () => {
    expect(parseSignedAmount('12.34')).toBe(12.34)
    expect(parseSignedAmount('-12.34')).toBe(-12.34)
    expect(parseSignedAmount('£1,234.56')).toBe(1234.56)
  })

  it('gives null for blank, zero and unreadable values', () => {
    expect(parseSignedAmount('')).toBeNull()
    expect(parseSignedAmount('0.00')).toBeNull()
    expect(parseSignedAmount('0.004')).toBeNull()
    // These two used to be read as 12 and 123.
    expect(parseSignedAmount('12abc')).toBeNull()
    expect(parseSignedAmount('1,23')).toBeNull()
  })
})

describe('parseStatementDate', () => {
  it.each([
    ['01/09/2026', '2026-09-01'],
    ['1/9/2026', '2026-09-01'],
    ['31/12/2025', '2025-12-31'],
    ['29/02/2024', '2024-02-29'],
    ['2026-09-01', '2026-09-01'],
    [' 15/08/2026 ', '2026-08-15'],
  ])('reads %j as %s', (raw, expected) => {
    expect(parseStatementDate(raw, { today: TODAY })).toEqual({ ok: true, date: expected })
  })

  it.each([
    // Each of these used to be accepted and stored as a different, wrong date.
    ['02/13/2026', 'impossible'],
    ['31/02/2026', 'impossible'],
    ['00/00/2026', 'impossible'],
    ['29/02/2026', 'impossible'],
    ['2026-13-45', 'impossible'],
    ['01/02/26', 'format'],
    ['2026/03/04', 'format'],
    ['1 Sep 2026', 'format'],
    ['01-09-2026', 'format'],
    ['', 'missing'],
    ['   ', 'missing'],
  ])('refuses %j as %s', (raw, reason) => {
    expect(parseStatementDate(raw, { today: TODAY })).toEqual({ ok: false, reason })
  })

  it('refuses a date more than a day ahead, and allows today and tomorrow', () => {
    expect(parseStatementDate('01/10/2026', { today: TODAY })).toEqual({ ok: true, date: '2026-10-01' })
    expect(parseStatementDate('02/10/2026', { today: TODAY })).toEqual({ ok: true, date: '2026-10-02' })
    expect(parseStatementDate('03/10/2026', { today: TODAY })).toEqual({ ok: false, reason: 'future' })
    // A US-ordered date whose day is 12 or less looks valid. The future check is what catches
    // 10 January written as 10/01 being read as 1 October while it is still in the future.
    expect(parseStatementDate('11/12/2026', { today: TODAY })).toEqual({ ok: false, reason: 'future' })
  })

  it('takes null and undefined as missing', () => {
    expect(parseStatementDate(null)).toEqual({ ok: false, reason: 'missing' })
    expect(parseStatementDate(undefined)).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('parseBankStatement: every record is accounted for', () => {
  it('reads ordinary lines', () => {
    const result = bank([
      '01/09/2026,Card Purchase TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/09/2026,CLIENT LTD INV-A1,Credit,250.00,,1250.00',
    ])

    expect(result.rejected).toEqual([])
    expect(result.recordsInFile).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      transactionDate: '2026-09-01',
      details: 'Card Purchase TESCO STORES',
      transactionType: 'Card Purchase',
      amountIn: null,
      amountOut: 12.5,
      balance: 1000,
    })
    expect(result.rows[1]).toMatchObject({ amountIn: 250, amountOut: null })
  })

  it('accepted plus rejected always equals the records in the file', () => {
    const result = bank([
      '01/09/2026,GOOD ONE,Card Purchase,,12.50,1000.00',
      '02/13/2026,BAD DATE,Card Purchase,,5.00,995.00',
      '03/09/2026,BAD AMOUNT,Card Purchase,,12abc,990.00',
      '04/09/2026,GROUPING,Card Purchase,,"1,23",990.00',
      '05/09/2026,BOTH,Card Purchase,5.00,5.00,990.00',
      '06/09/2026,NEITHER,Card Purchase,,,990.00',
      '07/09/2026,ZERO,Card Purchase,0.00,0.00,990.00',
      '08/09/2026,BAD BALANCE,Card Purchase,,1.00,nine',
      ',NO DATE,Card Purchase,,1.00,989.00',
      '09/09/2026,,,,1.00,988.00',
      '10/09/2026,GOOD TWO,Direct Debit,,20.00,968.00',
    ])

    expect(result.recordsInFile).toBe(11)
    expect(result.rows.length + result.rejected.length).toBe(11)
    expect(result.rows.map((row) => row.details)).toEqual(['GOOD ONE', 'GOOD TWO'])
    expect(result.rejected.map((entry) => [entry.record, entry.reason])).toEqual([
      [2, 'impossible_date'],
      [3, 'bad_amount'],
      [4, 'bad_amount'],
      [5, 'both_amounts'],
      [6, 'no_amount'],
      [7, 'zero_amount'],
      [8, 'bad_balance'],
      [9, 'no_date'],
      [10, 'no_description'],
    ])
  })

  it('says, in plain words, what was wrong and where', () => {
    const result = bank(['03/09/2026,COFFEE SHOP,Card Purchase,,12abc,990.00'])

    expect(result.rejected[0]).toEqual({
      record: 1,
      reason: 'bad_amount',
      message: 'The Out amount "12abc" could not be read',
      excerpt: '03/09/2026 | COFFEE SHOP | 12abc',
    })
  })

  it('keeps a line the bank left without a description, using its type instead', () => {
    // The bank's own charges come with a blank Details column. They were dropped without a word.
    const result = bank([
      '28/01/2026,,Transaction Charges,,7.20,500.00',
      '28/01/2026,,Account Maintenance Fee,,8.50,491.50',
    ])

    expect(result.rejected).toEqual([])
    expect(result.rows.map((row) => [row.details, row.transactionType, row.amountOut])).toEqual([
      ['Transaction Charges', 'Transaction Charges', 7.2],
      ['Account Maintenance Fee', 'Account Maintenance Fee', 8.5],
    ])
  })

  it('treats a zero in the unused column as a blank', () => {
    const result = bank(['01/09/2026,WITH ZERO,Card Purchase,0.00,12.50,1000.00'])

    expect(result.rows[0]).toMatchObject({ amountIn: null, amountOut: 12.5 })
  })

  it('keeps an overdrawn balance', () => {
    const result = bank(['01/09/2026,OVERDRAWN,Card Purchase,,12.50,-50.00'])

    expect(result.rows[0].balance).toBe(-50)
  })

  it('counts a quoted description that runs over two lines as one record', () => {
    const result = bank([
      '01/09/2026,"FIRST LINE\nSECOND LINE, WITH A COMMA",Card Purchase,,12.50,1000.00',
      '02/09/2026,NEXT,Card Purchase,,1.00,999.00',
    ])

    expect(result.recordsInFile).toBe(2)
    expect(result.rows[0].details).toBe('FIRST LINE SECOND LINE, WITH A COMMA')
  })

  it('rejects a record whose columns have shifted', () => {
    // An unquoted comma in the description pushes the amount into the wrong column.
    const result = bank([
      '01/09/2026,SMITH, JONES AND CO,Card Purchase,,12.50,1000.00',
      '02/09/2026,NEXT,Card Purchase,,1.00,999.00',
    ])

    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]).toMatchObject({ record: 1, reason: 'columns' })
    expect(result.rows.map((row) => row.details)).toEqual(['NEXT'])
  })

  it('does not count blank lines as records', () => {
    const result = bank([
      '01/09/2026,ONE,Card Purchase,,12.50,1000.00',
      '',
      ',,,,,',
      '   ',
      '02/09/2026,TWO,Card Purchase,,1.00,999.00',
    ])

    expect(result.recordsInFile).toBe(2)
    expect(result.rejected).toEqual([])
  })

  it('names the missing column', () => {
    expect(() => bank(['x'], 'Details,Transaction Type,In,Out,Balance')).toThrow(/the "Date" column is missing/)
    expect(() => bank(['x'], 'Date,Description,Amount')).toThrow(/"Details" and "In or Out" columns are missing/)
    expect(() => bank(['x'], 'Date,Details,Transaction Type,In,Out,Balance')).not.toThrow()
  })

  it('reads a file with a byte order mark and padded headers', () => {
    const buffer = Buffer.from('﻿ Date , Details ,Transaction Type,In,Out,Balance\n01/09/2026,ONE,Card Purchase,,12.50,1000.00\n', 'utf-8')
    const result = parseBankStatement(buffer, { today: TODAY })

    expect(result.rows).toHaveLength(1)
  })

  it('reads a Windows-1252 file, where a pound sign is one byte', () => {
    const header = Buffer.from('Date,Details,Transaction Type,In,Out,Balance\n', 'latin1')
    const line = Buffer.from('01/09/2026,CAF\xc9 \xa35 DEAL,Card Purchase,,\xa312.50,1000.00\n', 'latin1')
    const result = parseBankStatement(Buffer.concat([header, line]), { today: TODAY })

    expect(result.rejected).toEqual([])
    expect(result.rows[0]).toMatchObject({ details: 'CAFÉ £5 DEAL', amountOut: 12.5 })
  })

  it('collapses whitespace in the description, so reformatting does not change identity', () => {
    const tidy = bank(['01/09/2026,CARD PURCHASE TESCO,Card Purchase,,12.50,1000.00'])
    const messy = bank(['01/09/2026,  CARD   PURCHASE  TESCO ,Card Purchase,,12.50,1000.00'])

    expect(messy.rows[0].details).toBe('CARD PURCHASE TESCO')
    expect(messy.rows[0].dedupeHash).toBe(tidy.rows[0].dedupeHash)
  })

  it('parseCsv still returns just the payments', () => {
    const rows = parseCsv(Buffer.from([BANK_HEADER, '01/09/2020,ONE,Card Purchase,,12.50,1000.00'].join('\n')))

    expect(rows).toHaveLength(1)
  })
})

describe('parseBankStatement: identical lines in one file', () => {
  it('keeps both, the first with the plain identity and the second with its occurrence number', () => {
    const line = '01/09/2026,COFFEE SHOP,Card Purchase,,3.50,'
    const result = bank([line, line, line])

    expect(result.rows).toHaveLength(3)
    expect(result.repeatedInFile).toBe(2)
    const [first, second, third] = result.rows.map((row) => row.dedupeHash)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(`${first}#2`)
    expect(third).toBe(`${first}#3`)
  })

  it('gives the same identities when the same file is read again', () => {
    const lines = ['01/09/2026,COFFEE SHOP,Card Purchase,,3.50,', '01/09/2026,COFFEE SHOP,Card Purchase,,3.50,']

    expect(bank(lines).rows.map((row) => row.dedupeHash)).toEqual(bank(lines).rows.map((row) => row.dedupeHash))
  })

  it('does not number lines that differ in the running balance', () => {
    const result = bank([
      '01/09/2026,COFFEE SHOP,Card Purchase,,3.50,100.00',
      '01/09/2026,COFFEE SHOP,Card Purchase,,3.50,96.50',
    ])

    expect(result.repeatedInFile).toBe(0)
    expect(new Set(result.rows.map((row) => row.dedupeHash)).size).toBe(2)
  })
})

describe('identity hashes are unchanged', () => {
  // Existing payments were imported with these recipes. A different hash for the same line
  // would import it a second time, so the exact values are pinned.
  it('bank: built from date, description, type, in, out and balance joined by bars', async () => {
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update('2026-09-01|CARD PURCHASE TESCO|Card Purchase||12.5|1000').digest('hex')

    expect(bank(['01/09/2026,CARD PURCHASE TESCO,Card Purchase,,12.50,1000.00']).rows[0].dedupeHash).toBe(expected)
    expect(
      createTransactionHash({
        transactionDate: '2026-09-01',
        details: 'CARD PURCHASE TESCO',
        transactionType: 'Card Purchase',
        amountIn: null,
        amountOut: 12.5,
        balance: 1000,
      })
    ).toBe(expected)
  })

  it('amex: prefixed, with the amount to two places and the description', async () => {
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update('amex|2026-09-01|12.50|12345|MR A PERSON|REF1|COFFEE SHOP').digest('hex')

    expect(
      createAmexTransactionHash({
        transactionDate: '2026-09-01',
        signedAmount: 12.5,
        cardAccount: '12345',
        rawCardMember: 'MR A PERSON',
        externalReference: 'REF1',
        details: 'COFFEE SHOP',
      })
    ).toBe(expected)
  })
})

describe('parseAmexStatement', () => {
  it('reads spend, a refund, a payment and a fee', () => {
    const result = amex([
      "01/09/2026,COFFEE SHOP STAINES,MR A PERSON,-12345,3.50,,COFFEE SHOP,STAINES,'REF1',Restaurants",
      '02/09/2026,AMAZON REFUND,MR A PERSON,-12345,-10.00,,AMAZON,,,',
      '03/09/2026,PAYMENT RECEIVED - THANK YOU,MR A PERSON,-12345,-500.00,,,,,',
      '04/09/2026,MEMBERSHIP FEE,MR A PERSON,-12345,25.00,,,,,',
    ])

    expect(result.rejected).toEqual([])
    expect(result.recordsInFile).toBe(4)
    expect(result.rows[0]).toMatchObject({
      sourceType: 'amex',
      amountOut: 3.5,
      amountIn: null,
      status: 'pending',
      receiptRequired: true,
      cardMember: 'Mr A Person',
      cardAccount: '12345',
      externalReference: 'REF1',
      merchantTown: 'STAINES',
      merchantCategory: 'Restaurants',
    })
    expect(result.rows[1]).toMatchObject({ amountIn: 10, amountOut: null, status: 'no_receipt_required', vendorName: null })
    expect(result.rows[2]).toMatchObject({ status: 'no_receipt_required', vendorName: 'American Express', vendorSource: 'import' })
    expect(result.rows[3]).toMatchObject({
      status: 'no_receipt_required',
      expenseCategory: 'Bank Charges/Credit Card Commission',
      expenseCategorySource: 'import',
    })
  })

  it('rejects, with a reason, what it cannot read', () => {
    const result = amex([
      '01/09/2026,GOOD,MR A PERSON,-12345,3.50,,,,,',
      '02/09/2026,NO AMOUNT,MR A PERSON,-12345,,,,,,',
      '03/09/2026,BAD AMOUNT,MR A PERSON,-12345,12abc,,,,,',
      '04/09/2026,ZERO,MR A PERSON,-12345,0.00,,,,,',
      '31/02/2026,BAD DATE,MR A PERSON,-12345,1.00,,,,,',
      '05/09/2026,,MR A PERSON,-12345,1.00,,,,,',
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rejected.map((entry) => [entry.record, entry.reason])).toEqual([
      [2, 'no_amount'],
      [3, 'bad_amount'],
      [4, 'zero_amount'],
      [5, 'impossible_date'],
      [6, 'no_description'],
    ])
    expect(result.rows.length + result.rejected.length).toBe(result.recordsInFile)
  })

  it('keeps two identical purchases as two payments', () => {
    // Most Amex lines carry no reference, so two coffees on one day are identical in every field.
    const line = '01/09/2026,COFFEE SHOP,MR A PERSON,-12345,3.50,,,,,'
    const result = amex([line, line])

    expect(result.rows).toHaveLength(2)
    expect(result.repeatedInFile).toBe(1)
    expect(result.rows[1].dedupeHash).toBe(`${result.rows[0].dedupeHash}#2`)
  })

  it('falls back to the statement description when the description is blank', () => {
    const result = amex(['01/09/2026,,MR A PERSON,-12345,3.50,,AS SHOWN ON STATEMENT,,,'])

    expect(result.rows[0].details).toBe('AS SHOWN ON STATEMENT')
  })

  it('names the missing column', () => {
    expect(() => amex(['x'], 'Date,Description,Amount')).toThrow(/the "Card Member" column is missing/)
    expect(() => amex(['x'], BANK_HEADER)).toThrow(/does not look like an American Express statement/)
  })
})

describe('decodeStatement', () => {
  it('reads UTF-16 with a byte order mark', () => {
    const text = 'Date,Details\n01/09/2026,ONE\n'
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

    expect(decodeStatement(utf16)).toBe(text)
  })

  it('strips a UTF-8 byte order mark', () => {
    expect(decodeStatement(Buffer.from('﻿Date', 'utf-8'))).toBe('Date')
  })
})
