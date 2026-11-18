import { describe, expect, it } from 'vitest'

import {
  CRON_RUN_RETENTION_BATCH_SIZE,
  cronRunRetentionCutoff,
  deleteOldCronJobRuns,
} from '@/lib/cron/cron-run-retention'

/**
 * The cron run retention (spec D3, owner approval 18 November 2026): rows older than 90 days for
 * three log-only jobs go, `running` rows and every other job's rows stay. The fake below applies
 * the filters for real and, like PostgREST, returns at most 1,000 rows a request, so each test
 * proves what is left in the table rather than which calls were made.
 */

type Row = { id: string; job_name: string; status: string; created_at: string }
type Filter = (row: Row) => boolean

const ROW_CAP = 1000

function fakeSupabase(rows: Row[], options: { failDelete?: boolean } = {}) {
  const table = [...rows]
  const stats = { selects: 0, deletes: 0, longestDeleteIdList: 0 }

  const from = (name: string) => {
    expect(name).toBe('cron_job_runs')
    const filters: Filter[] = []
    let mode: 'select' | 'delete' = 'select'
    let range: [number, number] = [0, Number.MAX_SAFE_INTEGER]
    let ordered = false

    const builder = {
      select() {
        mode = 'select'
        return builder
      },
      delete(opts?: { count?: string }) {
        expect(opts).toEqual({ count: 'exact' })
        mode = 'delete'
        return builder
      },
      in(column: keyof Row, values: string[]) {
        if (column === 'id' && mode === 'delete') {
          stats.longestDeleteIdList = Math.max(stats.longestDeleteIdList, values.length)
        }
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      neq(column: keyof Row, value: string) {
        filters.push((row) => row[column] !== value)
        return builder
      },
      lt(column: keyof Row, value: string) {
        filters.push((row) => Date.parse(row[column]) < Date.parse(value))
        return builder
      },
      order(column: keyof Row) {
        expect(column).toBe('id')
        ordered = true
        return builder
      },
      range(start: number, end: number) {
        range = [start, end]
        return builder
      },
      then(resolve: (value: unknown) => void) {
        const matches = table.filter((row) => filters.every((filter) => filter(row)))
        if (mode === 'select') {
          stats.selects += 1
          expect(ordered).toBe(true)
          const sorted = [...matches].sort((a, b) => a.id.localeCompare(b.id))
          const page = sorted.slice(range[0], range[1] + 1).slice(0, ROW_CAP)
          resolve({ data: page.map((row) => ({ id: row.id })), error: null })
          return
        }
        stats.deletes += 1
        if (options.failDelete) {
          resolve({ data: null, error: { message: 'canceling statement due to statement timeout' }, count: null })
          return
        }
        for (const row of matches) table.splice(table.indexOf(row), 1)
        resolve({ data: null, error: null, count: matches.length })
      },
    }
    return builder
  }

  // The fake covers only the calls the retention makes.
  return { client: { from } as unknown as Parameters<typeof deleteOldCronJobRuns>[0], table, stats }
}

const NOW = new Date('2026-11-18T03:00:00Z')
const OLD = '2026-06-01T10:00:00Z' // well over 90 days before NOW
const RECENT = '2026-11-01T10:00:00Z'

function rowsFor(jobName: string, count: number, createdAt: string, status = 'completed', prefix = jobName): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index).padStart(6, '0')}`,
    job_name: jobName,
    status,
    created_at: createdAt,
  }))
}

describe('cronRunRetentionCutoff', () => {
  it('is the start of the London day 90 calendar days back', () => {
    // 18 November 2026 (GMT) minus 90 days is 20 August 2026, when London is on BST.
    expect(cronRunRetentionCutoff(NOW).toISOString()).toBe('2026-08-19T23:00:00.000Z')
  })

  it('uses the London date, not the UTC one, just after midnight in summer', () => {
    // 00:30 BST on 1 July is still 30 June in UTC.
    expect(cronRunRetentionCutoff(new Date('2026-06-30T23:30:00Z')).toISOString()).toBe('2026-04-01T23:00:00.000Z')
  })
})

describe('deleteOldCronJobRuns', () => {
  it('deletes allowlisted rows older than 90 days and keeps the newer ones', async () => {
    const { client, table } = fakeSupabase([
      ...rowsFor('event-guest-engagement', 3, OLD),
      ...rowsFor('parking-notifications', 2, OLD, 'failed'),
      ...rowsFor('sunday-preorder', 2, OLD),
      ...rowsFor('event-guest-engagement', 2, RECENT, 'completed', 'recent-ege'),
      ...rowsFor('parking-notifications', 1, RECENT, 'completed', 'recent-parking'),
    ])

    const result = await deleteOldCronJobRuns(client, { now: NOW })

    expect(result).toEqual({ deleted: 7, complete: true, cutoff: '2026-08-19T23:00:00.000Z' })
    expect(table.map((row) => row.id).sort()).toEqual(['recent-ege-000000', 'recent-ege-000001', 'recent-parking-000000'])
  })

  it('never deletes an oj-projects-billing-pass row, however old', async () => {
    const billingPass = { id: 'billing-2026-01', job_name: 'oj-projects-billing-pass', status: 'completed', created_at: '2026-02-02T09:05:00Z' }
    const { client, table } = fakeSupabase([
      billingPass,
      ...rowsFor('manager-weekly-report', 1, OLD),
      ...rowsFor('invoice-reminders', 1, OLD),
      ...rowsFor('private-booking-monitor', 1, OLD),
      ...rowsFor('sunday-preorder', 1, OLD),
    ])

    const result = await deleteOldCronJobRuns(client, { now: NOW })

    expect(result.deleted).toBe(1)
    expect(table).toContainEqual(billingPass)
    expect(table.map((row) => row.job_name).sort()).toEqual([
      'invoice-reminders',
      'manager-weekly-report',
      'oj-projects-billing-pass',
      'private-booking-monitor',
    ])
  })

  it('keeps running rows whatever their age', async () => {
    const { client, table } = fakeSupabase([
      ...rowsFor('parking-notifications', 1, '2026-01-01T00:00:00Z', 'running'),
      ...rowsFor('event-guest-engagement', 1, OLD, 'running'),
      ...rowsFor('event-guest-engagement', 1, OLD, 'completed', 'old-done'),
    ])

    const result = await deleteOldCronJobRuns(client, { now: NOW })

    expect(result.deleted).toBe(1)
    expect(table.map((row) => row.status)).toEqual(['running', 'running'])
  })

  it('works through more than one batch past the 1,000-row cap, in small delete requests, and a second run deletes nothing', async () => {
    const backlog = CRON_RUN_RETENTION_BATCH_SIZE * 2 + 1234
    const { client, table, stats } = fakeSupabase([
      ...rowsFor('event-guest-engagement', backlog, OLD),
      ...rowsFor('event-guest-engagement', 5, RECENT, 'completed', 'recent'),
    ])

    const first = await deleteOldCronJobRuns(client, { now: NOW })
    expect(first).toMatchObject({ deleted: backlog, complete: true })
    expect(table).toHaveLength(5)
    expect(stats.longestDeleteIdList).toBeLessThanOrEqual(100)

    const second = await deleteOldCronJobRuns(client, { now: NOW })
    expect(second).toMatchObject({ deleted: 0, complete: true })
    expect(table).toHaveLength(5)
  })

  it('stops cleanly at its deadline and reports the run as not complete', async () => {
    const { client, table, stats } = fakeSupabase(rowsFor('sunday-preorder', 50, OLD))

    const result = await deleteOldCronJobRuns(client, { now: NOW, deadlineMs: Date.now() - 1 })

    expect(result).toMatchObject({ deleted: 0, complete: false })
    expect(table).toHaveLength(50)
    expect(stats.selects).toBe(0)
  })

  it('throws when a delete fails, so the cron run is seen to fail', async () => {
    const { client, table } = fakeSupabase(rowsFor('parking-notifications', 3, OLD), { failDelete: true })

    await expect(deleteOldCronJobRuns(client, { now: NOW })).rejects.toThrow(
      'Could not delete old cron run records: canceling statement due to statement timeout',
    )
    expect(table).toHaveLength(3)
  })
})
