import { describe, expect, it } from 'vitest'
import {
  assertClearStuckJobsMutationAllowed,
  assertClearStuckJobsPendingSmsJobLimit,
  assertClearStuckJobsRunEnabled,
  assertClearStuckJobsStaleLimit,
  readClearStuckJobsPendingSmsJobLimit,
  readClearStuckJobsStaleLimit,
  resolveClearStuckJobsOperations
} from '@/lib/clear-stuck-jobs-script-safety'

describe('clear stuck jobs script safety', () => {
  it('blocks run when RUN_CLEAR_STUCK_JOBS_MUTATION is missing', () => {
    const previous = process.env.RUN_CLEAR_STUCK_JOBS_MUTATION
    delete process.env.RUN_CLEAR_STUCK_JOBS_MUTATION

    expect(() => assertClearStuckJobsRunEnabled()).toThrow(
      'clear-stuck-jobs is in read-only mode. Set RUN_CLEAR_STUCK_JOBS_MUTATION=true and ALLOW_CLEAR_STUCK_JOBS_MUTATION=true to run mutations.'
    )

    if (previous === undefined) {
      delete process.env.RUN_CLEAR_STUCK_JOBS_MUTATION
    } else {
      process.env.RUN_CLEAR_STUCK_JOBS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env vars are missing', () => {
    const previousAllow = process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    const previousLegacy = process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT
    delete process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    delete process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT

    expect(() => assertClearStuckJobsMutationAllowed()).toThrow(
      'clear-stuck-jobs blocked by safety guard. Set ALLOW_CLEAR_STUCK_JOBS_MUTATION=true to run this mutation script.'
    )

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    } else {
      process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT
    } else {
      process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT = previousLegacy
    }
  })

  it('allows mutation when legacy allow flag is set', () => {
    const previousAllow = process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    const previousLegacy = process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT
    delete process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT = 'true'

    expect(() => assertClearStuckJobsMutationAllowed()).not.toThrow()

    if (previousAllow === undefined) {
      delete process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION
    } else {
      process.env.ALLOW_CLEAR_STUCK_JOBS_MUTATION = previousAllow
    }

    if (previousLegacy === undefined) {
      delete process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT
    } else {
      process.env.ALLOW_CLEAR_STUCK_SMS_JOBS_SCRIPT = previousLegacy
    }
  })

  it('defaults to scanning both categories in dry-run mode', () => {
    expect(resolveClearStuckJobsOperations(['node', 'script'])).toEqual({
      failStaleProcessing: true,
      deletePendingSmsJobs: true
    })
  })

  it('requires explicit mutation operations when confirmed', () => {
    expect(() => resolveClearStuckJobsOperations(['node', 'script', '--confirm'])).toThrow(
      'clear-stuck-jobs blocked: choose at least one mutation operation (--fail-stale-processing and/or --delete-pending-sms-jobs).'
    )
  })

  it('resolves requested mutation operations when confirmed', () => {
    expect(
      resolveClearStuckJobsOperations(['node', 'script', '--confirm', '--fail-stale-processing'])
    ).toEqual({
      failStaleProcessing: true,
      deletePendingSmsJobs: false
    })

    expect(
      resolveClearStuckJobsOperations(['node', 'script', '--confirm', '--delete-pending-sms-jobs'])
    ).toEqual({
      failStaleProcessing: false,
      deletePendingSmsJobs: true
    })

    expect(
      resolveClearStuckJobsOperations([
        'node',
        'script',
        '--confirm',
        '--fail-stale-processing',
        '--delete-pending-sms-jobs'
      ])
    ).toEqual({
      failStaleProcessing: true,
      deletePendingSmsJobs: true
    })
  })

  it('reads stale and pending limits from argv and env', () => {
    const prevStale = process.env.CLEAR_STUCK_JOBS_STALE_LIMIT
    const prevPending = process.env.CLEAR_STUCK_JOBS_PENDING_LIMIT

    expect(readClearStuckJobsStaleLimit(['node', 'script', '--stale-limit=12'])).toBe(12)
    expect(readClearStuckJobsStaleLimit(['node', 'script', '--stale-limit', '13'])).toBe(13)
    expect(readClearStuckJobsStaleLimit(['node', 'script', '--stale-limit', '0'])).toBeNull()

    expect(readClearStuckJobsPendingSmsJobLimit(['node', 'script', '--pending-limit=17'])).toBe(17)
    expect(readClearStuckJobsPendingSmsJobLimit(['node', 'script', '--pending-limit', '18'])).toBe(18)
    expect(readClearStuckJobsPendingSmsJobLimit(['node', 'script', '--pending-limit', 'abc'])).toBeNull()

    process.env.CLEAR_STUCK_JOBS_STALE_LIMIT = '21'
    process.env.CLEAR_STUCK_JOBS_PENDING_LIMIT = '22'
    expect(readClearStuckJobsStaleLimit(['node', 'script'])).toBe(21)
    expect(readClearStuckJobsPendingSmsJobLimit(['node', 'script'])).toBe(22)

    if (prevStale === undefined) {
      delete process.env.CLEAR_STUCK_JOBS_STALE_LIMIT
    } else {
      process.env.CLEAR_STUCK_JOBS_STALE_LIMIT = prevStale
    }

    if (prevPending === undefined) {
      delete process.env.CLEAR_STUCK_JOBS_PENDING_LIMIT
    } else {
      process.env.CLEAR_STUCK_JOBS_PENDING_LIMIT = prevPending
    }
  })

  it('enforces explicit capped limits for stale and pending mutations', () => {
    expect(() => assertClearStuckJobsStaleLimit(0, 500)).toThrow(
      'clear-stuck-jobs blocked: stale limit must be a positive integer.'
    )
    expect(() => assertClearStuckJobsStaleLimit(501, 500)).toThrow(
      'clear-stuck-jobs blocked: stale limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertClearStuckJobsStaleLimit(10, 500)).not.toThrow()

    expect(() => assertClearStuckJobsPendingSmsJobLimit(0, 500)).toThrow(
      'clear-stuck-jobs blocked: pending limit must be a positive integer.'
    )
    expect(() => assertClearStuckJobsPendingSmsJobLimit(501, 500)).toThrow(
      'clear-stuck-jobs blocked: pending limit 501 exceeds hard cap 500. Run in smaller batches.'
    )
    expect(() => assertClearStuckJobsPendingSmsJobLimit(10, 500)).not.toThrow()
  })
})

