import { describe, expect, it } from 'vitest'
import {
  assertDeletePendingSmsAuditPersisted,
  assertDeletePendingSmsMutationAllowed,
  assertDeletePendingSmsUpdateSucceeded,
  resolvePendingSmsJobsForDelete
} from '@/lib/pending-sms-delete-safety'

describe('pending SMS delete safety', () => {
  it('blocks mutation execution unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_DELETE_PENDING_SMS_SCRIPT
    delete process.env.ALLOW_DELETE_PENDING_SMS_SCRIPT

    expect(() => assertDeletePendingSmsMutationAllowed()).toThrow(
      'delete-pending-sms blocked by safety guard. Set ALLOW_DELETE_PENDING_SMS_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_DELETE_PENDING_SMS_SCRIPT = 'true'
    expect(() => assertDeletePendingSmsMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_PENDING_SMS_SCRIPT
    } else {
      process.env.ALLOW_DELETE_PENDING_SMS_SCRIPT = previous
    }
  })

  it('throws when pending job query fails', () => {
    expect(() =>
      resolvePendingSmsJobsForDelete({
        jobs: null,
        error: { message: 'jobs lookup failed' }
      })
    ).toThrow('Load pending SMS jobs failed: jobs lookup failed')
  })

  it('returns an empty array when query result is null without error', () => {
    const jobs = resolvePendingSmsJobsForDelete({
      jobs: null,
      error: null
    })

    expect(jobs).toEqual([])
  })

  it('throws when cancellation update affects fewer rows than expected', () => {
    expect(() =>
      assertDeletePendingSmsUpdateSucceeded({
        error: null,
        updatedRows: [{ id: 'job-1' }],
        expectedCount: 2
      })
    ).toThrow('Cancel pending SMS jobs affected unexpected row count (expected 2, got 1)')
  })

  it('throws when cancellation update returns a database error', () => {
    expect(() =>
      assertDeletePendingSmsUpdateSucceeded({
        error: { message: 'jobs update denied' },
        updatedRows: null,
        expectedCount: 1
      })
    ).toThrow('Cancel pending SMS jobs failed: jobs update denied')
  })

  it('throws when audit-log insert does not persist exactly one row', () => {
    expect(() =>
      assertDeletePendingSmsAuditPersisted({
        error: null,
        insertedRows: []
      })
    ).toThrow('Cancel pending SMS jobs affected no rows')
  })
})
