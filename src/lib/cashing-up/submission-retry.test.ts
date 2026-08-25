import { describe, expect, it } from 'vitest'
import type { CashupSession, UpsertCashupSessionDTO } from '@/types/cashing-up'
import { isMatchingCashupSubmissionRetry } from './submission-retry'

const input: UpsertCashupSessionDTO = {
  siteId: 'site-1',
  sessionDate: '2026-08-22',
  notes: 'Saturday cash-up',
  paymentBreakdowns: [
    { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 146.05, countedAmount: 146.05 },
    { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: 477.3, countedAmount: 477.3 },
    { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: 0, countedAmount: 0 },
  ],
  cashCounts: [
    { denomination: 20, totalAmount: 140 },
    { denomination: 5, totalAmount: 5 },
    { denomination: 1, totalAmount: 1 },
    { denomination: 0.05, totalAmount: 0.05 },
  ],
  salesBreakdowns: [
    { salesCategory: 'drinks_sales', amount: 412.35 },
    { salesCategory: 'food_sales', amount: 211 },
    { salesCategory: 'other_sales', amount: 0 },
  ],
}

const storedSession: CashupSession = {
  id: 'session-1',
  site_id: 'site-1',
  session_date: '2026-08-22',
  status: 'submitted',
  prepared_by_user_id: 'user-1',
  approved_by_user_id: null,
  total_expected_amount: 623.35,
  total_counted_amount: 623.35,
  total_variance_amount: 0,
  notes: 'Saturday cash-up',
  created_at: '2026-08-25T08:15:15Z',
  created_by_user_id: 'user-1',
  updated_at: '2026-08-25T08:15:15Z',
  updated_by_user_id: 'user-1',
  cashup_payment_breakdowns: [
    { id: 'p1', cashup_session_id: 'session-1', payment_type_code: 'CARD', payment_type_label: 'Card', expected_amount: 477.3, counted_amount: 477.3, variance_amount: 0 },
    { id: 'p2', cashup_session_id: 'session-1', payment_type_code: 'CASH', payment_type_label: 'Cash', expected_amount: 146.05, counted_amount: 146.05, variance_amount: 0 },
    { id: 'p3', cashup_session_id: 'session-1', payment_type_code: 'STRIPE', payment_type_label: 'Stripe', expected_amount: 0, counted_amount: 0, variance_amount: 0 },
  ],
  cashup_cash_counts: [
    { id: 'c1', cashup_session_id: 'session-1', denomination: 0.05, quantity: 1, total_amount: 0.05 },
    { id: 'c2', cashup_session_id: 'session-1', denomination: 1, quantity: 1, total_amount: 1 },
    { id: 'c3', cashup_session_id: 'session-1', denomination: 5, quantity: 1, total_amount: 5 },
    { id: 'c4', cashup_session_id: 'session-1', denomination: 20, quantity: 7, total_amount: 140 },
  ],
  cashup_sales_breakdowns: [
    { id: 's1', cashup_session_id: 'session-1', sales_category: 'food_sales', amount: 211 },
    { id: 's2', cashup_session_id: 'session-1', sales_category: 'other_sales', amount: 0 },
    { id: 's3', cashup_session_id: 'session-1', sales_category: 'drinks_sales', amount: 412.35 },
  ],
}

describe('isMatchingCashupSubmissionRetry', () => {
  it('accepts an exact retry from the user who created the submitted session', () => {
    expect(isMatchingCashupSubmissionRetry(storedSession, input, 'user-1')).toBe(true)
  })

  it('rejects a retry whose values differ', () => {
    const changedInput = {
      ...input,
      paymentBreakdowns: input.paymentBreakdowns.map(row =>
        row.paymentTypeCode === 'CARD' ? { ...row, countedAmount: 500 } : row
      ),
    }

    expect(isMatchingCashupSubmissionRetry(storedSession, changedInput, 'user-1')).toBe(false)
  })

  it('rejects an exact payload from a different user', () => {
    expect(isMatchingCashupSubmissionRetry(storedSession, input, 'user-2')).toBe(false)
  })
})
