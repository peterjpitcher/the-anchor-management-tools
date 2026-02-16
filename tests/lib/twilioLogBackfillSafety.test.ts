import { describe, expect, it } from 'vitest'
import {
  assertTwilioLogBackfillLookupSafe,
  assertTwilioLogBackfillBatchInsertComplete,
  assertTwilioLogBackfillCompletedWithoutUnresolvedRows,
  isTwilioLogBackfillDuplicateKeyError,
} from '@/lib/twilio-log-backfill-safety'

describe('twilio log backfill safety', () => {
  it('throws when customer lookup fails', () => {
    expect(() =>
      assertTwilioLogBackfillLookupSafe({
        phone: '+447700900123',
        error: { message: 'customers read failed' }
      })
    ).toThrow('Failed to look up customer by phone +447700900123: customers read failed')
  })

  it('does not throw when customer lookup succeeds', () => {
    expect(() =>
      assertTwilioLogBackfillLookupSafe({
        phone: '+447700900123',
        error: null
      })
    ).not.toThrow()
  })

  it('identifies duplicate-key insert errors', () => {
    expect(isTwilioLogBackfillDuplicateKeyError({ code: '23505' })).toBe(true)
    expect(isTwilioLogBackfillDuplicateKeyError({ code: '22023' })).toBe(false)
    expect(isTwilioLogBackfillDuplicateKeyError(null)).toBe(false)
  })

  it('throws when batch insert count does not match expected rows', () => {
    expect(() =>
      assertTwilioLogBackfillBatchInsertComplete({
        expectedRows: 3,
        insertedRows: [{ id: 'msg-1' }, { id: 'msg-2' }]
      })
    ).toThrow('Twilio log backfill batch insert affected unexpected row count (expected 3, got 2)')
  })

  it('returns inserted count when batch insert count matches', () => {
    const result = assertTwilioLogBackfillBatchInsertComplete({
      expectedRows: 2,
      insertedRows: [{ id: 'msg-1' }, { id: 'msg-2' }]
    })

    expect(result).toEqual({ insertedCount: 2 })
  })

  it('throws when unresolved rows remain after backfill processing', () => {
    expect(() =>
      assertTwilioLogBackfillCompletedWithoutUnresolvedRows({
        unresolvedRows: [
          { sid: 'SM1', reason: 'customer_unresolved' },
          { sid: 'SM2', reason: 'customer_unresolved' }
        ]
      })
    ).toThrow(
      'Twilio log backfill completed with 2 unresolved row(s): SM1:customer_unresolved | SM2:customer_unresolved'
    )
  })

  it('does not throw when all rows are fully resolved', () => {
    expect(() =>
      assertTwilioLogBackfillCompletedWithoutUnresolvedRows({
        unresolvedRows: []
      })
    ).not.toThrow()
  })
})
