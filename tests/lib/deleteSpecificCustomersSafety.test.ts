import { describe, expect, it } from 'vitest'
import {
  assertDeleteSpecificCustomersCompletedWithoutFailures,
  assertDeleteSpecificCustomersMutationAllowed,
  assertDeleteSpecificCustomersMutationSucceeded,
  assertDeleteSpecificCustomersTargetsResolved,
  isDeleteSpecificCustomersMutationRunEnabled,
  resolveDeleteSpecificCustomersRows
} from '@/lib/delete-specific-customers-safety'

describe('delete-specific-customers safety', () => {
  it('detects mutation run mode from env', () => {
    const previous = process.env.RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION
    process.env.RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION = 'true'

    expect(isDeleteSpecificCustomersMutationRunEnabled()).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION
    } else {
      process.env.RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION = previous
    }
  })

  it('blocks mutation when allow env is missing', () => {
    const previous = process.env.ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION
    delete process.env.ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION

    expect(() => assertDeleteSpecificCustomersMutationAllowed()).toThrow(
      'delete-specific-customers blocked by safety guard. Set ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION
    } else {
      process.env.ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION = previous
    }
  })

  it('throws when requested target IDs are missing from fetched rows', () => {
    expect(() =>
      assertDeleteSpecificCustomersTargetsResolved({
        requestedIds: ['customer-1', 'customer-2'],
        fetchedRows: [{ id: 'customer-1' }]
      })
    ).toThrow(
      'delete-specific-customers target check failed: found 1/2 requested customer rows; missing IDs: customer-2'
    )
  })

  it('fails closed when query fails', () => {
    expect(() =>
      resolveDeleteSpecificCustomersRows({
        operation: 'Load targeted customers',
        rows: null,
        error: { message: 'customers lookup failed' }
      })
    ).toThrow('Load targeted customers failed: customers lookup failed')
  })

  it('fails closed when mutation row count mismatches expected', () => {
    expect(() =>
      assertDeleteSpecificCustomersMutationSucceeded({
        operation: 'Delete customer customer-1',
        error: null,
        rows: [{ id: 'customer-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete customer customer-1 affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when mutation returns a database error', () => {
    expect(() =>
      assertDeleteSpecificCustomersMutationSucceeded({
        operation: 'Delete customer customer-1',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete customer customer-1 failed: delete failed')
  })

  it('throws when cleanup run has unresolved failures', () => {
    expect(() =>
      assertDeleteSpecificCustomersCompletedWithoutFailures([
        { customerId: 'customer-1', reason: 'audit_failed:permission denied' }
      ])
    ).toThrow(
      'delete-specific-customers completed with 1 failure(s): customer-1:audit_failed:permission denied'
    )
  })
})
