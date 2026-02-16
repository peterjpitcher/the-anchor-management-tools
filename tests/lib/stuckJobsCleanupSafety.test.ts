import { describe, expect, it } from 'vitest'
import {
  assertNoInvalidStuckJobTimings,
  selectStaleProcessingJobIds
} from '@/lib/stuck-jobs-cleanup-safety'

describe('stuck jobs cleanup safety', () => {
  const nowMs = Date.parse('2026-02-14T12:00:00.000Z')

  it('selects only jobs beyond the stale runtime threshold', () => {
    const result = selectStaleProcessingJobIds({
      nowMs,
      jobs: [
        {
          id: 'job-stale',
          started_at: new Date(nowMs - 61_000).toISOString(),
          created_at: new Date(nowMs - 120_000).toISOString()
        },
        {
          id: 'job-fresh',
          started_at: new Date(nowMs - 30_000).toISOString(),
          created_at: new Date(nowMs - 90_000).toISOString()
        }
      ]
    })

    expect(result).toEqual({
      staleJobIds: ['job-stale'],
      invalidTimingJobIds: []
    })
  })

  it('falls back to created_at when started_at is missing', () => {
    const result = selectStaleProcessingJobIds({
      nowMs,
      jobs: [
        {
          id: 'job-created-at-stale',
          started_at: null,
          created_at: new Date(nowMs - 65_000).toISOString()
        }
      ]
    })

    expect(result.staleJobIds).toEqual(['job-created-at-stale'])
    expect(result.invalidTimingJobIds).toEqual([])
  })

  it('returns invalid timing ids when timestamps cannot be parsed', () => {
    const result = selectStaleProcessingJobIds({
      nowMs,
      jobs: [
        {
          id: 'job-invalid',
          started_at: 'not-a-date',
          created_at: null
        }
      ]
    })

    expect(result.staleJobIds).toEqual([])
    expect(result.invalidTimingJobIds).toEqual(['job-invalid'])
  })

  it('fails closed when invalid timing rows are present', () => {
    expect(() => assertNoInvalidStuckJobTimings(['job-invalid', 'job-missing'])).toThrow(
      'Cannot safely evaluate processing jobs because 2 row(s) have invalid started_at/created_at values: job-invalid, job-missing'
    )

    expect(() => assertNoInvalidStuckJobTimings([])).not.toThrow()
  })
})
