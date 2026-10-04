import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'

/**
 * The automatic invoice reminder job, run through its cron route against an in-memory stand-in
 * for the database. Every case checks the two things that matter most: which customer email
 * left (or did not), and what the owner's summary said about it.
 */

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => true),
  sendInvoiceEmail: vi.fn(),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn((payload: unknown) => `hash:${JSON.stringify(payload)}`),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/invoice-recipients', () => ({ resolveVendorInvoiceRecipients: vi.fn() }))
vi.mock('@/lib/invoices/greeting', () => ({ resolveInvoiceGreetingName: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: vi.fn(() => 'https://management.example.test') }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { sendEmail } from '@/lib/email/emailService'
import {
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { reportCronFailure } from '@/lib/cron/alerting'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'
import { GET } from '@/app/api/cron/invoice-reminders/route'

type Row = Record<string, unknown>
type Filter = [method: string, ...args: unknown[]]
type Answer = { data: unknown; error: { message: string; code?: string } | null }

interface Query {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: unknown
  filters: Filter[]
}

interface Scenario {
  /** Open invoices past their due date, as the first load returns them. */
  invoices: Row[]
  /** What a later re-read of one invoice returns, by id. Defaults to the row above. */
  fresh?: Record<string, Row>
  privateHireInvoiceIds?: string[]
  emails?: Row[]
  drafts?: Row[]
  earlierRuns?: Row[]
  /** A run record that already exists for today. */
  todayRun?: Row | null
  failInvoiceLoad?: boolean
  /** The re-read immediately before a send fails. */
  failFreshRead?: boolean
  failReminderColumnWrite?: boolean
}

const OWNER = 'owner@orangejelly.example'
const APP_URL = 'https://management.example.test'
// Tuesday 13 October 2026, 09:30 UTC: the hour the job is scheduled for.
const TUESDAY = new Date('2026-10-13T09:30:00.000Z')

function invoice(overrides: Row = {}): Row {
  return {
    id: 'inv-1',
    invoice_number: 'INV-0101',
    vendor_id: 'vendor-1',
    invoice_date: '2026-09-22',
    // Due Tuesday 6 October: seven days overdue on the 13th, inside the first window.
    due_date: '2026-10-06',
    status: 'sent',
    sent_at: '2026-09-22T09:00:00.000Z',
    deleted_at: null,
    subtotal_amount: 1000,
    vat_amount: 200,
    total_amount: 1200,
    paid_amount: 0,
    reminders_held_until: null,
    reminder_first_sent_at: null,
    reminder_second_sent_at: null,
    vendor: { id: 'vendor-1', name: 'Acme Events Ltd', email: 'accounts@acme.example', paypal_payments_enabled: false },
    line_items: [],
    payments: [],
    credits: [],
    ...overrides,
  }
}

function has(query: Query, method: string, column: string): Filter | undefined {
  return query.filters.find((filter) => filter[0] === method && filter[1] === column)
}

/**
 * A database stand-in that answers each query from the scenario and applies invoice updates to
 * it, so a second run sees what the first one wrote.
 */
function fakeDb(scenario: Scenario) {
  const queries: Query[] = []

  const answer = (query: Query): Answer => {
    const ok = (data: unknown): Answer => ({ data, error: null })

    if (query.table === 'cron_job_runs') {
      if (query.op === 'insert') {
        return scenario.todayRun
          ? { data: null, error: { code: '23505', message: 'duplicate key value' } }
          : ok({ id: 'run-1' })
      }
      if (query.op === 'update') return ok({ id: 'run-1' })
      if (has(query, 'lt', 'run_key')) return ok(scenario.earlierRuns ?? [])
      return ok(scenario.todayRun ?? null)
    }

    if (query.table === 'invoices') {
      const byId = has(query, 'eq', 'id')?.[2] as string | undefined
      if (query.op === 'update') {
        const payload = query.payload as Row
        const writesReminder = 'reminder_first_sent_at' in payload || 'reminder_second_sent_at' in payload
        if (writesReminder && scenario.failReminderColumnWrite) {
          return { data: null, error: { message: 'connection reset by peer' } }
        }
        for (const row of [...scenario.invoices, ...Object.values(scenario.fresh ?? {})]) {
          if (row.id === byId) Object.assign(row, payload)
        }
        return ok({ id: byId })
      }
      if (byId) {
        if (scenario.failFreshRead) return { data: null, error: { message: 'statement timeout' } }
        return ok(scenario.fresh?.[byId] ?? scenario.invoices.find((row) => row.id === byId) ?? null)
      }
      if (has(query, 'eq', 'status')) return ok(scenario.drafts ?? [])
      if (has(query, 'in', 'vendor_id')) return ok(scenario.invoices)
      if (has(query, 'in', 'id')) {
        const ids = has(query, 'in', 'id')?.[2] as string[]
        return ok(ids.map((id) => ({ id, vendor_id: 'vendor-1' })))
      }
      if (scenario.failInvoiceLoad) return { data: null, error: { message: 'database unavailable' } }
      return ok(scenario.invoices)
    }

    if (query.table === 'private_booking_invoices') {
      return ok((scenario.privateHireInvoiceIds ?? []).map((invoice_id) => ({ invoice_id })))
    }
    if (query.table === 'email_messages') return ok(scenario.emails ?? [])
    if (query.table === 'invoice_email_logs') return ok(null)

    throw new Error(`Unexpected table ${query.table}`)
  }

  const db = {
    from(table: string) {
      const query: Query = { table, op: 'select', filters: [] }
      queries.push(query)
      const one = async (): Promise<Answer> => {
        const result = answer(query)
        return Array.isArray(result.data) ? { ...result, data: result.data[0] ?? null } : result
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => Object.assign(query, { op: 'insert', payload }) && builder,
        update: (payload: unknown) => Object.assign(query, { op: 'update', payload }) && builder,
        delete: () => Object.assign(query, { op: 'delete' }) && builder,
        maybeSingle: one,
        single: one,
        then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => answer(query))
            .then(resolve, reject),
      }
      for (const method of ['eq', 'in', 'is', 'not', 'or', 'lt', 'lte', 'gte', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          query.filters.push([method, ...args])
          return builder
        }
      }
      return builder
    },
  }

  vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)
  return { queries }
}

function request(): Request {
  return new Request('http://cron.internal/api/cron/invoice-reminders')
}

async function run(): Promise<{ status: number; payload: Record<string, any> }> {
  const response = await GET(request())
  return { status: response.status, payload: await response.json() }
}

/** The owner's summary: the one email sent by the ordinary route. */
function summary(): { to: string; subject: string; text: string } {
  const calls = vi.mocked(sendEmail).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0] as { to: string; subject: string; text: string }
}

function updatesTo(queries: Query[], table: string): Row[] {
  return queries.filter((query) => query.table === table && query.op === 'update').map((query) => query.payload as Row)
}

function reminderColumnWrites(queries: Query[]): Row[] {
  return updatesTo(queries, 'invoices').filter(
    (payload) => 'reminder_first_sent_at' in payload || 'reminder_second_sent_at' in payload
  )
}

/** The run record as it was last saved. */
function savedRun(queries: Query[]): { status: unknown; state: Record<string, any> } {
  const saves = updatesTo(queries, 'cron_job_runs').filter((payload) => typeof payload.error_message === 'string')
  const last = saves[saves.length - 1]
  return { status: last.status, state: JSON.parse(last.error_message as string) }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(TUESDAY)
  vi.stubEnv('MICROSOFT_USER_EMAIL', OWNER)
  vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-10-01')
  vi.mocked(authorizeCronRequest).mockReturnValue({ authorized: true } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'summary-1' } as never)
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true, messageId: 'reminder-1' })
  vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' })
  vi.mocked(persistIdempotencyResponse).mockResolvedValue(undefined)
  vi.mocked(releaseIdempotencyClaim).mockResolvedValue(undefined)
  vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({
    to: 'accounts@acme.example',
    cc: ['director@acme.example'],
  })
  vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Jo')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('invoice reminders cron: who may run it and when', () => {
  it('refuses a request without the cron secret', async () => {
    vi.mocked(authorizeCronRequest).mockReturnValue({ authorized: false, reason: 'missing' } as never)
    fakeDb({ invoices: [invoice()] })

    const { status } = await run()

    expect(status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('does nothing at the weekend, whatever triggered it', async () => {
    // Saturday 17 October 2026.
    vi.setSystemTime(new Date('2026-10-17T09:30:00.000Z'))
    fakeDb({ invoices: [invoice()] })

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload).toMatchObject({ success: true, skipped: true, reason: 'not_a_weekday' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does nothing on a second trigger the same day, and says so', async () => {
    const { queries } = fakeDb({
      invoices: [invoice()],
      todayRun: { id: 'run-1', status: 'completed', started_at: '2026-10-13T09:30:00.000Z', error_message: null },
    })

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload).toMatchObject({ success: true, skipped: true, reason: 'already_completed', runKey: '2026-10-13' })
    expect(queries.some((query) => query.table === 'invoices')).toBe(false)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('leaves a run that is still in progress alone', async () => {
    fakeDb({
      invoices: [invoice()],
      todayRun: { id: 'run-1', status: 'running', started_at: '2026-10-13T09:29:00.000Z', error_message: null },
    })

    const { payload } = await run()

    expect(payload).toMatchObject({ skipped: true, reason: 'already_running' })
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('takes over a failed run and still reports what it had already sent', async () => {
    const { queries } = fakeDb({
      invoices: [],
      todayRun: {
        id: 'run-1',
        status: 'failed',
        started_at: '2026-10-13T09:30:00.000Z',
        error_message: JSON.stringify({
          v: 1,
          sent: [
            { invoiceNumber: 'INV-0090', clientName: 'Earlier Ltd', to: 'pay@earlier.example', stage: 'first', date: '2026-10-13' },
          ],
          problems: [],
          needs_you_keys: [],
          summary: 'pending',
          error: 'database unavailable',
        }),
      },
    })

    const { payload } = await run()

    expect(payload.success).toBe(true)
    expect(summary().text).toContain('- INV-0090, Earlier Ltd: first reminder to pay@earlier.example')
    expect(savedRun(queries).status).toBe('completed')
  })
})

describe('invoice reminders cron: the switch', () => {
  it('emails no customer while the go-live date is unset, and lists the invoice under Needs you', async () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '')
    const { queries } = fakeDb({ invoices: [invoice()] })

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload.reminders_on).toBe(false)
    expect(payload.results).toMatchObject({ processed: 1, reminders_sent: 0, needs_you: 1, summary: 'accepted' })
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toEqual([])

    const email = summary()
    expect(email.to).toBe(OWNER)
    expect(email.text).toContain('Automatic reminders are switched off, so no customer was emailed.')
    expect(email.text).toContain('Needs you')
    expect(email.text).toContain(
      '- INV-0101, Acme Events Ltd: £1,200.00 owed. 7 days overdue. Automatic reminders are switched off: chase by hand'
    )
    expect(email.text).toContain(`${APP_URL}/invoices/inv-1`)
    expect(email.text).not.toContain('accounts@acme.example')
    assertCleanText(email.subject)
    assertCleanText(email.text)
  })

  it('still marks the invoice overdue while the switch is off', async () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '')
    const { queries } = fakeDb({ invoices: [invoice()] })

    const { payload } = await run()

    expect(payload.results.marked_overdue).toBe(1)
    expect(updatesTo(queries, 'invoices')).toEqual([expect.objectContaining({ status: 'overdue' })])
  })

  it('treats a mistyped date as off', async () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '13/10/2026')
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })
})

describe('invoice reminders cron: sending', () => {
  it('sends the first reminder, records it on the invoice and closes the claim', async () => {
    const { queries } = fakeDb({ invoices: [invoice()] })

    const { payload } = await run()

    expect(payload.results).toMatchObject({ reminders_sent: 1, problems: 0, summary: 'accepted' })

    expect(claimIdempotencyKey).toHaveBeenCalledTimes(1)
    const [, claimKey, claimHash, ttlHours, staleAfterMs] = vi.mocked(claimIdempotencyKey).mock.calls[0]
    expect(claimKey).toBe('invoice-reminder:v2:inv-1:first')
    // The hash covers the invoice and the stage only, never the days overdue.
    expect(claimHash).toBe('hash:{"invoice_id":"inv-1","stage":"first"}')
    expect(ttlHours).toBe(24 * 45)
    // A claim left part way is never taken over as abandoned.
    expect(staleAfterMs).toBe(45 * 24 * 60 * 60 * 1000)

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    const [sentInvoice, to, subject, body, cc, attachments, options] = vi.mocked(sendInvoiceEmail).mock.calls[0]
    expect(sentInvoice.id).toBe('inv-1')
    expect(to).toBe('accounts@acme.example')
    expect(subject).toBe('Invoice INV-0101: a quick reminder')
    expect(body).toContain('Hi Jo,')
    expect(body).toContain('£1,200.00 was due on Tuesday 6 October')
    expect(cc).toEqual(['director@acme.example'])
    expect(attachments).toBeUndefined()
    expect(options).toEqual({ emailKind: 'reminder_first' })
    assertCleanText(String(subject))
    assertCleanText(String(body))

    expect(reminderColumnWrites(queries)).toEqual([{ reminder_first_sent_at: '2026-10-13T09:30:00.000Z' }])
    // Written only where the column is still empty.
    const write = queries.find((query) => query.op === 'update' && 'reminder_first_sent_at' in (query.payload as Row))
    expect(write?.filters).toContainEqual(['is', 'reminder_first_sent_at', null])

    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-reminder:v2:inv-1:first',
      claimHash,
      expect.objectContaining({ state: 'processed', stage: 'first' }),
      24 * 45
    )
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()

    const logRows = queries.find((query) => query.table === 'invoice_email_logs')?.payload as Row[]
    expect(logRows.map((row) => row.sent_to)).toEqual(['accounts@acme.example', 'director@acme.example'])
    expect(logRows[0]).toMatchObject({ invoice_id: 'inv-1', status: 'sent', subject, body: 'First reminder, 7 days overdue' })

    const email = summary()
    expect(email.to).toBe(OWNER)
    expect(email.text).toContain('Sent today')
    expect(email.text).toContain('- INV-0101, Acme Events Ltd: first reminder to accounts@acme.example')
    // The copied address is not in the summary: only the To address of a sent reminder is.
    expect(email.text).not.toContain('director@acme.example')
    assertCleanText(email.subject)
    assertCleanText(email.text)

    expect(savedRun(queries)).toMatchObject({ status: 'completed', state: { summary: 'accepted' } })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('sends the second reminder once the first is a week old', async () => {
    // Due Friday 25 September: 18 days overdue. First reminder went on Friday 2 October.
    const { queries } = fakeDb({
      invoices: [invoice({ due_date: '2026-09-25', reminder_first_sent_at: '2026-10-02T09:31:00.000Z' })],
    })
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-09-01')

    await run()

    const [, , subject, body, , , options] = vi.mocked(sendInvoiceEmail).mock.calls[0]
    expect(subject).toBe('Invoice INV-0101: still outstanding')
    expect(body).toContain('it was due on Friday 25 September')
    expect(options).toEqual({ emailKind: 'reminder_second' })
    expect(vi.mocked(claimIdempotencyKey).mock.calls[0][1]).toBe('invoice-reminder:v2:inv-1:second')
    expect(reminderColumnWrites(queries)).toEqual([{ reminder_second_sent_at: '2026-10-13T09:30:00.000Z' }])
  })

  it('releases the claim when the send is refused, records nothing and lists it under Problems', async () => {
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Recipient email address is suppressed' })
    const { queries } = fakeDb({ invoices: [invoice()] })

    const { payload } = await run()

    expect(payload.results).toMatchObject({ reminders_sent: 0, problems: 1 })
    expect(releaseIdempotencyClaim).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-reminder:v2:inv-1:first',
      'hash:{"invoice_id":"inv-1","stage":"first"}'
    )
    expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toEqual([])
    expect(queries.some((query) => query.table === 'invoice_email_logs')).toBe(false)
    // A failed customer send raises an alert as well as a line in the summary.
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(reportCronFailure).toHaveBeenCalledWith(
      'invoice-reminders',
      expect.objectContaining({ message: expect.stringContaining('One invoice reminder could not be sent') }),
      { run: '2026-10-13', invoices: 'INV-0101' }
    )

    const email = summary()
    expect(email.text).toContain('Problems')
    expect(email.text).toContain(
      '- INV-0101, Acme Events Ltd: The first reminder was refused and nothing was sent: Recipient email address is suppressed. The next run will try again'
    )
    expect(email.text).not.toContain('Sent today')
    // It is still due, so the forecast says the next run will try it.
    expect(email.text).toContain('Going next')
    assertCleanText(email.text)
  })

  it('keeps the claim when the send throws, and never retries it', async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error('socket hang up'))
    const { queries } = fakeDb({ invoices: [invoice()] })

    await run()

    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-reminder:v2:inv-1:first',
      expect.any(String),
      expect.objectContaining({ state: 'outcome_unknown' }),
      24 * 45
    )
    expect(reminderColumnWrites(queries)).toEqual([])
    expect(reportCronFailure).toHaveBeenCalledWith('invoice-reminders', expect.any(Error), {
      run: '2026-10-13',
      invoices: 'INV-0101',
    })

    const email = summary()
    expect(email.text).toContain('The first reminder may or may not have been sent (socket hang up)')
    expect(email.text).toContain('Check Sent Items before chasing')
    // Not forecast: nothing more will be sent for it automatically.
    expect(email.text).not.toContain('Going next')
  })

  it('treats a dropped connection reported as a failure as unknown, not as refused', async () => {
    // sendInvoiceEmail catches a dropped connection and reports it as a plain failure. The
    // email may still have reached the mailbox, so the claim must not be released.
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'TypeError: fetch failed' })
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ state: 'outcome_unknown' }),
      24 * 45
    )
    expect(summary().text).toContain('Check Sent Items before chasing')
  })

  it('counts an email the provider accepted as sent even when its log row failed', async () => {
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Email logging failed', messageId: 'accepted-1' })
    const { queries } = fakeDb({ invoices: [invoice()] })

    await run()

    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toHaveLength(1)
    expect(summary().text).toContain('Sent today')
  })

  it('keeps the claim when the email went but could not be recorded, and never sends it again', async () => {
    const scenario: Scenario = { invoices: [invoice()], failReminderColumnWrite: true }
    fakeDb(scenario)

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-reminder:v2:inv-1:first',
      expect.any(String),
      expect.objectContaining({ state: 'sent_not_recorded', accepted_at: '2026-10-13T09:30:00.000Z' }),
      24 * 45
    )
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const first = summary()
    expect(first.text).toContain('Sent today')
    expect(first.text).toContain(
      'The first reminder was sent to accounts@acme.example, but the app could not record it (connection reset by peer). It will not be sent again'
    )

    // Wednesday: the column is still empty, so the rules say send. The kept claim says no.
    vi.setSystemTime(new Date('2026-10-14T09:30:00.000Z'))
    vi.mocked(sendEmail).mockClear()
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'replay', response: { state: 'sent_not_recorded' } })
    scenario.failReminderColumnWrite = false
    fakeDb(scenario)

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    // Nothing was attempted on the second day, so there is no second alert.
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const second = summary()
    expect(second.text).toContain('Needs you')
    expect(second.text).toContain('An earlier attempt to send the first reminder has an unknown outcome')
    expect(second.text).toContain('Check Sent Items before chasing')
    expect(second.text).not.toContain('Going next')
  })

  it('sends nothing when an earlier attempt is still marked in progress', async () => {
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'in_progress' })
    const { queries } = fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toEqual([])
    expect(summary().text).toContain('An earlier attempt to send the first reminder has an unknown outcome')
  })

  it('sends nothing and reports a problem when the claim cannot be taken', async () => {
    vi.mocked(claimIdempotencyKey).mockRejectedValue(new Error('database unavailable'))
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(summary().text).toContain('Could not take the send lock, so nothing was sent: database unavailable')
  })
})

describe('invoice reminders cron: who is left alone', () => {
  it('never emails a private hire invoice', async () => {
    fakeDb({ invoices: [invoice()], privateHireInvoiceIds: ['inv-1'] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(summary().text).toContain('7 days overdue. Private hire: chase by hand')
  })

  it('sends one email when a client has two invoices due a reminder, the oldest first', async () => {
    const { queries } = fakeDb({
      invoices: [
        invoice({ id: 'inv-2', invoice_number: 'INV-0102', due_date: '2026-10-07' }),
        invoice({ id: 'inv-1', invoice_number: 'INV-0101', due_date: '2026-10-06' }),
      ],
    })

    const { payload } = await run()

    expect(payload.results.reminders_sent).toBe(1)
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0].id).toBe('inv-1')
    expect(reminderColumnWrites(queries)).toHaveLength(1)
    // The second invoice waits out the three quiet days, so it is not forecast for tomorrow.
    expect(summary().text).not.toContain('Going next')
  })

  it('stops when a fresh read shows the invoice has been paid', async () => {
    const { queries } = fakeDb({
      invoices: [invoice()],
      fresh: { 'inv-1': invoice({ status: 'paid', paid_amount: 1200 }) },
    })

    const { payload } = await run()

    expect(payload.results.reminders_sent).toBe(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toEqual([])
  })

  it('stops when a fresh read shows a hold was set', async () => {
    fakeDb({
      invoices: [invoice()],
      fresh: { 'inv-1': invoice({ reminders_held_until: '2026-10-13' }) },
    })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('sends nothing and reports a problem when the fresh read fails', async () => {
    fakeDb({ invoices: [invoice()], failFreshRead: true })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(summary().text).toContain('Could not re-check the invoice before sending, so nothing was sent')
  })

  it('waits when the client was sent another invoice email yesterday', async () => {
    fakeDb({
      invoices: [invoice()],
      emails: [
        {
          invoice_id: 'inv-9',
          subject: 'Just checking in on invoice INV-0099',
          status: 'sent',
          metadata: { email_kind: 'chase', invoice_number: 'INV-0099' },
          created_at: '2026-10-12T14:00:00.000Z',
          sent_at: '2026-10-12T14:00:00.000Z',
        },
      ],
    })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('is not held back by an old internal alert or a failed email', async () => {
    fakeDb({
      invoices: [invoice()],
      emails: [
        {
          invoice_id: 'inv-1',
          subject: '[First Reminder] Invoice INV-0101 - Acme Events Ltd - £1200.00 overdue',
          status: 'sent',
          metadata: { invoice_number: 'REMINDER: INV-0101' },
          created_at: '2026-10-12T09:00:00.000Z',
          sent_at: '2026-10-12T09:00:00.000Z',
        },
        {
          invoice_id: 'inv-1',
          subject: 'Invoice INV-0101 from Orange Jelly',
          status: 'failed',
          metadata: { email_kind: 'invoice' },
          created_at: '2026-10-12T10:00:00.000Z',
          sent_at: null,
        },
      ],
    })

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('waits when another of the client invoices was first emailed yesterday', async () => {
    fakeDb({
      invoices: [
        invoice(),
        // Not overdue long enough for a reminder of its own, but emailed on Monday.
        invoice({ id: 'inv-3', invoice_number: 'INV-0103', due_date: '2026-10-12', sent_at: '2026-10-12T08:00:00.000Z' }),
      ],
    })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('lists an invoice with no address under Needs you and takes no claim', async () => {
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ to: null, cc: [] })
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    const email = summary()
    expect(email.text).toContain('Needs you')
    expect(email.text).toContain('There is no email address on the client record or its contacts')
  })

  it('reports a problem when the recipients cannot be read', async () => {
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ error: 'permission denied' })
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(summary().text).toContain('Could not read who to send to, so nothing was sent: permission denied')
  })

  it('leaves an invoice that fell due before go-live to the owner', async () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-10-07')
    fakeDb({ invoices: [invoice()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(summary().text).toContain('Fell due before automatic reminders were switched on: chase by hand')
  })
})

describe('invoice reminders cron: the summary', () => {
  const needsYouRun = (runKey: string, keys: string[], delivery = 'accepted'): Row => ({
    run_key: runKey,
    status: 'completed',
    error_message: JSON.stringify({ v: 1, sent: [], problems: [], needs_you_keys: keys, summary: delivery }),
  })

  it('does not repeat an unchanged Needs you list on a Tuesday, and sends nothing at all', async () => {
    const { queries } = fakeDb({
      invoices: [invoice()],
      privateHireInvoiceIds: ['inv-1'],
      earlierRuns: [needsYouRun('2026-10-12', ['inv-1:private_hire'])],
    })

    const { payload } = await run()

    expect(sendEmail).not.toHaveBeenCalled()
    expect(payload.results).toMatchObject({ needs_you: 1, summary: 'not_needed' })
    expect(savedRun(queries).state).toMatchObject({ summary: 'not_needed', needs_you_keys: ['inv-1:private_hire'] })
  })

  it('shows the same list again on a Monday', async () => {
    // Monday 19 October 2026: the invoice is 13 days overdue.
    vi.setSystemTime(new Date('2026-10-19T09:30:00.000Z'))
    fakeDb({
      invoices: [invoice()],
      privateHireInvoiceIds: ['inv-1'],
      earlierRuns: [needsYouRun('2026-10-16', ['inv-1:private_hire'])],
    })

    await run()

    const email = summary()
    expect(email.text).toContain('Needs you')
    expect(email.text).toContain('13 days overdue. Private hire: chase by hand')
  })

  it('shows the list on a Tuesday when it has changed', async () => {
    fakeDb({
      invoices: [invoice()],
      privateHireInvoiceIds: ['inv-1'],
      earlierRuns: [needsYouRun('2026-10-12', ['inv-other:overdue_21_days'])],
    })

    await run()

    expect(summary().text).toContain('Needs you')
  })

  it('drops a held invoice from Needs you', async () => {
    fakeDb({
      invoices: [invoice({ reminders_held_until: '2026-10-20' })],
      privateHireInvoiceIds: ['inv-1'],
    })

    const { payload } = await run()

    expect(payload.results.needs_you).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('lists a draft dated today or earlier that was never emailed', async () => {
    fakeDb({
      invoices: [],
      drafts: [
        { id: 'draft-1', invoice_number: 'INV-0200', invoice_date: '2026-10-09', status: 'draft', sent_at: null, client: { name: 'Beta Ltd' } },
      ],
    })

    await run()

    const email = summary()
    expect(email.text).toContain(
      '- INV-0200, Beta Ltd: A draft dated Friday 9 October that has not been emailed. Send it from the invoice page, or delete it'
    )
    expect(email.text).toContain(`${APP_URL}/invoices/draft-1`)
    assertCleanText(email.text)
  })

  it('forecasts tomorrow under Going next, with a link to hold it', async () => {
    // Due Friday 9 October: four days overdue today, five tomorrow.
    fakeDb({ invoices: [invoice({ due_date: '2026-10-09' })] })

    const { payload } = await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(payload.results.going_next).toBe(1)
    const email = summary()
    expect(email.text).toContain('Going next')
    expect(email.text).toContain('A forecast for Wednesday 14 October, not a promise')
    expect(email.text).toContain('- INV-0101, Acme Events Ltd: first reminder')
    expect(email.text).toContain(`${APP_URL}/invoices/inv-1`)
    assertCleanText(email.text)
  })

  it('raises an alert when the summary cannot be sent, and carries it into the next one', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Email sending is currently suspended' } as never)
    const { queries } = fakeDb({ invoices: [invoice()] })

    const { payload } = await run()

    // The reminder still went, and the run still counts as done.
    expect(payload.results).toMatchObject({ reminders_sent: 1, summary: 'failed' })
    expect(reportCronFailure).toHaveBeenCalledWith(
      'invoice-reminders',
      expect.objectContaining({ message: expect.stringContaining('The daily summary could not be sent') }),
      expect.anything()
    )
    const saved = savedRun(queries)
    expect(saved.status).toBe('completed')
    expect(saved.state.summary).toBe('failed')
    expect(saved.state.sent).toHaveLength(1)

    // Wednesday: nothing new, but yesterday's results have not reached the owner yet.
    vi.setSystemTime(new Date('2026-10-14T09:30:00.000Z'))
    vi.mocked(sendEmail).mockClear()
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'summary-2' } as never)
    fakeDb({
      invoices: [],
      earlierRuns: [{ run_key: '2026-10-13', status: 'completed', error_message: JSON.stringify(saved.state) }],
    })

    await run()

    const email = summary()
    expect(email.text).toContain('Not reported before')
    expect(email.text).toContain('- Tuesday 13 October: INV-0101, Acme Events Ltd: first reminder to accounts@acme.example')
    assertCleanText(email.text)
  })

  it('marks the run failed and raises an alert on a fatal error', async () => {
    const { queries } = fakeDb({ invoices: [invoice()], failInvoiceLoad: true })

    const { status, payload } = await run()

    expect(status).toBe(500)
    expect(payload.error).toBe('Failed to process invoice reminders')
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(reportCronFailure).toHaveBeenCalledWith('invoice-reminders', expect.any(Error))
    expect(savedRun(queries)).toMatchObject({ status: 'failed', state: { summary: 'pending' } })
  })

  it('answers with counts only, never a name or an address', async () => {
    fakeDb({ invoices: [invoice()] })

    const { payload } = await run()

    const text = JSON.stringify(payload)
    expect(text).not.toContain('acme')
    expect(text).not.toContain('Acme')
    expect(text).not.toContain('INV-0101')
  })
})
