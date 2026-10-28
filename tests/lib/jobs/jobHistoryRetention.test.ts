import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FINISHED_JOB_STATUSES,
  jobHistoryCutoffIso,
  resolveJobHistoryRetentionMode,
  runJobHistoryRetention,
} from '@/lib/jobs/job-history-retention'

/**
 * Finished background jobs are kept for 90 days (BK-214, owner decision D36), and the job ships as
 * a dry run that only counts until JOB_HISTORY_RETENTION is 'delete'.
 */

type Call = { op: string; args: unknown[] }

/** A stand-in for the jobs table: records each chained call and answers the terminal one. */
function fakeJobsClient(options: {
  due: number
  pages?: string[][]
  countError?: { message: string } | null
  deleteError?: { message: string } | null
}) {
  const reads: Call[][] = []
  const deletes: Call[][] = []
  const counts: Call[][] = []
  const pages = [...(options.pages ?? [])]

  const from = vi.fn((table: string) => {
    if (table !== 'jobs') throw new Error(`Unexpected table: ${table}`)
    const calls: Call[] = []
    let kind: 'count' | 'read' | 'delete' = 'read'

    const builder: Record<string, unknown> = {}
    const chain = (op: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ op, args })
        return builder
      })

    builder.select = vi.fn((...args: unknown[]) => {
      calls.push({ op: 'select', args })
      const opts = args[1] as { head?: boolean } | undefined
      if (opts?.head) kind = 'count'
      return builder
    })
    builder.delete = vi.fn(() => {
      calls.push({ op: 'delete', args: [] })
      kind = 'delete'
      return builder
    })
    builder.in = chain('in')
    builder.lt = chain('lt')
    builder.order = chain('order')
    builder.limit = chain('limit')
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      let result: unknown
      if (kind === 'count') {
        counts.push(calls)
        result = { count: options.due, error: options.countError ?? null }
      } else if (kind === 'delete') {
        deletes.push(calls)
        const ids = (calls.find((c) => c.op === 'in' && c.args[0] === 'id')?.args[1] ?? []) as string[]
        result = options.deleteError
          ? { data: null, error: options.deleteError }
          : { data: ids.map((id) => ({ id })), error: null }
      } else {
        reads.push(calls)
        const page = pages.shift() ?? []
        result = { data: page.map((id) => ({ id })), error: null }
      }
      return Promise.resolve(result).then(resolve, reject)
    }
    return builder
  })

  return { client: { from } as never, reads, deletes, counts, from }
}

describe('job history retention mode', () => {
  it('is a dry run unless it is set to delete or off', () => {
    expect(resolveJobHistoryRetentionMode(undefined)).toBe('dry_run')
    expect(resolveJobHistoryRetentionMode('')).toBe('dry_run')
    expect(resolveJobHistoryRetentionMode('true')).toBe('dry_run')
    expect(resolveJobHistoryRetentionMode('dry_run')).toBe('dry_run')
    expect(resolveJobHistoryRetentionMode(' Delete ')).toBe('delete')
    expect(resolveJobHistoryRetentionMode('off')).toBe('off')
  })
})

describe('job history retention', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Midday on 27 October 2026 in London (GMT). Ninety calendar days back is 29 July 2026,
    // which London spends on BST, so its midnight is 23:00 UTC on the 28th.
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cuts off at London midnight 90 calendar days ago', () => {
    expect(jobHistoryCutoffIso()).toBe('2026-07-28T23:00:00.000Z')
  })

  it('only counts in a dry run, and counts finished jobs only', async () => {
    const fake = fakeJobsClient({ due: 2188 })

    const result = await runJobHistoryRetention(fake.client, { mode: 'dry_run' })

    expect(result).toEqual({ mode: 'dry_run', cutoffIso: '2026-07-28T23:00:00.000Z', due: 2188, deleted: 0 })
    expect(fake.deletes).toHaveLength(0)
    expect(fake.reads).toHaveLength(0)
    expect(fake.counts).toHaveLength(1)
    expect(fake.counts[0]).toContainEqual({ op: 'in', args: ['status', [...FINISHED_JOB_STATUSES]] })
    expect(fake.counts[0]).toContainEqual({ op: 'lt', args: ['created_at', '2026-07-28T23:00:00.000Z'] })
  })

  it('does not touch the table when it is off', async () => {
    const fake = fakeJobsClient({ due: 5 })

    const result = await runJobHistoryRetention(fake.client, { mode: 'off' })

    expect(result).toEqual({ mode: 'off', cutoffIso: null, due: 0, deleted: 0 })
    expect(fake.from).not.toHaveBeenCalled()
  })

  it('deletes in batches, re-checking status and age on every delete', async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => `job-${i}`)
    const fake = fakeJobsClient({ due: 503, pages: [firstPage, ['job-500', 'job-501', 'job-502']] })

    const result = await runJobHistoryRetention(fake.client, { mode: 'delete' })

    expect(result).toEqual({ mode: 'delete', cutoffIso: '2026-07-28T23:00:00.000Z', due: 503, deleted: 503 })
    expect(fake.deletes).toHaveLength(2)
    for (const calls of fake.deletes) {
      expect(calls).toContainEqual({ op: 'in', args: ['status', [...FINISHED_JOB_STATUSES]] })
      expect(calls).toContainEqual({ op: 'lt', args: ['created_at', '2026-07-28T23:00:00.000Z'] })
    }
  })

  it('never deletes a pending or processing job', async () => {
    expect(FINISHED_JOB_STATUSES).toEqual(['completed', 'failed', 'cancelled'])
  })

  it('stops without deleting when nothing is due', async () => {
    const fake = fakeJobsClient({ due: 0 })

    const result = await runJobHistoryRetention(fake.client, { mode: 'delete' })

    expect(result.deleted).toBe(0)
    expect(fake.deletes).toHaveLength(0)
  })

  it('fails loudly when the count or a delete fails', async () => {
    await expect(
      runJobHistoryRetention(fakeJobsClient({ due: 1, countError: { message: 'down' } }).client, { mode: 'dry_run' }),
    ).rejects.toThrow('Could not count old job history: down')

    await expect(
      runJobHistoryRetention(
        fakeJobsClient({ due: 1, pages: [['job-1']], deleteError: { message: 'locked' } }).client,
        { mode: 'delete' },
      ),
    ).rejects.toThrow('Could not delete old job history: locked')
  })
})
