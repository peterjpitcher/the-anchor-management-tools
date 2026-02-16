import { describe, expect, it } from 'vitest'
import {
  buildBulkSmsDispatchKey,
  normalizeBulkRecipientIds,
  validateBulkSmsRecipientCount
} from '@/lib/sms/bulk-dispatch-key'

describe('bulk SMS dispatch key', () => {
  it('normalizes ids by removing duplicates and sorting', () => {
    expect(normalizeBulkRecipientIds(['b', 'a', 'b', '', 'a'])).toEqual(['a', 'b'])
  })

  it('is stable for the same logical recipient set', () => {
    const first = buildBulkSmsDispatchKey({
      customerIds: ['c3', 'c1', 'c2', 'c1'],
      message: 'Hello world',
      eventId: 'event-1',
      categoryId: 'cat-1'
    })

    const second = buildBulkSmsDispatchKey({
      customerIds: ['c2', 'c3', 'c1'],
      message: 'Hello world',
      eventId: 'event-1',
      categoryId: 'cat-1'
    })

    expect(first).toBe(second)
  })

  it('changes when payload semantics change', () => {
    const base = buildBulkSmsDispatchKey({
      customerIds: ['c1', 'c2'],
      message: 'Hello world',
      eventId: 'event-1'
    })

    const differentMessage = buildBulkSmsDispatchKey({
      customerIds: ['c1', 'c2'],
      message: 'Different body',
      eventId: 'event-1'
    })

    const differentBatch = buildBulkSmsDispatchKey({
      customerIds: ['c1', 'c2'],
      message: 'Hello world',
      eventId: 'event-1',
      batchIndex: 1
    })

    expect(base).not.toBe(differentMessage)
    expect(base).not.toBe(differentBatch)
  })

  it('enforces configured recipient caps', () => {
    const previousLimit = process.env.BULK_SMS_MAX_RECIPIENTS
    process.env.BULK_SMS_MAX_RECIPIENTS = '2'
    try {
      expect(validateBulkSmsRecipientCount(2)).toBeNull()
      expect(validateBulkSmsRecipientCount(3)).toBe(
        'Bulk SMS recipient limit exceeded (3/2). Split this send into smaller batches.'
      )
    } finally {
      if (previousLimit === undefined) {
        delete process.env.BULK_SMS_MAX_RECIPIENTS
      } else {
        process.env.BULK_SMS_MAX_RECIPIENTS = previousLimit
      }
    }
  })
})
