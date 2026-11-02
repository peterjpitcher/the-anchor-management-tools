// The daily birthday reminder raises an alert when it goes wrong, and only then (siblings#16).
//
// On a failure the route only logged and returned a 500, which nobody reads. Vercel does not
// retry, and the next day's run looks for birthdays exactly 7 days away, so the reminder for
// today's people was lost without anyone knowing, while the Birthdays page promises it goes every
// morning. The route now alerts through reportCronFailure, like the invite chase and separations
// crons. A send the email service did not confirm is reported as "may have gone", never as "not
// sent", and the database's or provider's own text never reaches the message staff see.
// sendEmail and reportCronFailure are mocked: nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.hoisted(() => vi.fn())
const reportCronFailureMock = vi.hoisted(() => vi.fn())
const sendEmailMock = vi.hoisted(() => vi.fn())
const adminFromMock = vi.hoisted(() => vi.fn())
const claimMock = vi.hoisted(() => vi.fn())
const persistMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn())
const markCommittedMock = vi.hoisted(() => vi.fn())
const lookupMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: authorizeCronRequestMock }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: reportCronFailureMock }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: sendEmailMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/api/idempotency', () => ({
  STALE_PROCESSING_MS: 10 * 60 * 1000,
  claimIdempotencyKey: claimMock,
  computeIdempotencyRequestHash: vi.fn().mockReturnValue('request-hash'),
  lookupIdempotencyKey: lookupMock,
  markIdempotencyClaimCommitted: markCommittedMock,
  persistIdempotencyResponse: persistMock,
  releaseIdempotencyClaim: releaseMock,
}))

import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/birthday-reminders/route'
import { BIRTHDAY_REMINDER_MESSAGES } from '@/lib/employees/birthday-reminders'

const POSTGRES_TEXT = 'relation "employees" does not exist'

function employeesQuery(rows: unknown[] | null, error: { code: string; message: string } | null = null) {
  const not = vi.fn().mockResolvedValue({ data: rows, error })
  const inStatus = vi.fn().mockReturnValue({ not })
  return { select: vi.fn().mockReturnValue({ in: inStatus }) }
}

// A birthday on Monday 9 November 2026, a week after the 09:00 UTC run on Monday 2 November.
const DUE_A_WEEK_TODAY = {
  employee_id: '00000000-0000-4000-8000-000000000001',
  first_name: 'Sam',
  last_name: 'Rowe',
  preferred_name: null,
  job_title: 'Bar Staff',
  date_of_birth: '1990-11-09',
  email_address: null,
}

function request(): NextRequest {
  return new Request('http://localhost/api/cron/birthday-reminders') as unknown as NextRequest
}

async function run() {
  const response = await GET(request())
  return { status: response.status, body: await response.json() }
}

function raisedAlert() {
  expect(reportCronFailureMock).toHaveBeenCalledOnce()
  const [cronName, error, context] = reportCronFailureMock.mock.calls[0]
  return { cronName, message: (error as Error).message, context: context as { outcome: string } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  authorizeCronRequestMock.mockReturnValue({ authorized: true })
  reportCronFailureMock.mockResolvedValue(true)
  claimMock.mockResolvedValue({ state: 'claimed' })
  persistMock.mockResolvedValue(undefined)
  releaseMock.mockResolvedValue(undefined)
  markCommittedMock.mockResolvedValue(undefined)
  lookupMock.mockResolvedValue({ state: 'new' })
  sendEmailMock.mockResolvedValue({ success: true })
  adminFromMock.mockReturnValue(employeesQuery([DUE_A_WEEK_TODAY]))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('/api/cron/birthday-reminders alerts', () => {
  it('alerts when the email service refuses the reminder, and frees the day for a manual send', async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: 'Resend 422: invalid from address' })

    const { status, body } = await run()

    expect(status).toBe(500)
    expect(body.error).toBe(BIRTHDAY_REMINDER_MESSAGES.notSent)
    const { cronName, message, context } = raisedAlert()
    expect(cronName).toBe('birthday-reminders')
    expect(message).toBe(BIRTHDAY_REMINDER_MESSAGES.notSent)
    expect(context.outcome).toMatch(/did not get this morning's birthday reminder/)
    expect(context.outcome).toMatch(/Birthdays page today/)
    expect(JSON.stringify(body)).not.toContain('Resend 422')
    expect(releaseMock).toHaveBeenCalledOnce()
  })

  it('says the reminder may have gone when the email service did not confirm it, and keeps the claim', async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: 'Request timed out', uncertain: true })

    const { status, body } = await run()

    expect(status).toBe(500)
    expect(body).toEqual({ error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true })
    const { message, context } = raisedAlert()
    expect(message).toBe(BIRTHDAY_REMINDER_MESSAGES.uncertain)
    expect(context.outcome).toMatch(/may have reached the manager/)
    expect(context.outcome).toMatch(/Check with the manager before sending it again/)
    expect(`${message} ${context.outcome}`).not.toMatch(/did not get|not sent|was not sent/)
    // Kept so an overlapping run cannot send a second copy; it goes stale after ten minutes.
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('treats a send that throws as one that may have gone', async () => {
    sendEmailMock.mockRejectedValue(new Error('socket hang up'))

    const { body } = await run()

    expect(body).toEqual({ error: BIRTHDAY_REMINDER_MESSAGES.uncertain, uncertain: true })
    expect(raisedAlert().context.outcome).toMatch(/may have reached the manager/)
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('alerts when the staff list cannot be read, without passing on the database text', async () => {
    adminFromMock.mockReturnValue(employeesQuery(null, { code: '42P01', message: POSTGRES_TEXT }))

    const { status, body } = await run()

    expect(status).toBe(500)
    expect(body.error).toBe(BIRTHDAY_REMINDER_MESSAGES.loadFailed)
    expect(JSON.stringify(body)).not.toContain(POSTGRES_TEXT)
    const { message, context } = raisedAlert()
    expect(message).toBe(BIRTHDAY_REMINDER_MESSAGES.loadFailed)
    expect(context.outcome).toMatch(/did not get this morning's birthday reminder/)
    expect(sendEmailMock).not.toHaveBeenCalled()
    // Logged field by field, not as one object.
    expect(console.error).toHaveBeenCalledWith(
      '[birthday-reminders] Could not load employees',
      expect.objectContaining({ code: '42P01', message: POSTGRES_TEXT }),
    )
  })

  it('alerts with a plain message when the run cannot be claimed', async () => {
    claimMock.mockRejectedValue({ code: '57014', message: 'canceling statement due to statement timeout' })

    const { status, body } = await run()

    expect(status).toBe(500)
    expect(body.error).toBe(BIRTHDAY_REMINDER_MESSAGES.notStarted)
    expect(JSON.stringify(body)).not.toContain('statement timeout')
    expect(raisedAlert().message).toBe(BIRTHDAY_REMINDER_MESSAGES.notStarted)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('/api/cron/birthday-reminders when the reminder went but could not be recorded', () => {
  it('alerts that a press later today would send a second copy, and still counts it as sent', async () => {
    persistMock.mockRejectedValue({ code: '08006', message: 'connection failure' })
    markCommittedMock.mockRejectedValue({ code: '08006', message: 'connection failure' })

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, sent: 1 })
    expect(sendEmailMock).toHaveBeenCalledOnce()
    const { cronName, message, context } = raisedAlert()
    expect(cronName).toBe('birthday-reminders')
    expect(message).toMatch(/was sent, but the app could not record/)
    expect(context.outcome).toMatch(/went to the manager/)
    expect(context.outcome).toMatch(/Do not send it again from the Birthdays page today/)
    expect(`${message} ${context.outcome}`).not.toContain('connection failure')
  })
})

describe('/api/cron/birthday-reminders stays quiet when nothing is wrong', () => {
  it('sends the reminder and raises no alert', async () => {
    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, sent: 1 })
    expect(sendEmailMock).toHaveBeenCalledOnce()
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('raises no alert on a day with no birthdays a week away', async () => {
    adminFromMock.mockReturnValue(employeesQuery([{ ...DUE_A_WEEK_TODAY, date_of_birth: '1990-11-10' }]))

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, sent: 0 })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('counts a sent reminder as sent when only the run record fails to save', async () => {
    persistMock.mockRejectedValue({ code: '08006', message: 'connection failure' })

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, sent: 1 })
    expect(reportCronFailureMock).not.toHaveBeenCalled()
    // The answer goes into the claim instead, which a later press replays even after the claim
    // goes stale, so the page cannot send a second copy today. A claim left as plain
    // "processing" was handed to the next press after ten minutes, which sent one.
    expect(markCommittedMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('cron:employee-birthday-reminder:2026-11-02:7'),
      'request-hash',
      expect.objectContaining({ success: true, sent: 1 }),
    )
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('says a run held by another has nothing to do, as a warning with the London time, and raises no alert', async () => {
    claimMock.mockResolvedValue({ state: 'in_progress' })
    lookupMock.mockResolvedValue({
      state: 'replay',
      response: { state: 'processing', claimed_at: '2026-11-02T08:58:00.000Z' },
    })

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, sent: 0, skipped: true })
    expect(body.message).toBe(BIRTHDAY_REMINDER_MESSAGES.inProgress('09:09'))
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })

  it('says a second run today has nothing to do, without printing the ISO run date', async () => {
    claimMock.mockResolvedValue({ state: 'replay' })

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(body.message).toBe("Today's birthday reminder has already been dealt with.")
    expect(body.message).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(reportCronFailureMock).not.toHaveBeenCalled()
  })
})
