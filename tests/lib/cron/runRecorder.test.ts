import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * BK-116 (customer bookings review of 24 October 2026): six booking crons and the job queue
 * failed with a log line and nothing else, and wrote no run record. withCronRun records each run
 * and emails CRON_ALERT_EMAIL, at most once an hour per job, when one fails. Recording must
 * never change what the route answers.
 */

const { reportCronFailure, authorizeCronRequest, createAdminClient } = vi.hoisted(() => ({
  reportCronFailure: vi.fn(async (): Promise<boolean> => true),
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import {
  CRON_FAILURE_ALERT_WINDOW_MINUTES,
  everyRunKey,
  hourlyRunKey,
  summariseRunBody,
  withCronRun,
} from '@/lib/cron/run-recorder'

const NOW = new Date('2026-10-26T14:20:00.000Z')
let db: FakeDb

function request(): Request {
  return new Request('https://management.example/api/cron/test-job', { headers: { authorization: 'Bearer secret' } })
}

function runs() {
  return db.rows('cron_job_runs')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db = createFakeDb()
  createAdminClient.mockReturnValue(db.client)
  authorizeCronRequest.mockReturnValue({ authorized: true })
  reportCronFailure.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withCronRun: every_run', () => {
  it('records a completed run with the counts the route answered, and sends no alert', async () => {
    const handler = vi.fn(async () => NextResponse.json({ checked: 4, failed: 0, ids: ['a'], note: 'free text' }))
    const GET = withCronRun('test-job', handler, { recording: 'every_run', itemFailures: (body) => Number(body.failed) })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ checked: 4, failed: 0, ids: ['a'], note: 'free text' })
    expect(runs()).toHaveLength(1)
    expect(runs()[0]).toMatchObject({
      job_name: 'test-job',
      run_key: everyRunKey(NOW),
      status: 'completed',
      error_message: null,
      result: { checked: 4, failed: 0, httpStatus: 200, itemFailures: 0 },
    })
    // Lists and free text never reach the run record.
    expect(runs()[0].result).not.toHaveProperty('ids')
    expect(runs()[0].result).not.toHaveProperty('note')
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('records a 500 answer as failed and emails the alert inbox once, with the run counts', async () => {
    const GET = withCronRun('test-job', async () => NextResponse.json({ error: 'Failed to load payments' }, { status: 500 }), {
      recording: 'every_run',
    })

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(runs()).toHaveLength(1)
    expect(runs()[0]).toMatchObject({ status: 'failed', error_message: 'HTTP 500: Failed to load payments' })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const [jobName, error, context] = reportCronFailure.mock.calls[0] as unknown as [string, Error, Record<string, unknown>]
    expect(jobName).toBe('test-job')
    expect(error.message).toBe('HTTP 500: Failed to load payments')
    expect(context).toMatchObject({ httpStatus: 500 })
  })

  it('answers 500, records the failure and alerts when the handler throws', async () => {
    const GET = withCronRun('test-job', async () => {
      throw new Error('relation "payments" does not exist')
    }, { recording: 'every_run' })

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, error: 'Internal server error' })
    expect(runs()[0]).toMatchObject({ status: 'failed', error_message: 'relation "payments" does not exist' })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('emails only the first failure in an hour, but records every one', async () => {
    const GET = withCronRun('test-job', async () => NextResponse.json({ error: 'down' }, { status: 503 }), {
      recording: 'every_run',
    })

    await GET(request())
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000))
    await GET(request())
    vi.setSystemTime(new Date(NOW.getTime() + (CRON_FAILURE_ALERT_WINDOW_MINUTES + 16) * 60_000))
    await GET(request())

    expect(runs().filter((row) => row.status === 'failed')).toHaveLength(3)
    expect(reportCronFailure).toHaveBeenCalledTimes(2)
  })

  it('alerts again an hour after the last alert, however often the job keeps failing', async () => {
    // PR 262 review: counting from the last failed run, a job failing every 15 minutes only ever
    // sent its first alert, because each failure renewed the quiet hour.
    const GET = withCronRun('test-job', async () => NextResponse.json({ error: 'down' }, { status: 503 }), {
      recording: 'every_run',
    })

    for (const minutes of [0, 15, 30, 45, 60, 75, 90]) {
      vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000))
      await GET(request())
    }

    expect(runs().filter((row) => row.status === 'failed')).toHaveLength(7)
    // At 0, then at 75: the first failure more than an hour after the alert at 0.
    expect(reportCronFailure).toHaveBeenCalledTimes(2)
  })

  it('tries again on the next failure when an alert could not be sent', async () => {
    const GET = withCronRun('test-job', async () => NextResponse.json({ error: 'down' }, { status: 503 }), {
      recording: 'every_run',
    })
    reportCronFailure.mockResolvedValueOnce(false)

    await GET(request())
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000))
    await GET(request())
    vi.setSystemTime(new Date(NOW.getTime() + 30 * 60_000))
    await GET(request())

    // The undelivered first alert does not quiet the hour; the delivered second one does.
    expect(reportCronFailure).toHaveBeenCalledTimes(2)
  })

  it('keeps the per-item failure count the route reports', async () => {
    const GET = withCronRun('test-job', async () => NextResponse.json({ checked: 9, failed: 2, refundsFailed: 1 }), {
      recording: 'every_run',
      itemFailures: (body) => Number(body.failed ?? 0) + Number(body.refundsFailed ?? 0),
    })

    await GET(request())

    expect(runs()[0]).toMatchObject({ status: 'completed', result: { itemFailures: 3 } })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })
})

describe('withCronRun: hourly', () => {
  it('keeps one completed row per hour for a job that runs every few minutes', async () => {
    const GET = withCronRun('busy-job', async () => NextResponse.json({ success: true, processed: 1 }), { recording: 'hourly' })

    await GET(request())
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000))
    await GET(request())
    vi.setSystemTime(new Date('2026-10-26T15:01:00.000Z'))
    await GET(request())

    expect(runs().map((row) => row.run_key)).toEqual([hourlyRunKey(NOW), hourlyRunKey(new Date('2026-10-26T15:01:00.000Z'))])
    expect(runs().every((row) => row.status === 'completed')).toBe(true)
  })

  it('gives a failed run, and a run with item failures, a row of its own', async () => {
    let answer: Response = NextResponse.json({ error: 'boom' }, { status: 500 })
    const GET = withCronRun('busy-job', async () => answer, {
      recording: 'hourly',
      itemFailures: (body) => Number(body.errors ?? 0),
    })

    await GET(request())
    answer = NextResponse.json({ success: true, errors: 2 })
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000))
    await GET(request())

    expect(runs().map((row) => [row.status, String(row.run_key).split(':')[0]])).toEqual([
      ['failed', 'failed'],
      ['completed', 'run'],
    ])
    expect(runs()[1].result).toMatchObject({ itemFailures: 2 })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})

describe('withCronRun: never changes the answer', () => {
  it('leaves no row and sends nothing for a request without the cron secret', async () => {
    authorizeCronRequest.mockReturnValue({ authorized: false })
    const handler = vi.fn(async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const GET = withCronRun('test-job', handler, { recording: 'every_run' })

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(runs()).toHaveLength(0)
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('returns the route answer when the run record cannot be written', async () => {
    db.failNext({ table: 'cron_job_runs', operation: 'insert', message: 'database down' })
    db.failNext({ table: 'cron_job_runs', operation: 'insert', message: 'database down' })
    const GET = withCronRun('test-job', async () => NextResponse.json({ checked: 1 }), { recording: 'every_run' })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ checked: 1 })
    expect(runs()).toHaveLength(0)
  })

  it('still alerts when the earlier-failure check cannot be made', async () => {
    const GET = withCronRun('test-job', async () => NextResponse.json({ error: 'x' }, { status: 500 }), { recording: 'every_run' })
    db.failNext({ table: 'cron_job_runs', operation: 'select', message: 'read failed' })

    await GET(request())

    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})

describe('summariseRunBody', () => {
  it('keeps top-level numbers and true or false values only', () => {
    expect(
      summariseRunBody({ checked: 3, aborted: false, total: Number.NaN, list: [1], nested: { a: 1 }, text: 'x', 'bad key': 1 }),
    ).toEqual({ checked: 3, aborted: false })
    expect(summariseRunBody(null)).toEqual({})
    expect(summariseRunBody([1, 2])).toEqual({})
  })
})
