import { describe, expect, it } from 'vitest'
import {
  assertDeleteApprovedDuplicatesLimit,
  assertDeleteApprovedDuplicatesMutationAllowed,
  isDeleteApprovedDuplicatesMutationEnabled,
  readDeleteApprovedDuplicatesLimit,
  readDeleteApprovedDuplicatesOffset
} from '@/lib/delete-approved-duplicates-script-safety'

describe('delete-approved-duplicates script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isDeleteApprovedDuplicatesMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(
      isDeleteApprovedDuplicatesMutationEnabled(['node', 'script', '--confirm'], {})
    ).toBe(false)
    expect(
      isDeleteApprovedDuplicatesMutationEnabled(['node', 'script', '--confirm'], {
        RUN_DELETE_APPROVED_DUPLICATES_MUTATION: 'true'
      })
    ).toBe(true)
    expect(
      isDeleteApprovedDuplicatesMutationEnabled(['node', 'script', '--confirm', '--dry-run'], {
        RUN_DELETE_APPROVED_DUPLICATES_MUTATION: 'true'
      })
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled (supports legacy allow)', () => {
    const prevLegacy = process.env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT
    const prevNew = process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT
    delete process.env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT
    delete process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT

    expect(() => assertDeleteApprovedDuplicatesMutationAllowed()).toThrow(
      'delete-approved-duplicates blocked by safety guard. Set ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT = 'true'
    expect(() => assertDeleteApprovedDuplicatesMutationAllowed()).not.toThrow()
    delete process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT

    process.env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT = 'true'
    expect(() => assertDeleteApprovedDuplicatesMutationAllowed()).not.toThrow()

    if (prevLegacy === undefined) {
      delete process.env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT
    } else {
      process.env.ALLOW_DELETE_APPROVED_DUPLICATES_SCRIPT = prevLegacy
    }

    if (prevNew === undefined) {
      delete process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT = prevNew
    }
  })

  it('reads limit/offset from argv or env', () => {
    expect(readDeleteApprovedDuplicatesLimit(['node', 'script', '--limit', '12'], {})).toBe(12)
    expect(readDeleteApprovedDuplicatesLimit(['node', 'script', '--limit=9'], {})).toBe(9)
    expect(readDeleteApprovedDuplicatesLimit(['node', 'script'], { DELETE_APPROVED_DUPLICATES_LIMIT: '7' })).toBe(7)

    expect(readDeleteApprovedDuplicatesOffset(['node', 'script', '--offset', '3'], {})).toBe(3)
    expect(readDeleteApprovedDuplicatesOffset(['node', 'script', '--offset=5'], {})).toBe(5)
    expect(readDeleteApprovedDuplicatesOffset(['node', 'script'], { DELETE_APPROVED_DUPLICATES_OFFSET: '11' })).toBe(11)
  })

  it('enforces a hard cap for limit', () => {
    expect(() => assertDeleteApprovedDuplicatesLimit(null, 50)).toThrow('--limit is required')
    expect(() => assertDeleteApprovedDuplicatesLimit(0, 50)).toThrow('--limit must be a positive integer')
    expect(() => assertDeleteApprovedDuplicatesLimit(51, 50)).toThrow('exceeds hard cap')
    expect(assertDeleteApprovedDuplicatesLimit(10, 50)).toBe(10)
  })
})

