import { describe, expect, it } from 'vitest'
import {
  assertDeleteTestCustomersDirectCompletedWithoutFailures,
  assertDeleteTestCustomersDirectLimit,
  assertDeleteTestCustomersDirectMutationAllowed,
  assertDeleteTestCustomersDirectMutationSucceeded,
  assertDeleteTestCustomersDirectTargetMatches,
  isDeleteTestCustomersDirectMutationRunEnabled,
  readDeleteTestCustomersDirectLimit,
  resolveDeleteTestCustomersDirectRows
} from '@/lib/delete-test-customers-direct-safety'

describe('delete-test-customers-direct safety', () => {
  it('requires --confirm and RUN env to enable mutation mode', () => {
    const previous = process.env.RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION
    process.env.RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION = 'true'

    expect(isDeleteTestCustomersDirectMutationRunEnabled(['tsx', 'script.ts'])).toBe(false)
    expect(
      isDeleteTestCustomersDirectMutationRunEnabled(['tsx', 'script.ts', '--confirm'])
    ).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION
    } else {
      process.env.RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION = previous
    }
  })

  it('blocks mutation when allow env is missing', () => {
    const previous = process.env.ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION
    delete process.env.ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION

    expect(() => assertDeleteTestCustomersDirectMutationAllowed()).toThrow(
      'delete-test-customers-direct blocked by safety guard. Set ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION
    } else {
      process.env.ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION = previous
    }
  })

  it('reads optional limit from argv or env', () => {
    const previous = process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT

    expect(readDeleteTestCustomersDirectLimit(['tsx', 'script.ts'])).toBe(null)
    expect(readDeleteTestCustomersDirectLimit(['tsx', 'script.ts', '--limit', '12'])).toBe(12)
    expect(readDeleteTestCustomersDirectLimit(['tsx', 'script.ts', '--limit=7'])).toBe(7)

    process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT = '5'
    expect(readDeleteTestCustomersDirectLimit(['tsx', 'script.ts'])).toBe(5)

    process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT = 'not-a-number'
    expect(readDeleteTestCustomersDirectLimit(['tsx', 'script.ts'])).toBe(null)

    if (previous === undefined) {
      delete process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT
    } else {
      process.env.DELETE_TEST_CUSTOMERS_DIRECT_LIMIT = previous
    }
  })

  it('blocks limit that is missing, non-positive, or above hard cap', () => {
    expect(() => assertDeleteTestCustomersDirectLimit(0, 50)).toThrow(
      'delete-test-customers-direct blocked: limit must be a positive integer.'
    )
    expect(() => assertDeleteTestCustomersDirectLimit(-1, 50)).toThrow(
      'delete-test-customers-direct blocked: limit must be a positive integer.'
    )
    expect(() => assertDeleteTestCustomersDirectLimit(51, 50)).toThrow(
      'delete-test-customers-direct blocked: limit 51 exceeds hard cap 50. Run in smaller batches.'
    )
    expect(() => assertDeleteTestCustomersDirectLimit(50, 50)).not.toThrow()
  })

  it('fails closed when query errors', () => {
    expect(() =>
      resolveDeleteTestCustomersDirectRows({
        operation: 'Load customers matching test-name filters',
        rows: null,
        error: { message: 'customers lookup failed' }
      })
    ).toThrow('Load customers matching test-name filters failed: customers lookup failed')
  })

  it('fails closed when mutation row count mismatches expected', () => {
    expect(() =>
      assertDeleteTestCustomersDirectMutationSucceeded({
        operation: 'Delete customer customer-1',
        error: null,
        rows: [{ id: 'customer-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete customer customer-1 affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when mutation returns database error', () => {
    expect(() =>
      assertDeleteTestCustomersDirectMutationSucceeded({
        operation: 'Delete customer customer-1',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete customer customer-1 failed: delete failed')
  })

  it('blocks deletion when target row no longer matches test-name filter', () => {
    expect(() =>
      assertDeleteTestCustomersDirectTargetMatches({
        customerId: 'customer-1',
        firstName: 'Peter',
        lastName: 'Pitcher'
      })
    ).toThrow(
      'Refusing to delete customer customer-1 because target no longer matches expected "test" filter.'
    )
  })

  it('fails completion when unresolved failures remain', () => {
    expect(() =>
      assertDeleteTestCustomersDirectCompletedWithoutFailures({
        failureCount: 1,
        failures: ['Expected 0 remaining deleted test customers, found 2']
      })
    ).toThrow(
      'delete-test-customers-direct completed with 1 failure(s): Expected 0 remaining deleted test customers, found 2'
    )
  })
})
