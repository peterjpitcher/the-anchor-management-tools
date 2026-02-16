import { describe, expect, it } from 'vitest'
import {
  assertFixDuplicateLoyaltyProgramCompletedWithoutFailures,
  assertFixDuplicateLoyaltyProgramMutationAllowed,
  assertFixDuplicateLoyaltyProgramMutationSucceeded,
  isFixDuplicateLoyaltyProgramMutationRunEnabled,
  resolveFixDuplicateLoyaltyProgramCount,
  resolveFixDuplicateLoyaltyProgramRows
} from '@/lib/duplicate-loyalty-program-fix-safety'

describe('duplicate loyalty program fix safety', () => {
  it('resolves query rows and fails closed on query errors', () => {
    expect(() =>
      resolveFixDuplicateLoyaltyProgramRows({
        operation: 'Load loyalty programs',
        rows: null,
        error: { message: 'relation missing' }
      })
    ).toThrow('Load loyalty programs failed: relation missing')

    expect(
      resolveFixDuplicateLoyaltyProgramRows({
        operation: 'Load loyalty programs',
        rows: null,
        error: null
      })
    ).toEqual([])
  })

  it('resolves count and fails closed on count-query errors', () => {
    expect(() =>
      resolveFixDuplicateLoyaltyProgramCount({
        operation: 'Count loyalty members for duplicate program',
        count: null,
        error: { message: 'count query failed' }
      })
    ).toThrow('Count loyalty members for duplicate program failed: count query failed')

    expect(
      resolveFixDuplicateLoyaltyProgramCount({
        operation: 'Count loyalty members for duplicate program',
        count: null,
        error: null
      })
    ).toBe(0)
  })

  it('detects mutation run enablement from env flag', () => {
    const previous = process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION
    delete process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION
    expect(isFixDuplicateLoyaltyProgramMutationRunEnabled()).toBe(false)

    process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION = 'true'
    expect(isFixDuplicateLoyaltyProgramMutationRunEnabled()).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION
    } else {
      process.env.RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION = previous
    }
  })

  it('blocks mutation when explicit approval env var is missing', () => {
    const previous = process.env.ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION
    delete process.env.ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION

    expect(() => assertFixDuplicateLoyaltyProgramMutationAllowed()).toThrow(
      'fix-duplicate-loyalty-program blocked by safety guard. Set ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true to run this mutation script.'
    )

    process.env.ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION = 'true'
    expect(() => assertFixDuplicateLoyaltyProgramMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION
    } else {
      process.env.ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION = previous
    }
  })

  it('fails when mutation row count does not match expected count', () => {
    expect(() =>
      assertFixDuplicateLoyaltyProgramMutationSucceeded({
        operation: 'Migrate loyalty members',
        error: null,
        rows: [{ id: 'member-1' }],
        expectedCount: 2
      })
    ).toThrow('Migrate loyalty members affected unexpected row count (expected 2, got 1)')
  })

  it('fails when mutation query errors', () => {
    expect(() =>
      assertFixDuplicateLoyaltyProgramMutationSucceeded({
        operation: 'Delete duplicate loyalty program',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete duplicate loyalty program failed: delete failed')
  })

  it('fails closed when completion has recorded failures', () => {
    expect(() =>
      assertFixDuplicateLoyaltyProgramCompletedWithoutFailures({
        failureCount: 1,
        failures: ['Delete duplicate loyalty program affected unexpected row count (expected 1, got 0)']
      })
    ).toThrow(
      'fix-duplicate-loyalty-program completed with 1 failure(s): Delete duplicate loyalty program affected unexpected row count (expected 1, got 0)'
    )
  })
})
