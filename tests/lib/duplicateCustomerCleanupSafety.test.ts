import { describe, expect, it } from 'vitest'

import {
  assertDuplicateCleanupCompletedWithoutFailures,
  assertDuplicateCleanupTargetsResolved
} from '@/lib/duplicate-customer-cleanup-safety'

describe('duplicate customer cleanup safety', () => {
  it('throws when requested cleanup target IDs are missing from fetched rows', () => {
    expect(() =>
      assertDuplicateCleanupTargetsResolved({
        requestedIds: ['customer-1', 'customer-2'],
        fetchedRows: [{ id: 'customer-1' }]
      })
    ).toThrow(
      'Duplicate cleanup target check failed: found 1/2 requested customer rows; missing IDs: customer-2'
    )
  })

  it('does not throw when all requested cleanup target IDs are present', () => {
    expect(() =>
      assertDuplicateCleanupTargetsResolved({
        requestedIds: ['customer-1', 'customer-2'],
        fetchedRows: [{ id: 'customer-1' }, { id: 'customer-2' }]
      })
    ).not.toThrow()
  })

  it('throws when cleanup run has deletion or audit failures', () => {
    expect(() =>
      assertDuplicateCleanupCompletedWithoutFailures([
        { customerId: 'customer-1', reason: 'delete_failed:permission denied' }
      ])
    ).toThrow(
      'delete-approved-duplicates completed with 1 failure(s): customer-1:delete_failed:permission denied'
    )
  })

  it('does not throw when cleanup run has no failures', () => {
    expect(() => assertDuplicateCleanupCompletedWithoutFailures([])).not.toThrow()
  })
})
