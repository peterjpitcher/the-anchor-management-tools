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

  it('emails the manager inbox once for yesterday when something failed', async () => {
    seed([
      { occurred_at: '2026-10-25T10:00:00.000Z', stage: 'failed', route: 'api/table-bookings', reason_code: 'UPSTREAM_NOT_OK' },
      { occurred_at: '2026-10-25T11:00:00.000Z', stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' },
    ])

    const first = await GET(request())
    const second = await GET(request())

    expect(await first.json()).toMatchObject({ success: true, date: '2026-10-25', refused: 1, failed: 1, emailed: true })
    expect(await second.json()).toMatchObject({ emailed: false, alert: 'already_sent' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [options] = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string }]
    expect(options.to).toBe('manager@the-anchor.pub')
    expect(options.subject).toBe('Website bookings turned away on Sunday 25 October: 1 refused, 1 failed')
    expect(db.rows('cron_job_runs').map((row) => row.status)).toEqual(['completed', 'completed'])
  })

  it('sends nothing when the only refusals are ordinary ones', async () => {
    // Owner, 2 November 2026: no email unless there is a problem.
    seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'refused', route: 'api/table-bookings', reason_code: 'OUTSIDE_HOURS' }])

    const response = await GET(request())

    expect(await response.json()).toMatchObject({ refused: 1, emailed: false })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing on a quiet day', async () => {
    seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'availability', route: 'table-bookings/load', purpose: 'drinks', calculation_state: 'complete', slots_offered: 4 }])

    const response = await GET(request())

    expect(await response.json()).toMatchObject({ emailed: false, searches: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  describe('the quiet form alert', () => {
    // The run is on Monday 26 October 2026, so the seven days counted are 19 to 25 October.
    const signal = (step: string, occurredAt: string, extra: Record<string, unknown> = {}) => ({
      occurred_at: occurredAt,
      stage: 'form',
      route: 'private_hire_enquiry',
      reason_code: step,
      ...extra,
    })
    const quietSubjects = () =>
      (sendEmail.mock.calls as unknown as Array<[{ subject: string; to: string; text: string }]>)
        .map(([options]) => options)
        .filter((options) => options.subject.startsWith('Private hire enquiry form'))

    it('emails the manager inbox once when submit was pressed twice and nothing was sent', async () => {
      seed([
        signal('opened', '2026-10-20T10:00:00.000Z'),
        signal('started', '2026-10-20T10:01:00.000Z'),
        signal('submit_pressed', '2026-10-20T10:02:00.000Z'),
        signal('submit_pressed', '2026-10-25T15:00:00.000Z'),
      ])

      const first = await GET(request())
      const second = await GET(request())

      expect(await first.json()).toMatchObject({ success: true, emailed: false, quietForms: [{ form: 'private_hire_enquiry', alert: 'sent' }] })
      expect(await second.json()).toMatchObject({ quietForms: [{ form: 'private_hire_enquiry', alert: 'already_sent' }] })
      expect(quietSubjects()).toHaveLength(1)
      expect(quietSubjects()[0]).toMatchObject({
        to: 'manager@the-anchor.pub',
        subject: 'Private hire enquiry form: submit was pressed 2 times and none was sent in the last 7 days',
      })
      expect(quietSubjects()[0].text).toContain('From Monday 19 October to Sunday 25 October')
      expect(quietSubjects()[0].text).toContain('- Submit pressed: 2.')
    })

    it('emails when five visitors started the form and nothing was sent', async () => {
      seed(['19', '20', '21', '22', '25'].map((day) => signal('started', `2026-10-${day}T12:00:00.000Z`)))

      await GET(request())

      expect(quietSubjects().map((options) => options.subject)).toEqual([
        'Private hire enquiry form: 5 visitors started it and none was sent in the last 7 days',
      ])
    })

    it('never fires on opens alone, however many', async () => {
      seed(Array.from({ length: 400 }, (_, index) => signal('opened', `2026-10-25T10:${String(index % 60).padStart(2, '0')}:00.000Z`)))

      const response = await GET(request())

      expect(await response.json()).toMatchObject({ quietForms: [{ form: 'private_hire_enquiry', alert: 'not_needed' }] })
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it.each([
      ['one submit press and four starts', [signal('submit_pressed', '2026-10-25T10:00:00.000Z'), ...['21', '22', '23', '24'].map((day) => signal('started', `2026-10-${day}T12:00:00.000Z`))]],
      ['an enquiry that was sent', [signal('submit_pressed', '2026-10-24T10:00:00.000Z'), signal('submit_pressed', '2026-10-25T10:00:00.000Z'), signal('sent', '2026-10-25T10:00:05.000Z')]],
      ['submit presses more than seven days old', [signal('submit_pressed', '2026-10-18T10:00:00.000Z'), signal('submit_pressed', '2026-10-18T11:00:00.000Z')]],
      ['signals from the event booking form', [signal('submit_pressed', '2026-10-25T10:00:00.000Z', { route: 'event_booking' }), signal('submit_pressed', '2026-10-25T11:00:00.000Z', { route: 'event_booking' })]],
      ['signals sent with a test key', [signal('submit_pressed', '2026-10-25T10:00:00.000Z', { api_key_id: 'test-key' }), signal('submit_pressed', '2026-10-25T11:00:00.000Z', { api_key_id: 'test-key' })]],
    ])('sends nothing for %s', async (_label, events) => {
      seed(events)

      await GET(request())

      expect(quietSubjects()).toHaveLength(0)
    })

    it('tells the manager once about one bad afternoon, not every morning for a week', async () => {
      // Both presses were on Tuesday 20 October; nothing since.
      seed([signal('submit_pressed', '2026-10-20T10:00:00.000Z'), signal('submit_pressed', '2026-10-20T10:05:00.000Z')])

      vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'))
      const wednesday = await GET(request())
      vi.setSystemTime(new Date('2026-10-22T08:00:00.000Z'))
      const thursday = await GET(request())
      vi.setSystemTime(new Date('2026-10-27T08:00:00.000Z'))
      const nextTuesday = await GET(request())
      // Wednesday 28 October: the presses are now more than seven days old.
      vi.setSystemTime(new Date('2026-10-28T08:00:00.000Z'))
      const afterTheWeek = await GET(request())

      expect(await wednesday.json()).toMatchObject({ quietForms: [{ alert: 'sent' }] })
      expect(await thursday.json()).toMatchObject({ quietForms: [{ alert: 'already_sent' }] })
      expect(await nextTuesday.json()).toMatchObject({ quietForms: [{ alert: 'already_sent' }] })
      expect(await afterTheWeek.json()).toMatchObject({ quietForms: [{ alert: 'not_needed' }] })
      expect(quietSubjects()).toHaveLength(1)
    })

    it('tells the manager again when people keep trying on a later day', async () => {
      seed([
        signal('submit_pressed', '2026-10-20T10:00:00.000Z'),
        signal('submit_pressed', '2026-10-20T10:05:00.000Z'),
        signal('started', '2026-10-22T19:00:00.000Z'),
      ])

      vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'))
      await GET(request())
      vi.setSystemTime(new Date('2026-10-23T08:00:00.000Z'))
      await GET(request())

      expect(quietSubjects()).toHaveLength(2)
    })

    it('still sends an alert the next morning when it could not be sent on the day, with nothing new since', async () => {
      seed([signal('submit_pressed', '2026-10-20T10:00:00.000Z'), signal('submit_pressed', '2026-10-20T10:05:00.000Z')])

      vi.setSystemTime(new Date('2026-10-21T08:00:00.000Z'))
      sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' } as never)
      const failed = await GET(request())
      vi.setSystemTime(new Date('2026-10-22T08:00:00.000Z'))
      const nextMorning = await GET(request())

      expect(failed.status).toBe(502)
      expect(await nextMorning.json()).toMatchObject({ success: true, quietForms: [{ form: 'private_hire_enquiry', alert: 'sent' }] })
      expect(quietSubjects()).toHaveLength(2)
    })

    it('dates a signal by the London day it arrived on', async () => {
      // 23:30 UTC on Saturday 24 October is 00:30 BST on Sunday 25 October, the last day counted.
      seed([signal('submit_pressed', '2026-10-24T23:30:00.000Z'), signal('submit_pressed', '2026-10-24T23:31:00.000Z')])

      await GET(request())

      expect([...claims.keys()]).toContain('website-quiet-form:private_hire_enquiry:2026-10-25')
    })

    it('still sends the daily summary when the quiet form count cannot be made, and fails the run', async () => {
      seed([{ occurred_at: '2026-10-25T10:00:00.000Z', stage: 'failed', route: 'api/table-bookings', reason_code: 'UPSTREAM_NOT_OK' }])
      // The first read of the run is the quiet form check's list of API keys.
      db.failNext({ table: 'api_keys', operation: 'select', message: 'database down', times: 1 })

      const response = await GET(request())
      const body = await response.json()

      expect(response.status).toBe(502)
      expect(body).toMatchObject({ success: false, emailed: true, quietForms: [{ form: 'private_hire_enquiry', alert: 'failed' }] })
      expect(sendEmail).toHaveBeenCalledTimes(1)
    })

    it('frees the day for a retry when the alert email does not send', async () => {
      seed([signal('submit_pressed', '2026-10-25T10:00:00.000Z'), signal('submit_pressed', '2026-10-25T11:00:00.000Z')])
      sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' } as never)

      const failed = await GET(request())
      const retried = await GET(request())

      expect(failed.status).toBe(502)
      expect(await retried.json()).toMatchObject({ success: true, quietForms: [{ form: 'private_hire_enquiry', alert: 'sent' }] })
      expect(quietSubjects()).toHaveLength(2)
    })
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
