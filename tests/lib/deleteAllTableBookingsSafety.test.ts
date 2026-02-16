import { describe, expect, it } from 'vitest'
import {
  assertDeleteAllTableBookingsCompletedWithoutFailures,
  assertDeleteAllTableBookingsLimit,
  assertDeleteAllTableBookingsMutationAllowed,
  assertDeleteAllTableBookingsMutationSucceeded,
  isDeleteAllTableBookingsMutationRunEnabled,
  readDeleteAllTableBookingsLimit,
  resolveDeleteAllTableBookingsCount,
  resolveDeleteAllTableBookingsRows
} from '@/lib/delete-all-table-bookings-safety'

describe('delete-all-table-bookings safety', () => {
  it('requires --confirm and RUN flag to enable mutation mode', () => {
    const previous = process.env.RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION
    process.env.RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION = 'true'

    expect(isDeleteAllTableBookingsMutationRunEnabled(['tsx', 'script.ts'])).toBe(false)
    expect(isDeleteAllTableBookingsMutationRunEnabled(['tsx', 'script.ts', '--confirm'])).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION
    } else {
      process.env.RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION = previous
    }
  })

  it('blocks mutation when ALLOW flag is missing', () => {
    const previous = process.env.ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION
    delete process.env.ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION

    expect(() => assertDeleteAllTableBookingsMutationAllowed()).toThrow(
      'delete-all-table-bookings blocked by safety guard. Set ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION
    } else {
      process.env.ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION = previous
    }
  })

  it('reads --limit from argv or env fallback', () => {
    expect(readDeleteAllTableBookingsLimit(['tsx', 'script.ts', '--limit', '14'])).toBe(14)

    const previous = process.env.DELETE_ALL_TABLE_BOOKINGS_LIMIT
    process.env.DELETE_ALL_TABLE_BOOKINGS_LIMIT = '22'
    expect(readDeleteAllTableBookingsLimit(['tsx', 'script.ts'])).toBe(22)
    if (previous === undefined) {
      delete process.env.DELETE_ALL_TABLE_BOOKINGS_LIMIT
    } else {
      process.env.DELETE_ALL_TABLE_BOOKINGS_LIMIT = previous
    }
  })

  it('requires a positive mutation limit within hard cap', () => {
    expect(() => assertDeleteAllTableBookingsLimit(null, 10000)).toThrow(
      'delete-all-table-bookings blocked: --limit is required in mutation mode.'
    )

    expect(() => assertDeleteAllTableBookingsLimit(10001, 10000)).toThrow(
      'delete-all-table-bookings blocked: --limit 10001 exceeds hard cap 10000. Run in smaller batches.'
    )

    expect(assertDeleteAllTableBookingsLimit(1500, 10000)).toBe(1500)
  })

  it('fails closed when count query errors', () => {
    expect(() =>
      resolveDeleteAllTableBookingsCount({
        operation: 'Count table bookings',
        count: null,
        error: { message: 'table_bookings unavailable' }
      })
    ).toThrow('Count table bookings failed: table_bookings unavailable')
  })

  it('fails closed when count is invalid', () => {
    expect(() =>
      resolveDeleteAllTableBookingsCount({
        operation: 'Count table bookings',
        count: null,
        error: null
      })
    ).toThrow('Count table bookings returned invalid count')
  })

  it('fails closed when row query errors', () => {
    expect(() =>
      resolveDeleteAllTableBookingsRows({
        operation: 'Load SMS jobs',
        rows: null,
        error: { message: 'jobs lookup failed' }
      })
    ).toThrow('Load SMS jobs failed: jobs lookup failed')
  })

  it('fails closed when mutation row count does not match expected', () => {
    expect(() =>
      assertDeleteAllTableBookingsMutationSucceeded({
        operation: 'Delete table_booking_items rows',
        error: null,
        rows: [{ id: 'row-1' }],
        expectedCount: 2
      })
    ).toThrow(
      'Delete table_booking_items rows affected unexpected row count (expected 2, got 1)'
    )
  })

  it('fails closed when mutation returns a database error', () => {
    expect(() =>
      assertDeleteAllTableBookingsMutationSucceeded({
        operation: 'Delete table_bookings rows',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete table_bookings rows failed: delete failed')
  })

  it('fails completion when unresolved post-delete failures remain', () => {
    expect(() =>
      assertDeleteAllTableBookingsCompletedWithoutFailures({
        failureCount: 1,
        failures: ['Expected 0 remaining table_bookings rows, found 2']
      })
    ).toThrow(
      'delete-all-table-bookings completed with 1 failure(s): Expected 0 remaining table_bookings rows, found 2'
    )
  })
})
