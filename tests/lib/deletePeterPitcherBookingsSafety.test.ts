import { describe, expect, it } from 'vitest'
import {
  assertDeletePeterPitcherBookingsCompletedWithoutFailures,
  assertDeletePeterPitcherBookingsLimit,
  assertDeletePeterPitcherBookingsMutationAllowed,
  assertDeletePeterPitcherBookingsMutationSucceeded,
  isDeletePeterPitcherBookingsMutationRunEnabled,
  readDeletePeterPitcherBookingsLimit,
  resolveDeletePeterPitcherBookingsRows
} from '@/lib/delete-peter-pitcher-bookings-safety'

describe('delete-peter-pitcher-bookings safety', () => {
  it('requires --confirm and RUN env to enable mutation mode', () => {
    const previous = process.env.RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION
    process.env.RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION = 'true'

    expect(isDeletePeterPitcherBookingsMutationRunEnabled(['tsx', 'script.ts'])).toBe(false)
    expect(isDeletePeterPitcherBookingsMutationRunEnabled(['tsx', 'script.ts', '--confirm'])).toBe(
      true
    )

    if (previous === undefined) {
      delete process.env.RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION
    } else {
      process.env.RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env is missing', () => {
    const previous = process.env.ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION
    delete process.env.ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION

    expect(() => assertDeletePeterPitcherBookingsMutationAllowed()).toThrow(
      'delete-peter-pitcher-bookings blocked by safety guard. Set ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION
    } else {
      process.env.ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION = previous
    }
  })

  it('reads --limit from argv or env fallback', () => {
    expect(readDeletePeterPitcherBookingsLimit(['tsx', 'script.ts', '--limit', '4'])).toBe(4)

    const previous = process.env.DELETE_PETER_PITCHER_BOOKINGS_LIMIT
    process.env.DELETE_PETER_PITCHER_BOOKINGS_LIMIT = '6'
    expect(readDeletePeterPitcherBookingsLimit(['tsx', 'script.ts'])).toBe(6)
    if (previous === undefined) {
      delete process.env.DELETE_PETER_PITCHER_BOOKINGS_LIMIT
    } else {
      process.env.DELETE_PETER_PITCHER_BOOKINGS_LIMIT = previous
    }
  })

  it('requires a positive mutation limit within hard cap', () => {
    expect(() => assertDeletePeterPitcherBookingsLimit(null, 200)).toThrow(
      'delete-peter-pitcher-bookings blocked: --limit is required in mutation mode.'
    )

    expect(() => assertDeletePeterPitcherBookingsLimit(201, 200)).toThrow(
      'delete-peter-pitcher-bookings blocked: --limit 201 exceeds hard cap 200. Run in smaller batches.'
    )

    expect(assertDeletePeterPitcherBookingsLimit(12, 200)).toBe(12)
  })

  it('fails closed when query errors', () => {
    expect(() =>
      resolveDeletePeterPitcherBookingsRows({
        operation: 'Load customer rows',
        rows: null,
        error: { message: 'customers lookup failed' }
      })
    ).toThrow('Load customer rows failed: customers lookup failed')
  })

  it('fails closed when mutation row count mismatches expected', () => {
    expect(() =>
      assertDeletePeterPitcherBookingsMutationSucceeded({
        operation: 'Delete Peter booking rows',
        error: null,
        rows: [{ id: 'row-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete Peter booking rows affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when mutation returns database error', () => {
    expect(() =>
      assertDeletePeterPitcherBookingsMutationSucceeded({
        operation: 'Delete Peter booking rows',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete Peter booking rows failed: delete failed')
  })

  it('fails completion when unresolved failures remain', () => {
    expect(() =>
      assertDeletePeterPitcherBookingsCompletedWithoutFailures({
        failureCount: 1,
        failures: ['Expected 0 remaining targeted bookings after deletion, found 2']
      })
    ).toThrow(
      'delete-peter-pitcher-bookings completed with 1 failure(s): Expected 0 remaining targeted bookings after deletion, found 2'
    )
  })
})
