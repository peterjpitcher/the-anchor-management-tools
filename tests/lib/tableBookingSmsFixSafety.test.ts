import { describe, expect, it } from 'vitest'
import {
  assertFixTableBookingSmsCompletedWithoutFailures,
  assertFixTableBookingSmsProbeLimit,
  assertFixTableBookingSmsProbeMutationAllowed,
  assertFixTableBookingSmsProbeMutationSucceeded,
  readFixTableBookingSmsProbeLimit,
  resolveFixTableBookingSmsRows
} from '@/lib/table-booking-sms-fix-safety'

describe('table booking sms fix safety', () => {
  it('throws when diagnostics query fails', () => {
    expect(() =>
      resolveFixTableBookingSmsRows({
        operation: 'Load recent confirmed table bookings for SMS diagnostics',
        rows: null,
        error: { message: 'jobs query unavailable' }
      })
    ).toThrow(
      'Load recent confirmed table bookings for SMS diagnostics failed: jobs query unavailable'
    )
  })

  it('returns an empty array when diagnostics query returns null rows without error', () => {
    const rows = resolveFixTableBookingSmsRows({
      operation: 'Load recent failed SMS jobs for diagnostics',
      rows: null,
      error: null
    })

    expect(rows).toEqual([])
  })

  it('blocks mutation probe unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION
    delete process.env.ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION

    expect(() => assertFixTableBookingSmsProbeMutationAllowed()).toThrow(
      'fix-table-booking-sms blocked by safety guard. Set ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION = 'true'
    expect(() => assertFixTableBookingSmsProbeMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION
    } else {
      process.env.ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION = previous
    }
  })

  it('throws when mutation probe affects fewer rows than expected', () => {
    expect(() =>
      assertFixTableBookingSmsProbeMutationSucceeded({
        operation: 'Insert table-booking SMS diagnostic probe job',
        error: null,
        rows: [],
        expectedCount: 1
      })
    ).toThrow('Insert table-booking SMS diagnostic probe job affected no rows')
  })

  it('throws when mutation probe returns database error', () => {
    expect(() =>
      assertFixTableBookingSmsProbeMutationSucceeded({
        operation: 'Delete table-booking SMS diagnostic probe job',
        error: { message: 'delete permission denied' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete table-booking SMS diagnostic probe job failed: delete permission denied')
  })

  it('throws when script completion has recorded failures', () => {
    expect(() =>
      assertFixTableBookingSmsCompletedWithoutFailures({
        failureCount: 1,
        failures: ['booking:1:Load existing SMS jobs for booking 1 failed: relation missing']
      })
    ).toThrow(
      'fix-table-booking-sms completed with 1 failure(s): booking:1:Load existing SMS jobs for booking 1 failed: relation missing'
    )
  })

  it('reads write-probe limit from argv or env', () => {
    expect(readFixTableBookingSmsProbeLimit(['node', 'script', '--limit', '1'], {})).toBe('1')
    expect(readFixTableBookingSmsProbeLimit(['node', 'script', '--limit=1'], {})).toBe('1')
    expect(
      readFixTableBookingSmsProbeLimit(['node', 'script'], { FIX_TABLE_BOOKING_SMS_PROBE_LIMIT: '1' })
    ).toBe('1')
  })

  it('requires a hard cap of --limit=1 for write probes', () => {
    expect(() => assertFixTableBookingSmsProbeLimit(null)).toThrow('--limit is required')
    expect(() => assertFixTableBookingSmsProbeLimit('0')).toThrow('--limit must be 1')
    expect(() => assertFixTableBookingSmsProbeLimit('2')).toThrow('--limit must be 1')
    expect(assertFixTableBookingSmsProbeLimit('1')).toBe(1)
  })
})
