import { describe, expect, it } from 'vitest'
import {
  assertDeleteTestBookingsCompletedWithoutFailures,
  assertDeleteTestBookingsForceAllowed,
  assertDeleteTestBookingsLimit,
  assertDeleteTestBookingsMutationAllowed,
  assertDeleteTestBookingsMutationSucceeded,
  isDeleteTestBookingsMutationRunEnabled,
  readDeleteTestBookingsLimit,
  resolveDeleteTestBookingsRows
} from '@/lib/delete-test-bookings-safety'

describe('delete-test-bookings safety', () => {
  it('detects mutation run mode from env', () => {
    const previous = process.env.RUN_DELETE_TEST_BOOKINGS_MUTATION
    process.env.RUN_DELETE_TEST_BOOKINGS_MUTATION = 'true'

    expect(isDeleteTestBookingsMutationRunEnabled()).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_DELETE_TEST_BOOKINGS_MUTATION
    } else {
      process.env.RUN_DELETE_TEST_BOOKINGS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env is missing', () => {
    const previous = process.env.ALLOW_DELETE_TEST_BOOKINGS_MUTATION
    delete process.env.ALLOW_DELETE_TEST_BOOKINGS_MUTATION

    expect(() => assertDeleteTestBookingsMutationAllowed()).toThrow(
      'delete-test-bookings blocked by safety guard. Set ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_TEST_BOOKINGS_MUTATION
    } else {
      process.env.ALLOW_DELETE_TEST_BOOKINGS_MUTATION = previous
    }
  })

  it('reads --limit from argv or env fallback', () => {
    expect(readDeleteTestBookingsLimit(['tsx', 'script.ts', '--limit', '1'])).toBe(1)

    const previous = process.env.DELETE_TEST_BOOKINGS_LIMIT
    process.env.DELETE_TEST_BOOKINGS_LIMIT = '1'
    expect(readDeleteTestBookingsLimit(['tsx', 'script.ts'])).toBe(1)
    if (previous === undefined) {
      delete process.env.DELETE_TEST_BOOKINGS_LIMIT
    } else {
      process.env.DELETE_TEST_BOOKINGS_LIMIT = previous
    }
  })

  it('requires a positive mutation limit within hard cap', () => {
    expect(() => assertDeleteTestBookingsLimit(null, 1)).toThrow(
      'delete-test-bookings blocked: --limit is required in mutation mode.'
    )

    expect(() => assertDeleteTestBookingsLimit(2, 1)).toThrow(
      'delete-test-bookings blocked: --limit 2 exceeds hard cap 1. Run in smaller batches.'
    )

    expect(assertDeleteTestBookingsLimit(1, 1)).toBe(1)
  })

  it('blocks deleting confirmed paid bookings without --force', () => {
    expect(() =>
      assertDeleteTestBookingsForceAllowed({
        status: 'confirmed',
        hasCompletedPayment: true,
        forceEnabled: false
      })
    ).toThrow('Refusing to delete confirmed booking with completed payment without --force.')
  })

  it('fails closed when row queries error', () => {
    expect(() =>
      resolveDeleteTestBookingsRows({
        operation: 'Load jobs linked to booking',
        rows: null,
        error: { message: 'jobs lookup failed' }
      })
    ).toThrow('Load jobs linked to booking failed: jobs lookup failed')
  })

  it('fails closed when mutation row count mismatches expected', () => {
    expect(() =>
      assertDeleteTestBookingsMutationSucceeded({
        operation: 'Delete booking row',
        error: null,
        rows: [{ id: 'booking-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete booking row affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when mutation returns database error', () => {
    expect(() =>
      assertDeleteTestBookingsMutationSucceeded({
        operation: 'Delete booking row',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete booking row failed: delete failed')
  })

  it('fails completion when unresolved failures remain', () => {
    expect(() =>
      assertDeleteTestBookingsCompletedWithoutFailures({
        failureCount: 1,
        failures: ['Booking booking-1 still exists after deletion attempt']
      })
    ).toThrow(
      'delete-test-bookings completed with 1 failure(s): Booking booking-1 still exists after deletion attempt'
    )
  })
})
