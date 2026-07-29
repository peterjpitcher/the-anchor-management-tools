import { describe, expect, it } from 'vitest'
import { buildReceiptFileName } from '../receipt-file-name'
import type { ReceiptFile, ReceiptTransaction } from '@/types/database'

describe('buildReceiptFileName', () => {
  it('puts the receipt GUID after the date, amount, and vendor', () => {
    const transaction = {
      id: 'transaction-id',
      transaction_date: '2026-03-15',
      amount_in: null,
      amount_out: 4.5,
      vendor_name: 'Coffee House',
    } as ReceiptTransaction
    const file = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      file_name: 'original.PDF',
    } as ReceiptFile

    expect(buildReceiptFileName(transaction, file, 0)).toBe(
      'receipts/2026-03-15 - £4.50 - Coffee House - 550e8400-e29b-41d4-a716-446655440000.pdf'
    )
  })

  it('uses incoming amounts and a safe fallback when the vendor is missing', () => {
    const transaction = {
      id: 'transaction-id',
      transaction_date: '2026-03-16',
      amount_in: 125,
      amount_out: null,
      vendor_name: null,
    } as ReceiptTransaction
    const file = {
      id: 'file-id',
      file_name: 'receipt.jpg',
    } as ReceiptFile

    expect(buildReceiptFileName(transaction, file, 0)).toBe(
      'receipts/2026-03-16 - £125.00 - Unknown Vendor - file-id.jpg'
    )
  })
})
