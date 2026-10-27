import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * The daily website refusals summary (BK-101, owner decision D17) goes to the manager inbox,
 * once a London day, and only when something was turned away the day before.
 */

const { sendEmail, claims } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true })),
  claims: new Map<string, string>(),
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportCronFailure: vi.fn(async () => undefined),
}))
vi.mock('@/lib/api/idempotency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/idempotency')>()),
  claimIdempotencyKey: vi.fn(async (_db: unknown, key: string) => {
    if (claims.has(key)) return { state: 'in_progress' }
    claims.set(key, 'processing')
    return { state: 'claimed' }
  }),
  persistIdempotencyResponse: vi.fn(async (_db: unknown, key: string) => {
    claims.set(key, 'done')
  }),
  releaseIdempotencyClaim: vi.fn(async (_db: unknown, key: string) => {
    claims.delete(key)
  }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET, maxDuration } from '@/app/api/cron/website-refusals-summary/route'

const WEBSITE_KEY = '00000000-0000-4000-8000-0000000000a1'
let db: FakeDb

function request(): NextRequest {
  return new NextRequest('https://management.example/api/cron/website-refusals-summary', { headers: { authorization: 'Bearer s' } })
}

function seed(events: Array<Record<string, unknown>>) {
  db = createFakeDb({
    api_keys: [{ id: WEBSITE_KEY, permissions: ['create:bookings'] }],
    booking_funnel_events: events.map((event, index) => ({ id: `e${index}`, api_key_id: WEBSITE_KEY, source: 'website', ...event })),
  })
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
}

beforeEach(() => {
  vi.clearAllMocks()
  claims.clear()
  vi.useFakeTimers()
  // 08:00 UTC on Monday 26 October 2026: the summary covers Sunday 25 October.
  vi.setSystemTime(new Date('2026-10-26T08:00:00.000Z'))
  sendEmail.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cron/website-refusals-summary', () => {
  it('has its own time limit', () => {
    expect(maxDuration).toBe(60)
  })

  it('emails the manager inbox once for yesterday when something was turned away', async () => {
    seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }])

    const first = await GET(request())
    const second = await GET(request())

    expect(await first.json()).toMatchObject({ success: true, date: '2026-10-25', refused: 1, emailed: true })
    expect(await second.json()).toMatchObject({ emailed: false, alert: 'already_sent' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [options] = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string }]
    expect(options.to).toBe('manager@the-anchor.pub')
    expect(options.subject).toBe('Website bookings turned away on Sunday 25 October: 1 refused')
    expect(db.rows('cron_job_runs').map((row) => row.status)).toEqual(['completed', 'completed'])
  })

  it('sends nothing on a quiet day', async () => {
    seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'complete', slots_offered: 4 }])

    const response = await GET(request())

    expect(await response.json()).toMatchObject({ emailed: false, searches: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails the run and frees the day for a retry when the email does not send', async () => {
    seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'failed', route: 'api/table-bookings', reason_code: 'UPSTREAM_NOT_OK' }])
    sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' } as never)

    const failed = await GET(request())
    const retried = await GET(request())

    expect(failed.status).toBe(502)
    expect(retried.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(db.rows('cron_job_runs').map((row) => row.status)).toEqual(['failed', 'completed'])
  })
})
