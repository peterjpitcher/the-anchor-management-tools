import { describe, expect, it } from 'vitest'
import { buildPrivateBookingBalanceDueSummaries } from '@/app/(authenticated)/dashboard/private-booking-balances'

describe('buildPrivateBookingBalanceDueSummaries', () => {
  it('shows outstanding event balances from calculated totals and omits settled bookings', () => {
    const summaries = buildPrivateBookingBalanceDueSummaries(
      [
        {
          id: 'partial-balance',
          customer_name: null,
          customer_first_name: 'Milly',
          customer_last_name: 'Ganatra',
          balance_due_date: '2026-06-06',
          event_date: '2026-06-13',
          status: 'confirmed',
          total_amount: null,
          calculated_total: '225.00',
          final_payment_date: null,
        },
        {
          id: 'fully-paid',
          customer_name: 'Sam Paid',
          balance_due_date: '2026-06-07',
          event_date: '2026-06-14',
          status: 'confirmed',
          total_amount: '100.00',
          calculated_total: '100.00',
          final_payment_date: null,
        },
        {
          id: 'final-payment-date',
          customer_name: 'Taylor Final',
          balance_due_date: '2026-06-08',
          event_date: '2026-06-15',
          status: 'confirmed',
          total_amount: '80.00',
          calculated_total: '80.00',
          final_payment_date: '2026-06-01',
        },
        {
          id: 'table-total-fallback',
          customer_name: 'Fallback Total',
          balance_due_date: '2026-06-09',
          event_date: '2026-06-16',
          status: 'confirmed',
          total_amount: '75.00',
          calculated_total: null,
          final_payment_date: null,
        },
      ],
      [
        { booking_id: 'partial-balance', amount: '25.00' },
        { booking_id: 'fully-paid', amount: '40.00' },
        { booking_id: 'fully-paid', amount: '60.00' },
      ],
    )

    expect(summaries).toEqual([
      {
        id: 'partial-balance',
        customer_name: 'Milly Ganatra',
        balance_due_date: '2026-06-06',
        event_date: '2026-06-13',
        status: 'confirmed',
        total_amount: 200,
      },
      {
        id: 'table-total-fallback',
        customer_name: 'Fallback Total',
        balance_due_date: '2026-06-09',
        event_date: '2026-06-16',
        status: 'confirmed',
        total_amount: 75,
      },
    ])
  })
})
