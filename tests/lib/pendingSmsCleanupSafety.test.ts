import { describe, expect, it } from 'vitest'
import {
  assertDeleteAllPendingSmsCompletedWithoutFailures,
  assertDeleteAllPendingSmsMutationAllowed,
  assertDeleteAllPendingSmsUpdateSucceeded,
  resolveDeleteAllPendingSmsCount
} from '@/lib/pending-sms-cleanup-safety'

describe('pending SMS cleanup safety', () => {
  it('blocks mutation execution unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT
    delete process.env.ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT

    expect(() => assertDeleteAllPendingSmsMutationAllowed()).toThrow(
      'delete-all-pending-sms blocked by safety guard. Set ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT = 'true'
    expect(() => assertDeleteAllPendingSmsMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT
    } else {
      process.env.ALLOW_DELETE_ALL_PENDING_SMS_SCRIPT = previous
    }
  })

  it('throws when pending job count query fails', () => {
    expect(() =>
      resolveDeleteAllPendingSmsCount({
        count: null,
        error: { message: 'jobs count lookup unavailable' }
      })
    ).toThrow('Load pending SMS job count failed: jobs count lookup unavailable')
  })

  it('returns zero when pending job count is null', () => {
    const count = resolveDeleteAllPendingSmsCount({
      count: null,
      error: null
    })

    expect(count).toBe(0)
  })

  it('throws when cancellation mutation affects fewer rows than expected', () => {
    expect(() =>
      assertDeleteAllPendingSmsUpdateSucceeded({
        error: null,
        updatedRows: [{ id: 'job-1' }],
        expectedCount: 2
      })
    ).toThrow('Cancel pending SMS jobs affected unexpected row count (expected 2, got 1)')
  })

  it('throws when cancellation mutation returns a database error', () => {
    expect(() =>
      assertDeleteAllPendingSmsUpdateSucceeded({
        error: { message: 'jobs update timeout' },
        updatedRows: null,
        expectedCount: 1
      })
    ).toThrow('Cancel pending SMS jobs failed: jobs update timeout')
  })

  it('throws when script completion has recorded failures', () => {
    expect(() =>
      assertDeleteAllPendingSmsCompletedWithoutFailures({
        failureCount: 1,
        failures: ['audit_log_insert_failed:permission denied']
      })
    ).toThrow(
      'delete-all-pending-sms completed with 1 failure(s): audit_log_insert_failed:permission denied'
    )
  })
})
