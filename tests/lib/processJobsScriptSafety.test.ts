import { describe, expect, it } from 'vitest'
import {
  assertProcessJobsMutationAllowed,
  assertProcessJobsRunEnabled,
  assertProcessJobsSendTypesAllowed,
  resolveProcessJobsBatchSize,
  resolveProcessJobsPendingRows
} from '@/lib/process-jobs-script-safety'

describe('process jobs script safety', () => {
  it('blocks run when RUN_PROCESS_JOBS_MUTATION is missing', () => {
    const previous = process.env.RUN_PROCESS_JOBS_MUTATION
    delete process.env.RUN_PROCESS_JOBS_MUTATION

    expect(() => assertProcessJobsRunEnabled()).toThrow(
      'process-jobs is in read-only mode. Set RUN_PROCESS_JOBS_MUTATION=true and ALLOW_PROCESS_JOBS_MUTATION=true to process jobs.'
    )

    if (previous === undefined) {
      delete process.env.RUN_PROCESS_JOBS_MUTATION
    } else {
      process.env.RUN_PROCESS_JOBS_MUTATION = previous
    }
  })

  it('blocks mutation when ALLOW_PROCESS_JOBS_MUTATION is missing', () => {
    const previous = process.env.ALLOW_PROCESS_JOBS_MUTATION
    delete process.env.ALLOW_PROCESS_JOBS_MUTATION

    expect(() => assertProcessJobsMutationAllowed()).toThrow(
      'process-jobs blocked by safety guard. Set ALLOW_PROCESS_JOBS_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_PROCESS_JOBS_MUTATION
    } else {
      process.env.ALLOW_PROCESS_JOBS_MUTATION = previous
    }
  })

  it('defaults batch size to 5 when value is missing', () => {
    expect(resolveProcessJobsBatchSize(undefined)).toBe(5)
  })

  it('throws when batch size is invalid', () => {
    expect(() => resolveProcessJobsBatchSize('0')).toThrow(
      'Invalid process-jobs batch size "0". Provide an integer between 1 and 100.'
    )
    expect(() => resolveProcessJobsBatchSize('abc')).toThrow(
      'Invalid process-jobs batch size "abc". Provide an integer between 1 and 100.'
    )
    expect(() => resolveProcessJobsBatchSize('1abc')).toThrow(
      'Invalid process-jobs batch size "1abc". Provide an integer between 1 and 100.'
    )
  })

  it('throws when preflight query fails', () => {
    expect(() =>
      resolveProcessJobsPendingRows({
        operation: 'Load pending jobs for process-jobs preflight',
        rows: null,
        error: { message: 'jobs table unavailable' }
      })
    ).toThrow('Load pending jobs for process-jobs preflight failed: jobs table unavailable')
  })

  it('blocks send-type processing when override env is missing', () => {
    const previous = process.env.ALLOW_PROCESS_JOBS_SEND_TYPES
    delete process.env.ALLOW_PROCESS_JOBS_SEND_TYPES

    expect(() =>
      assertProcessJobsSendTypesAllowed([
        { id: 'job-1', type: 'send_sms' },
        { id: 'job-2', type: 'cleanup_old_messages' }
      ])
    ).toThrow(
      'process-jobs blocked by send-job safety guard. Pending send jobs detected (1; send_sms:job-1). Set ALLOW_PROCESS_JOBS_SEND_TYPES=true to process send jobs.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_PROCESS_JOBS_SEND_TYPES
    } else {
      process.env.ALLOW_PROCESS_JOBS_SEND_TYPES = previous
    }
  })

  it('allows send-type processing when override env is enabled', () => {
    const previous = process.env.ALLOW_PROCESS_JOBS_SEND_TYPES
    process.env.ALLOW_PROCESS_JOBS_SEND_TYPES = 'true'

    expect(() =>
      assertProcessJobsSendTypesAllowed([{ id: 'job-1', type: 'send_bulk_sms' }])
    ).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_PROCESS_JOBS_SEND_TYPES
    } else {
      process.env.ALLOW_PROCESS_JOBS_SEND_TYPES = previous
    }
  })
})
