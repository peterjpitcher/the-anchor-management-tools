import { describe, expect, it } from 'vitest'
import {
  assertFixPendingPaymentLimit,
  assertFixPendingPaymentMutationAllowed,
  assertFixPendingPaymentMutationSucceeded,
  readFixPendingPaymentLimit,
  resolveFixPendingPaymentRow
} from '@/lib/pending-payment-fix-safety'

describe('pending payment fix safety', () => {
  it('throws when booking lookup query fails', () => {
    expect(() =>
      resolveFixPendingPaymentRow({
        operation: 'Load table booking by reference TB-2025-0634',
        row: null,
        error: { message: 'database unavailable' }
      })
    ).toThrow('Load table booking by reference TB-2025-0634 failed: database unavailable')
  })

  it('throws when payment lookup returns no row', () => {
    expect(() =>
      resolveFixPendingPaymentRow({
        operation: 'Load latest payment for booking booking-1',
        row: null,
        error: null
      })
    ).toThrow('Load latest payment for booking booking-1 returned no rows')
  })

  it('blocks mutation unless explicit safety env var is enabled', () => {
    const previous = process.env.ALLOW_FIX_PENDING_PAYMENT_MUTATION
    delete process.env.ALLOW_FIX_PENDING_PAYMENT_MUTATION

    expect(() => assertFixPendingPaymentMutationAllowed()).toThrow(
      'fix-pending-payment blocked by safety guard. Set ALLOW_FIX_PENDING_PAYMENT_MUTATION=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_PENDING_PAYMENT_MUTATION = 'true'
    expect(() => assertFixPendingPaymentMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_FIX_PENDING_PAYMENT_MUTATION
    } else {
      process.env.ALLOW_FIX_PENDING_PAYMENT_MUTATION = previous
    }
  })

  it('throws when mutation update fails', () => {
    expect(() =>
      assertFixPendingPaymentMutationSucceeded({
        operation: 'Mark payment payment-1 as completed',
        error: { message: 'permission denied' },
        row: null
      })
    ).toThrow('Mark payment payment-1 as completed failed: permission denied')
  })

  it('throws when mutation update affects no rows', () => {
    expect(() =>
      assertFixPendingPaymentMutationSucceeded({
        operation: 'Mark booking booking-1 as confirmed',
        error: null,
        row: null
      })
    ).toThrow('Mark booking booking-1 as confirmed affected no rows')
  })

  it('passes when mutation update returns a row', () => {
    expect(() =>
      assertFixPendingPaymentMutationSucceeded({
        operation: 'Insert audit log for pending-payment fix',
        error: null,
        row: { id: 'audit-1' }
      })
    ).not.toThrow()
  })

  it('reads mutation limit from argv or env', () => {
    expect(readFixPendingPaymentLimit(['node', 'script', '--limit', '1'], {})).toBe('1')
    expect(readFixPendingPaymentLimit(['node', 'script', '--limit=1'], {})).toBe('1')
    expect(readFixPendingPaymentLimit(['node', 'script'], { FIX_PENDING_PAYMENT_LIMIT: '1' })).toBe(
      '1'
    )
  })

  it('requires a hard cap of --limit=1 in mutation mode', () => {
    expect(() => assertFixPendingPaymentLimit(null)).toThrow('--limit is required')
    expect(() => assertFixPendingPaymentLimit('0')).toThrow('--limit must be 1')
    expect(() => assertFixPendingPaymentLimit('2')).toThrow('--limit must be 1')
    expect(assertFixPendingPaymentLimit('1')).toBe(1)
  })
})
