import { describe, expect, it } from 'vitest'
import {
  createAmexTransactionHash,
  createTransactionHash,
  parseAmexCsv,
  parseCsv,
  parseSignedAmount,
} from './receiptHelpers'

describe('parseSignedAmount', () => {
  it('parses a positive spend', () => {
    expect(parseSignedAmount('261.99')).toBe(261.99)
  })

  it('keeps a negative payment/credit signed', () => {
    expect(parseSignedAmount('-2358.05')).toBe(-2358.05)
  })

  it('strips commas and currency symbols', () => {
    expect(parseSignedAmount('£1,234.50')).toBe(1234.5)
  })

  it('returns null for blank, zero, or invalid', () => {
    expect(parseSignedAmount('')).toBeNull()
    expect(parseSignedAmount('0')).toBeNull()
    expect(parseSignedAmount('abc')).toBeNull()
    expect(parseSignedAmount(null)).toBeNull()
  })
})

describe('createAmexTransactionHash', () => {
  const base = {
    transactionDate: '2026-04-16',
    signedAmount: 261.99,
    cardAccount: '71001',
    rawCardMember: 'MR P PITCHER',
    externalReference: 'AT261060074000010265389',
    details: 'AMZNMKTPLACE',
  }

  it('is stable for identical raw input', () => {
    expect(createAmexTransactionHash(base)).toBe(createAmexTransactionHash({ ...base }))
  })

  it('ignores display casing (uses raw fields only)', () => {
    // Hash takes rawCardMember; a differently-cased DISPLAY name must not change it.
    const a = createAmexTransactionHash(base)
    const b = createAmexTransactionHash({ ...base, rawCardMember: 'MR P PITCHER' })
    expect(a).toBe(b)
  })

  it('differs from the bank hash for the same date+amount', () => {
    const bank = createTransactionHash({
      transactionDate: '2026-04-16',
      details: 'AMZNMKTPLACE',
      transactionType: null,
      amountIn: null,
      amountOut: 261.99,
      balance: null,
    })
    expect(createAmexTransactionHash(base)).not.toBe(bank)
  })

  it('changes when the reference changes', () => {
    expect(createAmexTransactionHash(base)).not.toBe(
      createAmexTransactionHash({ ...base, externalReference: 'DIFFERENT' }),
    )
  })
})

const AMEX_HEADER =
  'Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Address,Town/City,Postcode,Country,Reference,Category'

function amexBuffer(rows: string[]): Buffer {
  return Buffer.from([AMEX_HEADER, ...rows].join('\n'), 'utf-8')
}

describe('parseAmexCsv', () => {
  it('throws a clear error when given a bank CSV', () => {
    const bank = Buffer.from('Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,X,,1.00,,5.00', 'utf-8')
    expect(() => parseAmexCsv(bank)).toThrow(/American Express/i)
  })

  it('maps a positive amount to amount_out and a purchase to pending', () => {
    const rows = parseAmexCsv(amexBuffer([
      "16/04/2026,AMZNMKTPLACE,MR P PITCHER,-71001,261.99,,AMZNMKTPLACE,1 PLACE,LONDON,EC2A 2BA,UK,'AT261060074000010265389',General Purchases-Online Purchases",
    ]))
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.amountOut).toBe(261.99)
    expect(row.amountIn).toBeNull()
    expect(row.sourceType).toBe('amex')
    expect(row.status).toBe('pending')
    expect(row.receiptRequired).toBe(true)
    expect(row.cardMember).toBe('Mr P Pitcher')
    expect(row.cardAccount).toBe('71001')
    expect(row.merchantCategory).toBe('General Purchases-Online Purchases')
    expect(row.merchantTown).toBe('LONDON')
    expect(row.externalReference).toBe('AT261060074000010265389')
    expect(row.transactionDate).toBe('2026-04-16')
  })

  it('maps a negative payment to amount_in and no_receipt_required', () => {
    const rows = parseAmexCsv(amexBuffer([
      "31/05/2026,PAYMENT RECEIVED - THANK YOU,MR P PITCHER,-71001,-2358.05,,PAYMENT RECEIVED,,,,,'100000',",
    ]))
    expect(rows[0].amountIn).toBe(2358.05)
    expect(rows[0].amountOut).toBeNull()
    expect(rows[0].status).toBe('no_receipt_required')
    expect(rows[0].receiptRequired).toBe(false)
    expect(rows[0].vendorName).toBe('American Express')
    expect(rows[0].expenseCategory).toBeNull()
  })

  it('routes interest/fee rows to Bank Charges with import source', () => {
    const rows = parseAmexCsv(amexBuffer([
      "19/06/2026,INTEREST CHARGE,MR P PITCHER,-71001,17.02,,INTEREST CHARGE,,,,,'100001',",
      "14/05/2026,LATE PAYMENT FEE,MR P PITCHER,-71001,12.00,,LATE PAYMENT FEE,,,,,'100002',",
      "19/04/2026,MEMBERSHIP FEE,MR P PITCHER,-71001,250.00,,MEMBERSHIP FEE,,,,,'100003',",
    ]))
    for (const row of rows) {
      expect(row.status).toBe('no_receipt_required')
      expect(row.receiptRequired).toBe(false)
      expect(row.expenseCategory).toBe('Bank Charges/Credit Card Commission')
      expect(row.expenseCategorySource).toBe('import')
      expect(row.vendorName).toBe('American Express')
    }
  })

  it('treats a credit-for/refund as no_receipt_required with no category', () => {
    const rows = parseAmexCsv(amexBuffer([
      "26/05/2026,CREDIT FOR INTEREST CHARGE,MR P PITCHER,-71001,-0.08,,CREDIT,,,,,'100004',",
    ]))
    expect(rows[0].status).toBe('no_receipt_required')
    expect(rows[0].amountIn).toBe(0.08)
    expect(rows[0].expenseCategory).toBeNull()
  })

  it('is idempotent: identical rows hash identically', () => {
    const line = "16/04/2026,AMZNMKTPLACE,MR P PITCHER,-71001,261.99,,AMZN,1 PLACE,LONDON,EC2A 2BA,UK,'AT261060074000010265389',General Purchases-Online Purchases"
    const a = parseAmexCsv(amexBuffer([line]))[0]
    const b = parseAmexCsv(amexBuffer([line]))[0]
    expect(a.dedupeHash).toBe(b.dedupeHash)
  })

  it('tags every parsed row with sourceType amex', () => {
    const rows = parseAmexCsv(amexBuffer([
      "16/04/2026,AMZNMKTPLACE,MR P PITCHER,-71001,261.99,,AMZN,1 PLACE,LONDON,EC2A 2BA,UK,'AT261060074000010265389',General Purchases-Online Purchases",
      "31/05/2026,PAYMENT RECEIVED - THANK YOU,MR P PITCHER,-71001,-2358.05,,PAYMENT RECEIVED,,,,,'100000',",
      "19/06/2026,INTEREST CHARGE,MR P PITCHER,-71001,17.02,,INTEREST CHARGE,,,,,'100001',",
    ]))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.sourceType).toBe('amex')
    }
  })
})

describe('parseCsv header guard', () => {
  it('throws when an Amex CSV is uploaded under the bank toggle', () => {
    const amex = Buffer.from(
      "Date,Description,Card Member,Account #,Amount\n16/04/2026,X,MR P,-71001,1.00",
      'utf-8',
    )
    expect(() => parseCsv(amex)).toThrow(/bank statement/i)
  })

  it('still parses a valid bank CSV', () => {
    const bank = Buffer.from(
      'Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,TEST,Card,1.50,,10.00',
      'utf-8',
    )
    const rows = parseCsv(bank)
    expect(rows).toHaveLength(1)
    expect(rows[0].amountIn).toBe(1.5)
  })
})
