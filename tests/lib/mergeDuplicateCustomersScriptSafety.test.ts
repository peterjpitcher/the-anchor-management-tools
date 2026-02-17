import { describe, expect, it } from 'vitest'
import {
  assertMergeDuplicateCustomersLimit,
  assertMergeDuplicateCustomersMutationAllowed,
  isMergeDuplicateCustomersMutationEnabled,
  readMergeDuplicateCustomersLimit,
  readMergeDuplicateCustomersOffset
} from '@/lib/merge-duplicate-customers-script-safety'

describe('merge-duplicate-customers script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isMergeDuplicateCustomersMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(
      isMergeDuplicateCustomersMutationEnabled(['node', 'script', '--confirm'], {})
    ).toBe(false)
    expect(
      isMergeDuplicateCustomersMutationEnabled(['node', 'script', '--confirm'], {
        RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION: 'true'
      })
    ).toBe(true)
    expect(
      isMergeDuplicateCustomersMutationEnabled(['node', 'script', '--confirm', '--dry-run'], {
        RUN_MERGE_DUPLICATE_CUSTOMERS_MUTATION: 'true'
      })
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled (supports legacy allow)', () => {
    const prevLegacy = process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_SCRIPT
    const prevNew = process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT
    delete process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_SCRIPT
    delete process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT

    expect(() => assertMergeDuplicateCustomersMutationAllowed()).toThrow(
      'merge-duplicate-customers blocked by safety guard. Set ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT = 'true'
    expect(() => assertMergeDuplicateCustomersMutationAllowed()).not.toThrow()
    delete process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT

    process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_SCRIPT = 'true'
    expect(() => assertMergeDuplicateCustomersMutationAllowed()).not.toThrow()

    if (prevLegacy === undefined) {
      delete process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_SCRIPT
    } else {
      process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_SCRIPT = prevLegacy
    }

    if (prevNew === undefined) {
      delete process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_MERGE_DUPLICATE_CUSTOMERS_MUTATION_SCRIPT = prevNew
    }
  })

  it('reads limit/offset from argv or env', () => {
    expect(readMergeDuplicateCustomersLimit(['node', 'script', '--limit', '12'], {})).toBe(12)
    expect(readMergeDuplicateCustomersLimit(['node', 'script', '--limit=9'], {})).toBe(9)
    expect(readMergeDuplicateCustomersLimit(['node', 'script'], { MERGE_DUPLICATE_CUSTOMERS_LIMIT: '7' })).toBe(7)

    expect(readMergeDuplicateCustomersOffset(['node', 'script', '--offset', '3'], {})).toBe(3)
    expect(readMergeDuplicateCustomersOffset(['node', 'script', '--offset=5'], {})).toBe(5)
    expect(readMergeDuplicateCustomersOffset(['node', 'script'], { MERGE_DUPLICATE_CUSTOMERS_OFFSET: '11' })).toBe(11)
  })

  it('enforces a hard cap for limit', () => {
    expect(() => assertMergeDuplicateCustomersLimit(null, 50)).toThrow('--limit is required')
    expect(() => assertMergeDuplicateCustomersLimit(0, 50)).toThrow('--limit must be a positive integer')
    expect(() => assertMergeDuplicateCustomersLimit(51, 50)).toThrow('exceeds hard cap')
    expect(assertMergeDuplicateCustomersLimit(10, 50)).toBe(10)
  })
})
