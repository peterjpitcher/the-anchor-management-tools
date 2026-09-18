import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { readBookingPaymentLedger, readBookingPaymentLedgers } from './payment-ledger'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

function database(options: { treatment?: string; invoiceError?: boolean; bookingError?: boolean; paymentError?: boolean; invoiceMissing?: boolean; supplementary?: boolean; voidExtra?: boolean; creditedExtra?: boolean } = {}) {
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      in: vi.fn(async (_column: string, ids: string[]) => {
        if (table === 'private_bookings') return {
          data: ids.map(id => ({ id, invoice_id: `invoice-${id}`, invoice_deposit_treatment: options.treatment ?? 'deducted' })),
          error: options.bookingError ? { message: 'unavailable' } : null,
        }
        if (table === 'private_booking_payments') return {
          data: ids.map(id => ({ id: `cash-${id}`, booking_id: id, amount: 100, method: 'cash', created_at: '2026-09-01' })),
          error: options.paymentError ? { message: 'unavailable' } : null,
        }
        if (table === 'private_booking_invoices') return { data: ids.flatMap(id => [{ booking_id: id, invoice_id: `invoice-${id}`, kind: 'original' }, ...(options.supplementary ? [{ booking_id: id, invoice_id: `extra-${id}`, kind: 'supplementary' }] : [])]), error: null }
        if (table === 'invoices') return { data: options.invoiceMissing ? [] : ids.map(id => ({ id, status: id.startsWith('extra-') && options.voidExtra ? 'void' : 'partially_paid', deleted_at: null, total_amount: id.startsWith('extra-') ? 700 : 1014.8, paid_amount: id.startsWith('extra-') ? 664.8 : 1014.8, credits: id.startsWith('extra-') && options.creditedExtra ? [{ status: 'issued', amount_inc_vat: 20 }, { status: 'draft', amount_inc_vat: 99 }] : [] })), error: null }
        return {
          data: ids.flatMap(id => [
            { id: `copy-${id}`, invoice_id: id, amount: 100, source_kind: 'booking_payment' },
            { id: `deposit-${id}`, invoice_id: id, amount: 250, source_kind: 'booking_deposit' },
            { id: `paypal-${id}`, invoice_id: id, amount: '644.80', source_kind: 'paypal', payment_method: 'paypal', payment_date: '2026-09-05', created_at: '2026-09-05T12:00:00Z' },
            { id: `manual-${id}`, invoice_id: id, amount: 20, source_kind: null, payment_method: 'bank_transfer', payment_date: '2026-09-04', created_at: '2026-09-04T12:00:00Z' },
          ]),
          error: options.invoiceError ? { message: 'unavailable' } : null,
        }
      }),
    })),
  }))
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>)
  return from
}

beforeEach(() => vi.clearAllMocks())

describe('linked booking payment ledger', () => {
  it('counts original money once and applies only the actual invoice deposit credit', async () => {
    database()
    const ledger = await readBookingPaymentLedger('booking')
    expect(ledger.balancePaymentsTotal).toBe(764.8)
    expect(ledger.appliedDepositAmount).toBe(250)
    expect(ledger.eventPaidTotal).toBe(1014.8)
    expect(ledger.payments).toHaveLength(3)
    expect(ledger.payments.find(payment => payment.method === 'paypal')).toMatchObject({ readonly: true, source: 'invoice', invoice_id: 'invoice-booking', amount: 644.8 })
  })

  it('keeps a held deposit separate from the event balance', async () => {
    database({ treatment: 'held_separately' })
    const ledger = await readBookingPaymentLedger('booking')
    expect(ledger.appliedDepositAmount).toBe(0)
    expect(ledger.eventPaidTotal).toBe(764.8)
  })

  it('loads multiple bookings in five batch queries without mixing their money', async () => {
    const from = database()
    const ledgers = await readBookingPaymentLedgers(['one', 'two', 'one'])
    expect(from).toHaveBeenCalledTimes(5)
    expect(ledgers.size).toBe(2)
    expect(ledgers.get('one')?.eventPaidTotal).toBe(1014.8)
    expect(ledgers.get('two')?.payments.every(payment => payment.booking_id === 'two')).toBe(true)
  })

  it('fails closed when a linked invoice is missing', async () => {
    database({ invoiceMissing: true })
    await expect(readBookingPaymentLedger('booking')).rejects.toThrow('missing or withdrawn')
  })

  it.each(['bookingError', 'paymentError', 'invoiceError'] as const)('fails closed on %s', async key => {
    database({ [key]: true })
    await expect(readBookingPaymentLedger('booking')).rejects.toThrow('Failed to load')
  })
})


describe('supplementary invoice ledger', () => {
  it('aggregates each real allocation and counts deposit and copied booking money once', async () => {
    database({ supplementary: true, creditedExtra: true })
    const ledger = await readBookingPaymentLedger('booking')
    expect(ledger.balancePaymentsTotal).toBe(1429.6)
    expect(ledger.appliedDepositAmount).toBe(250)
    expect(ledger.eventPaidTotal).toBe(1679.6)
    expect(ledger.supplementaryChargesTotal).toBe(700)
    expect(ledger.creditsTotal).toBe(20)
    expect(ledger.invoiceBalanceTotal).toBe(15.2)
    expect(ledger.payments).toHaveLength(5)
  })

  it('retains cancelled extra invoice association without making its charges collectible', async () => {
    database({ supplementary: true, voidExtra: true })
    const ledger = await readBookingPaymentLedger('booking')
    expect(ledger.supplementaryChargesTotal).toBe(0)
    expect(ledger.eventPaidTotal).toBe(1014.8)
  })
})
