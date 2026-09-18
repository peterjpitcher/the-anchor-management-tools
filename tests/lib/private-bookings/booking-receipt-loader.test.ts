import { describe, expect, it, vi } from 'vitest'
const rows = vi.hoisted(() => ({ tables: {} as Record<string, unknown> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (name: string) => {
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query, single: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows.tables[name], error: null })) }
  return query
} }) }))
import { loadBookingReceipt } from '@/lib/private-bookings/booking-receipt-loader'
import { renderBookingReceiptHTML } from '@/lib/private-bookings/booking-receipt-pdf'

describe('receipt source privacy', () => {
  it('never exposes staff-only deposit refund reasons in the customer snapshot or PDF', async () => {
    rows.tables = {
      private_bookings: { id: 'booking', invoice_id: 'invoice', customer_name: 'Fixture', event_date: '2026-09-18', deposit_paid_date: '2026-09-01T12:00:00Z', deposit_amount: 20, deposit_payment_method: 'cash', invoice_deposit_treatment: 'held_separately', deposit_refund_status: 'refunded' },
      private_booking_invoices: [{ invoice_id: 'invoice', kind: 'original' }], private_booking_charge_batches: [], private_booking_payments: [],
      payment_refunds: [{ id: 'refund', source_id: 'booking', amount: 20, completed_at: '2026-09-19T12:00:00Z', status: 'completed', reason: 'PRIVATE STAFF INCIDENT NOTE' }],
      invoices: [{ id: 'invoice', invoice_number: 'FIXTURE-001', invoice_date: '2026-09-18', status: 'paid', total_amount: 120, vat_amount: 20, paid_amount: 120, discount_amount: 0, invoice_discount_percentage: 0, lines: [{ id: 'line', description: 'Fixture charge', quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20, display_order: 0 }] }],
      invoice_payments: [{ id: 'payment', invoice_id: 'invoice', payment_date: '2026-09-18', payment_method: 'cash', amount: 120, source_kind: null }], credit_notes: [],
    }
    const model = await loadBookingReceipt('booking')
    expect(model.kind).toBe('final_receipt')
    expect(model.refunds[0].purpose).toBe('Refundable booking deposit')
    expect(JSON.stringify(model)).not.toContain('PRIVATE STAFF INCIDENT NOTE')
    expect(renderBookingReceiptHTML(model, 1)).not.toContain('PRIVATE STAFF INCIDENT NOTE')
  })
})
