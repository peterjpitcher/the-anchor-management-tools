import { describe, expect, it } from 'vitest'
import {
  assertJobRetryMutationAllowed,
  assertJobRetryMutationSucceeded,
  assertJobRetrySendTypesAllowed,
  isJobRetryMutationRunEnabled,
  resolveJobRetryLimit,
  resolveJobRetryRows
} from '@/lib/job-retry-script-safety'

describe('job retry script safety', () => {
  it('requires --confirm and RUN_JOB_RETRY_MUTATION_SCRIPT=true for mutation mode', () => {
    const previousRunEnv = process.env.RUN_JOB_RETRY_MUTATION_SCRIPT
    process.env.RUN_JOB_RETRY_MUTATION_SCRIPT = 'true'

    expect(isJobRetryMutationRunEnabled(['node', 'scripts/reset-jobs.ts'])).toBe(false)
    expect(
      isJobRetryMutationRunEnabled(['node', 'scripts/reset-jobs.ts', '--confirm'])
    ).toBe(true)
    expect(
      isJobRetryMutationRunEnabled(['node', 'scripts/reset-jobs.ts', '--confirm', '--dry-run'])
    ).toBe(false)

    if (previousRunEnv === undefined) {
      delete process.env.RUN_JOB_RETRY_MUTATION_SCRIPT
    } else {
      process.env.RUN_JOB_RETRY_MUTATION_SCRIPT = previousRunEnv
    }
  })

  it('blocks mutation when ALLOW_JOB_RETRY_MUTATION_SCRIPT is missing', () => {
    const previousAllowEnv = process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT
    delete process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT

    expect(() => assertJobRetryMutationAllowed('reset-jobs')).toThrow(
      'reset-jobs blocked by safety guard. Set ALLOW_JOB_RETRY_MUTATION_SCRIPT=true to run this mutation script.'
    )

    if (previousAllowEnv === undefined) {
      delete process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_JOB_RETRY_MUTATION_SCRIPT = previousAllowEnv
    }
  })

  it('parses --limit and enforces hard cap', () => {
    expect(resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts'])).toBeNull()
    expect(resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit', '10'])).toBe(10)
    expect(resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit=10'])).toBe(10)

    expect(() => resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit', '0'])).toThrow(
      'Invalid --limit: 0'
    )
    expect(() => resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit', 'abc'])).toThrow(
      'Invalid --limit: abc'
    )
    expect(() => resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit', '1abc'])).toThrow(
      'Invalid --limit: 1abc'
    )
    expect(() => resolveJobRetryLimit(['node', 'scripts/reset-jobs.ts', '--limit', '501'])).toThrow(
      '--limit exceeds hard cap (max 500)'
    )
  })

  it('blocks send-type job selection when ALLOW_JOB_RETRY_SEND_TYPES is missing', () => {
    const previous = process.env.ALLOW_JOB_RETRY_SEND_TYPES
    delete process.env.ALLOW_JOB_RETRY_SEND_TYPES

    expect(() =>
      assertJobRetrySendTypesAllowed('reset-jobs', [
        { id: 'job-1', type: 'send_sms' },
        { id: 'job-2', type: 'cleanup_old_messages' },
      ])
    ).toThrow(
      'reset-jobs blocked by send-job safety guard. Selected send jobs detected (1; send_sms:job-1). Set ALLOW_JOB_RETRY_SEND_TYPES=true to include send jobs.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_JOB_RETRY_SEND_TYPES
    } else {
      process.env.ALLOW_JOB_RETRY_SEND_TYPES = previous
    }
  })

  it('allows send-type job selection when ALLOW_JOB_RETRY_SEND_TYPES is enabled', () => {
    const previous = process.env.ALLOW_JOB_RETRY_SEND_TYPES
    process.env.ALLOW_JOB_RETRY_SEND_TYPES = 'true'

    expect(() =>
      assertJobRetrySendTypesAllowed('reset-jobs', [{ id: 'job-1', type: 'send_bulk_sms' }])
    ).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_JOB_RETRY_SEND_TYPES
    } else {
      process.env.ALLOW_JOB_RETRY_SEND_TYPES = previous
    }
  })

  it('fails closed when preflight query fails', () => {
    expect(() =>
      resolveJobRetryRows({
        operation: 'Load pending jobs for reset-jobs',
        rows: null,
        error: { message: 'jobs table unavailable' }
      })
    ).toThrow('Load pending jobs for reset-jobs failed: jobs table unavailable')
  })

  it('fails closed when update row count is lower than expected', () => {
    expect(() =>
      assertJobRetryMutationSucceeded({
        operation: 'Reschedule pending jobs',
        error: null,
        updatedRows: [{ id: 'job-1' }],
        expectedCount: 2
      })
    ).toThrow('Reschedule pending jobs affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when update row count is higher than expected', () => {
    expect(() =>
      assertJobRetryMutationSucceeded({
        operation: 'Retry failed parse_cv jobs',
        error: null,
        updatedRows: [{ id: 'job-1' }, { id: 'job-2' }],
        expectedCount: 1
      })
    ).toThrow('Retry failed parse_cv jobs affected unexpected row count (expected 1, got 2)')
  })

  it('fails closed when update query errors', () => {
    expect(() =>
      assertJobRetryMutationSucceeded({
        operation: 'Retry failed parse_cv jobs',
        error: { message: 'permission denied' },
        updatedRows: null,
        expectedCount: 1
      })
    ).toThrow('Retry failed parse_cv jobs failed: permission denied')
  })
})
