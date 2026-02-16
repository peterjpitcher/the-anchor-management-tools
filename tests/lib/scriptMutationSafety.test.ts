import { describe, expect, it } from 'vitest'
import {
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
  assertScriptExpectedRowCount,
  assertScriptCompletedWithoutFailures
} from '@/lib/script-mutation-safety'

describe('script mutation safety', () => {
  it('blocks mutation script when approval env var is missing', () => {
    delete process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT

    expect(() =>
      assertScriptMutationAllowed({
        scriptName: 'reset-jobs',
        envVar: 'ALLOW_JOB_RETRY_MUTATION_SCRIPT'
      })
    ).toThrow(
      'reset-jobs blocked by safety guard. Set ALLOW_JOB_RETRY_MUTATION_SCRIPT=true to run this mutation script.'
    )
  })

  it('allows mutation script when approval env var is enabled', () => {
    process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT = 'true'

    expect(() =>
      assertScriptMutationAllowed({
        scriptName: 'retry-failed-jobs',
        envVar: 'ALLOW_JOB_RETRY_MUTATION_SCRIPT'
      })
    ).not.toThrow()
  })

  it('throws when mutation query returns database error', () => {
    expect(() =>
      assertScriptMutationSucceeded({
        operation: 'Reschedule pending jobs',
        error: { message: 'database unavailable' },
        updatedRows: null
      })
    ).toThrow('Reschedule pending jobs failed: database unavailable')
  })

  it('throws when mutation query affects no rows and zero rows are disallowed', () => {
    expect(() =>
      assertScriptMutationSucceeded({
        operation: 'Retry failed parse_cv jobs',
        error: null,
        updatedRows: [],
        allowZeroRows: false
      })
    ).toThrow('Retry failed parse_cv jobs affected no rows')
  })

  it('returns updated count when mutation succeeds', () => {
    const result = assertScriptMutationSucceeded({
      operation: 'Retry failed parse_cv jobs',
      error: null,
      updatedRows: [{ id: 'job-1' }, { id: 'job-2' }],
      allowZeroRows: true
    })

    expect(result).toEqual({ updatedCount: 2 })
  })

  it('throws when query fails', () => {
    expect(() =>
      assertScriptQuerySucceeded({
        operation: 'Load cancelled parking bookings',
        error: { message: 'read timeout' },
        data: null
      })
    ).toThrow('Load cancelled parking bookings failed: read timeout')
  })

  it('throws when required query returns no row', () => {
    expect(() =>
      assertScriptQuerySucceeded({
        operation: 'Load latest payment row',
        error: null,
        data: null
      })
    ).toThrow('Load latest payment row returned no rows')
  })

  it('allows missing query row when explicitly allowed', () => {
    const result = assertScriptQuerySucceeded({
      operation: 'Load optional row',
      error: null,
      data: null,
      allowMissing: true
    })

    expect(result).toBeNull()
  })

  it('throws when row count is lower than expected', () => {
    expect(() =>
      assertScriptExpectedRowCount({
        operation: 'Fix reminder-only flag',
        expected: 3,
        actual: 2
      })
    ).toThrow('Fix reminder-only flag affected unexpected row count (expected 3, got 2)')
  })

  it('passes when row count matches expected', () => {
    expect(() =>
      assertScriptExpectedRowCount({
        operation: 'Fix reminder-only flag',
        expected: 2,
        actual: 2
      })
    ).not.toThrow()
  })

  it('throws when script completes with recorded failures', () => {
    expect(() =>
      assertScriptCompletedWithoutFailures({
        scriptName: 'resync-private-bookings-calendar',
        failureCount: 2,
        failures: ['booking-1: update failed', 'booking-2: no event id']
      })
    ).toThrow(
      'resync-private-bookings-calendar completed with 2 failure(s): booking-1: update failed | booking-2: no event id'
    )
  })

  it('passes when script completes without failures', () => {
    expect(() =>
      assertScriptCompletedWithoutFailures({
        scriptName: 'resync-private-bookings-calendar',
        failureCount: 0
      })
    ).not.toThrow()
  })
})
