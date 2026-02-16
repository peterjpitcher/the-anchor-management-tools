import { describe, expect, it } from 'vitest'
import {
  assertOldSmsCleanupCompletedWithoutFailures,
  assertOldSmsCleanupDeletionSucceeded,
  assertOldSmsCleanupMutationAllowed,
  assertOldSmsCleanupQuerySucceeded,
  selectOldStuckSmsMessages
} from '@/lib/old-sms-cleanup-safety'

describe('old SMS cleanup safety', () => {
  it('blocks mutation execution unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT
    delete process.env.ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT

    expect(() => assertOldSmsCleanupMutationAllowed()).toThrow(
      'delete-old-sms-messages blocked by safety guard. Set ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT = 'true'
    expect(() => assertOldSmsCleanupMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT
    } else {
      process.env.ALLOW_DELETE_OLD_SMS_MESSAGES_SCRIPT = previous
    }
  })

  it('selects only messages older than the configured stale age threshold', () => {
    const nowMs = Date.parse('2026-02-14T00:00:00.000Z')
    const selected = selectOldStuckSmsMessages({
      nowMs,
      messages: [
        { id: 'msg-old', created_at: '2026-02-01T00:00:00.000Z' },
        { id: 'msg-recent', created_at: '2026-02-10T00:00:00.000Z' },
        { id: 'msg-invalid', created_at: 'not-a-date' }
      ]
    })

    expect(selected.map((message) => message.id)).toEqual(['msg-old'])
  })

  it('fails when deletion mutation affects fewer rows than expected', () => {
    expect(() =>
      assertOldSmsCleanupDeletionSucceeded({
        operation: 'Delete stale stuck outbound SMS messages',
        error: null,
        deletedRows: [{ id: 'msg-1' }],
        expectedCount: 2
      })
    ).toThrow(
      'Delete stale stuck outbound SMS messages affected unexpected row count (expected 2, got 1)'
    )
  })

  it('fails when deletion mutation returns a database error', () => {
    expect(() =>
      assertOldSmsCleanupDeletionSucceeded({
        operation: 'Delete stale SMS jobs',
        error: { message: 'jobs delete timeout' },
        deletedRows: null,
        expectedCount: 3
      })
    ).toThrow('Delete stale SMS jobs failed: jobs delete timeout')
  })

  it('fails when required cleanup query returns an error', () => {
    expect(() =>
      assertOldSmsCleanupQuerySucceeded({
        operation: 'Load stale SMS jobs for cleanup',
        error: { message: 'jobs lookup unavailable' },
        data: null
      })
    ).toThrow('Load stale SMS jobs for cleanup failed: jobs lookup unavailable')
  })

  it('fails when script completion has recorded failures', () => {
    expect(() =>
      assertOldSmsCleanupCompletedWithoutFailures({
        failureCount: 1,
        failures: ['audit_log_insert_failed:permission denied']
      })
    ).toThrow(
      'delete-old-sms-messages completed with 1 failure(s): audit_log_insert_failed:permission denied'
    )
  })
})
