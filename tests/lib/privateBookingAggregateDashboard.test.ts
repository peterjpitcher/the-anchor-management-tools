import { describe, expect, it } from 'vitest'
import { buildPrivateBookingBalanceDueSummaries } from '@/app/(authenticated)/dashboard/private-booking-balances'

describe('booking dashboard aggregate balance', () => {
  it('uses reconciled invoice balances instead of only the legacy booking payment rows', () => {
    const rows = buildPrivateBookingBalanceDueSummaries([{ id: 'fixture', customer_name: 'Fixture', balance_due_date: '2026-10-01', gross_total: 180, balance_remaining: 60 }], [])
    expect(rows[0].total_amount).toBe(60)
  })
  it('shows reopened extra charges even if an old payment stamp is present', () => {
    const rows = buildPrivateBookingBalanceDueSummaries([{ id: 'fixture', balance_due_date: '2026-10-01', gross_total: 180, balance_remaining: 60, final_payment_date: '2026-09-18' }], [])
    expect(rows[0].total_amount).toBe(60)
  })
})

import { paymentStatementProblem } from '@/lib/private-bookings/payment-statement'

describe('supplementary invoice balance statement', () => {
  it('reconciles credits separately from cash receipts', () => {
    expect(paymentStatementProblem({ eventTotal: 180, paidTowardsBill: 120, balanceDue: 40, creditsAmount: 20, entries: [{ id: 'cash', type: 'balance', amount: 120, method: 'cash', date: '2026-09-18' }] })).toBeNull()
  })
  it('does not silently allocate an overpayment on the original invoice to an extra invoice', () => {
    expect(paymentStatementProblem({ eventTotal: 180, paidTowardsBill: 140, balanceDue: 60, unappliedCreditAmount: 20, entries: [{ id: 'cash', type: 'balance', amount: 140, method: 'cash', date: '2026-09-18' }] })).toBeNull()
  })
  it('refuses an unexplained mismatch', () => {
    expect(paymentStatementProblem({ eventTotal: 180, paidTowardsBill: 120, balanceDue: 40, entries: [{ id: 'cash', type: 'balance', amount: 120, method: 'cash', date: '2026-09-18' }] })).toBe('balance_does_not_match')
  })
})
