import { describe, expect, it } from 'vitest'
import {
  assertDeleteAllQueuedMessagesMutationAllowed,
  assertQueuedMessagesCleanupAuditPersisted,
  assertQueuedMessagesCleanupDeleteSucceeded,
  resolveQueuedMessagesCleanupRows
} from '@/lib/queued-messages-cleanup-safety'

describe('queued messages cleanup safety', () => {
  it('blocks mutation execution unless explicit guard env var is enabled', () => {
    const previous = process.env.ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT
    delete process.env.ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT

    expect(() => assertDeleteAllQueuedMessagesMutationAllowed()).toThrow(
      'delete-all-queued-messages blocked by safety guard. Set ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT = 'true'
    expect(() => assertDeleteAllQueuedMessagesMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT
    } else {
      process.env.ALLOW_DELETE_ALL_QUEUED_MESSAGES_SCRIPT = previous
    }
  })

  it('throws when queued message query fails', () => {
    expect(() =>
      resolveQueuedMessagesCleanupRows({
        operation: 'Load queued outbound messages',
        rows: null,
        error: { message: 'messages query timed out' }
      })
    ).toThrow('Load queued outbound messages failed: messages query timed out')
  })

  it('returns an empty array when query result is null without error', () => {
    const rows = resolveQueuedMessagesCleanupRows({
      operation: 'Load queued outbound messages',
      rows: null,
      error: null
    })

    expect(rows).toEqual([])
  })

  it('throws when delete mutation affects fewer rows than expected', () => {
    expect(() =>
      assertQueuedMessagesCleanupDeleteSucceeded({
        operation: 'Delete queued outbound messages',
        error: null,
        deletedRows: [{ id: 'msg-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete queued outbound messages affected unexpected row count (expected 2, got 1)')
  })

  it('throws when delete mutation returns a database error', () => {
    expect(() =>
      assertQueuedMessagesCleanupDeleteSucceeded({
        operation: 'Delete queued outbound messages',
        error: { message: 'delete permission denied' },
        deletedRows: null,
        expectedCount: 1
      })
    ).toThrow('Delete queued outbound messages failed: delete permission denied')
  })

  it('throws when audit-log insert does not persist exactly one row', () => {
    expect(() =>
      assertQueuedMessagesCleanupAuditPersisted({
        error: null,
        insertedRows: []
      })
    ).toThrow('Insert queued-message cleanup audit log affected no rows')
  })
})
