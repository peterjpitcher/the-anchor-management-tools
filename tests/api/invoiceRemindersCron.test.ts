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
// Used only for an email covering several invoices: the first invoice's PDF is the sender's.
vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: vi.fn(async (invoice: { invoice_number: string }) => Buffer.from(`pdf:${invoice.invoice_number}`)),
}))
vi.mock('@/lib/invoices/payment-link-footer', () => ({
  invoiceCanOfferPayPal: vi.fn((invoice: { vendor?: { paypal_payments_enabled?: boolean } }) =>
    Boolean(invoice.vendor?.paypal_payments_enabled)
  ),
  invoicePortalUrl: vi.fn((invoiceId: string) => `https://management.example.test/invoice-portal/token-${invoiceId}`),
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
import { generateInvoicePDF } from '@/lib/pdf-generator'
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
  /** The booking each private hire invoice is linked to, by invoice id. */
  bookingIdByInvoice?: Record<string, string>
  /** Private bookings: `id`, `status` and, for a booking's own invoice, `invoice_id`. */
  privateBookings?: Row[]
  emails?: Row[]
  drafts?: Row[]
  earlierRuns?: Row[]
  /** A run record that already exists for today. */
  todayRun?: Row | null
  failInvoiceLoad?: boolean
  /** The re-read immediately before a send fails. */
  failFreshRead?: boolean
  failReminderColumnWrite?: boolean
  /** Receipt vendors linked to the client, bank payments in and their invoice matches. */
  receiptVendors?: Row[]
  bankPayments?: Row[]
  receiptMatches?: Row[]
  /** Reading the client's bank payments fails. */
  failBankCheck?: boolean
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
        const writesReminder =
          'reminder_first_sent_at' in payload ||
          'reminder_second_sent_at' in payload ||
          'reminder_last_weekly_sent_at' in payload
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
      return ok(
        (scenario.privateHireInvoiceIds ?? []).map((invoice_id) => ({
          invoice_id,
          booking_id: scenario.bookingIdByInvoice?.[invoice_id] ?? null,
        }))
      )
    }
    if (query.table === 'private_bookings') {
      const byInvoice = has(query, 'in', 'invoice_id')?.[2] as string[] | undefined
      const byBooking = has(query, 'in', 'id')?.[2] as string[] | undefined
      return ok(
        (scenario.privateBookings ?? []).filter(
          (booking) =>
            (byInvoice && byInvoice.includes(booking.invoice_id as string)) ||
            (byBooking && byBooking.includes(booking.id as string))
        )
      )
    }
    if (query.table === 'email_messages') return ok(scenario.emails ?? [])
    if (query.table === 'invoice_email_logs') return ok(null)
    if (query.table === 'receipt_vendors') {
      return scenario.failBankCheck
        ? { data: null, error: { message: 'connection reset' } }
        : ok(scenario.receiptVendors ?? [])
    }
    if (query.table === 'receipt_transactions') return ok(scenario.bankPayments ?? [])
    if (query.table === 'receipt_invoice_matches') return ok(scenario.receiptMatches ?? [])

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

/** A run record's `result` column is jsonb, so it comes back as the object that was saved. */
function asSaved<T>(state: T): T {
  return state
}

function updatesTo(queries: Query[], table: string): Row[] {
  return queries.filter((query) => query.table === table && query.op === 'update').map((query) => query.payload as Row)
}

function reminderColumnWrites(queries: Query[]): Row[] {
  return updatesTo(queries, 'invoices').filter(
    (payload) =>
      'reminder_first_sent_at' in payload ||
      'reminder_second_sent_at' in payload ||
      'reminder_last_weekly_sent_at' in payload
  )
}

/** The run record as it was last saved. */
function savedRun(queries: Query[]): { status: unknown; state: Record<string, any> } {
  const saves = updatesTo(queries, 'cron_job_runs').filter(
    (payload) => payload.result !== null && typeof payload.result === 'object'
  )
  const last = saves[saves.length - 1]
  return { status: last.status, state: last.result as Record<string, any> }
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
      todayRun: { id: 'run-1', status: 'completed', started_at: '2026-10-13T09:30:00.000Z', result: null },
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
      todayRun: { id: 'run-1', status: 'running', started_at: '2026-10-13T09:29:00.000Z', result: null },
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
        result: asSaved({
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

  it('treats a failure the sender marks as uncertain as unknown, not as refused', async () => {
    // sendInvoiceEmail never throws. A dropped connection after the request left comes back as
    // a failure marked `uncertain`: the email may have reached the mailbox, so the claim must
    // not be released.
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'TypeError: fetch failed', uncertain: true })
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
    result: asSaved({ v: 1, sent: [], problems: [], needs_you_keys: keys, summary: delivery }),
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
      earlierRuns: [{ run_key: '2026-10-13', status: 'completed', result: asSaved(saved.state) }],
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

// The list the owner approves before INVOICE_REMINDERS_GO_LIVE_DATE is set. It has to be safe
// to run against production at any time, so it must read and do nothing else.
describe('go-live preview', () => {
  async function preview(query: string): Promise<{ status: number; payload: Record<string, any> }> {
    const response = await GET(new Request(`http://cron.internal/api/cron/invoice-reminders?${query}`))
    return { status: response.status, payload: await response.json() }
  }

  it('says what a run would send, and sends, records and changes nothing', async () => {
    // The switch itself is off: the preview answers for the date it is given.
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '')
    const { queries } = fakeDb({
      invoices: [
        invoice(),
        invoice({ id: 'inv-2', invoice_number: 'INV-0102', due_date: '2026-10-07' }),
        invoice({ id: 'inv-3', invoice_number: 'INV-0103', vendor_id: 'vendor-2', due_date: '2026-09-01', vendor: { id: 'vendor-2', name: 'Older Ltd', email: 'pay@older.example' } }),
        invoice({ id: 'inv-4', invoice_number: 'INV-0104', vendor_id: 'vendor-3', vendor: { id: 'vendor-3', name: 'Party Guest', email: 'guest@example.com' } }),
      ],
      privateHireInvoiceIds: ['inv-4'],
    })

    const { status, payload } = await preview('preview=true&go_live=2026-10-01')

    expect(status).toBe(200)
    expect(payload).toMatchObject({ preview: true, nothing_was_sent_or_changed: true, as_of: '2026-10-13', go_live_date: '2026-10-01' })
    expect(payload.would_send).toEqual([
      { invoice_number: 'INV-0101', client: 'Acme Events Ltd', days_overdue: 7, balance: '£1,200.00', reminder: 'first', has_address: true },
    ])
    // The same client's second invoice waits: one reminder per client per run.
    expect(payload.waiting).toEqual([
      expect.objectContaining({ invoice_number: 'INV-0102', why: 'one_reminder_per_client_per_run' }),
    ])
    expect(payload.needs_you.map((entry: { invoice_number: string }) => entry.invoice_number).sort()).toEqual(['INV-0103', 'INV-0104'])
    // No customer address ever appears in the output.
    expect(JSON.stringify(payload)).not.toContain('@')

    expect(queries.every((query) => query.op === 'select')).toBe(true)
    expect(queries.some((query) => query.table === 'cron_job_runs')).toBe(false)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })

  it('refuses a go-live date it cannot read rather than guess one', async () => {
    fakeDb({ invoices: [invoice()] })

    for (const query of ['preview=true', 'preview=true&go_live=13/10/2026', 'preview=true&go_live=2026-02-31']) {
      const { status, payload } = await preview(query)
      expect(status).toBe(400)
      expect(payload.error).toContain('go_live')
    }
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  // A person asking for a preview and getting it slightly wrong must never trigger a real run:
  // that would use up the day's run and, once live, email customers.
  it('refuses any other query rather than fall through to a real run', async () => {
    const { queries } = fakeDb({ invoices: [invoice()] })

    for (const query of ['preview=1', 'preview=yes&go_live=2026-10-01', 'previw=true&go_live=2026-10-01', 'go_live=2026-10-01']) {
      const { status, payload } = await preview(query)
      expect(status).toBe(400)
      expect(payload.error).toContain('preview=true')
    }
    expect(queries).toHaveLength(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('can answer for another day', async () => {
    fakeDb({ invoices: [invoice({ due_date: '2026-10-12' })] })

    // Due Monday 12 October: five days overdue on Saturday the 17th, not a run day.
    const saturday = await preview('preview=true&go_live=2026-10-01&as_of=2026-10-17')
    expect(saturday.payload).toMatchObject({ as_of: '2026-10-17', is_a_run_day: false })

    const monday = await preview('preview=true&go_live=2026-10-01&as_of=2026-10-19')
    expect(monday.payload.is_a_run_day).toBe(true)
    expect(monday.payload.would_send).toEqual([expect.objectContaining({ invoice_number: 'INV-0101', reminder: 'first', days_overdue: 7 })])
  })
})

describe('invoice reminders cron: a payment from the client waiting to be matched', () => {
  const linked = { receiptVendors: [{ id: 'receipt-vendor-1' }] }
  const paid = (overrides: Row = {}): Row => ({ id: 'bank-1', transaction_date: '2026-10-08', amount_in: 1200, ...overrides })

  it('holds the reminder and lists it under Needs you', async () => {
    const { queries } = fakeDb({ invoices: [invoice()], ...linked, bankPayments: [paid()] })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
    expect(reminderColumnWrites(queries)).toEqual([])
    const email = summary()
    expect(email.text).toContain('Needs you')
    expect(email.text).toContain(
      '£1,200.00 from this client arrived on Thursday 8 October 2026 and is not matched to an invoice yet, so no reminder was sent'
    )
  })

  it('holds the reminder while a person is asked to choose, and this invoice is one of the choices', async () => {
    fakeDb({
      invoices: [invoice()],
      ...linked,
      bankPayments: [paid({ amount_in: 2400 })],
      receiptMatches: [
        {
          receipt_transaction_id: 'bank-1',
          match_status: 'review_required',
          payload: { review_reason: 'several_invoices_fit', options: [{ kind: 'record', allocations: [{ invoice_id: 'inv-1' }] }] },
        },
      ],
    })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('sends when the payment is already matched to an invoice', async () => {
    fakeDb({
      invoices: [invoice()],
      ...linked,
      bankPayments: [paid()],
      receiptMatches: [{ receipt_transaction_id: 'bank-1', match_status: 'payment_recorded', payload: {} }],
    })

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('sends when the payment fits neither what is owed nor any choice', async () => {
    fakeDb({ invoices: [invoice()], ...linked, bankPayments: [paid({ amount_in: 50 })] })

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('sends nothing and says why when the bank cannot be checked', async () => {
    fakeDb({ invoices: [invoice()], failBankCheck: true })

    await run()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(summary().text).toContain('Could not check the bank for a payment from this client, so nothing was sent: connection reset')
  })
})


/**
 * Weekly chasers (owner decision, 29 October 2026): from 21 days overdue an unpaid invoice is
 * chased every week until it is paid, and a client gets ONE email per run covering every
 * invoice of theirs that is due, each attached. Tuesday 13 October 2026 falls in the week that
 * starts on Monday 12 October.
 */
describe('invoice reminders cron: weekly chasers', () => {
  // Due Tuesday 8 and Tuesday 15 September: 35 and 28 days overdue on the 13th, never chased.
  const OLDER = { id: 'inv-1', invoice_number: 'INV-0101', due_date: '2026-09-08', invoice_date: '2026-08-25' }
  const NEWER = { id: 'inv-2', invoice_number: 'INV-0102', due_date: '2026-09-15', invoice_date: '2026-09-01' }

  beforeEach(() => {
    vi.stubEnv('INVOICE_WEEKLY_REMINDERS_FROM', '2026-10-01')
  })

  function weeklyWrites(queries: Query[]): Query[] {
    return queries.filter(
      (query) => query.table === 'invoices' && query.op === 'update' && 'reminder_last_weekly_sent_at' in (query.payload as Row)
    )
  }

  it('sends a client one email for both unpaid invoices, each attached, and records both', async () => {
    const { queries } = fakeDb({ invoices: [invoice(NEWER), invoice(OLDER)] })

    const { payload } = await run()

    expect(payload).toMatchObject({ reminders_on: true, weekly_chasers_on: true })
    expect(payload.results).toMatchObject({ reminders_sent: 2, problems: 0, summary: 'accepted' })

    expect(vi.mocked(claimIdempotencyKey).mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['invoice-reminder:v2:inv-1:weekly:2026-10-12', 'hash:{"invoice_id":"inv-1","stage":"weekly","week":"2026-10-12"}'],
      ['invoice-reminder:v2:inv-2:weekly:2026-10-12', 'hash:{"invoice_id":"inv-2","stage":"weekly","week":"2026-10-12"}'],
    ])

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    const [lead, to, subject, body, cc, attachments, options] = vi.mocked(sendInvoiceEmail).mock.calls[0]
    expect(lead.id).toBe('inv-1')
    expect(to).toBe('accounts@acme.example')
    expect(cc).toEqual(['director@acme.example'])
    expect(subject).toBe('Overdue invoices from Orange Jelly: £2,400.00 to pay')
    expect(body).toContain('Hi Jo,')
    expect(body).toContain('INV-0101: £1,200.00, due Tuesday 8 September 2026\nINV-0102: £1,200.00, due Tuesday 15 September 2026\nTotal to pay: £2,400.00')
    expect(body).toContain('Copies are attached.')
    assertCleanText(String(subject))
    assertCleanText(String(body))
    expect(generateInvoicePDF).toHaveBeenCalledTimes(1)
    expect(attachments).toEqual([
      { name: 'invoice-INV-0102.pdf', contentType: 'application/pdf', buffer: Buffer.from('pdf:INV-0102') },
    ])
    // The client cannot pay online, so there is no pay link P.S. for either invoice.
    expect(options).toEqual({ emailKind: 'reminder_combined', coversInvoiceIds: ['inv-1', 'inv-2'], paymentLinkFooter: '' })

    const writes = weeklyWrites(queries)
    expect(writes.map((query) => has(query, 'eq', 'id')?.[2])).toEqual(['inv-1', 'inv-2'])
    expect(writes.map((query) => query.payload)).toEqual([
      { reminder_last_weekly_sent_at: '2026-10-13T09:30:00.000Z' },
      { reminder_last_weekly_sent_at: '2026-10-13T09:30:00.000Z' },
    ])
    // Always the latest, never only where empty: the seven-day clock runs from it.
    expect(writes.every((query) => !has(query, 'is', 'reminder_last_weekly_sent_at'))).toBe(true)

    const logRows = queries.find((query) => query.table === 'invoice_email_logs')?.payload as Row[]
    expect(logRows.map((row) => [row.invoice_id, row.sent_to])).toEqual([
      ['inv-1', 'accounts@acme.example'],
      ['inv-1', 'director@acme.example'],
      ['inv-2', 'accounts@acme.example'],
      ['inv-2', 'director@acme.example'],
    ])
    expect(logRows[0].body).toBe('Weekly reminder, 35 days overdue, in one email with 1 other invoice')

    const email = summary()
    expect(email.text).toContain('- INV-0101, Acme Events Ltd: weekly reminder to accounts@acme.example')
    expect(email.text).toContain('- INV-0102, Acme Events Ltd: weekly reminder to accounts@acme.example')
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('adds a pay link per invoice when the client can pay online', async () => {
    const vendor = { id: 'vendor-1', name: 'Acme Events Ltd', email: 'accounts@acme.example', paypal_payments_enabled: true }
    fakeDb({ invoices: [invoice({ ...OLDER, vendor }), invoice({ ...NEWER, vendor })] })

    await run()

    const options = vi.mocked(sendInvoiceEmail).mock.calls[0][6]
    expect(options?.paymentLinkFooter).toBe(
      '\n\nP.S. You can also pay these online by card or PayPal:\n' +
        'INV-0101: https://management.example.test/invoice-portal/token-inv-1\n' +
        'INV-0102: https://management.example.test/invoice-portal/token-inv-2'
    )
  })

  it('then waits a week: nothing later that week, the next email the week after', async () => {
    const scenario = { invoices: [invoice(OLDER), invoice(NEWER)] }
    fakeDb(scenario)
    await run()
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)

    // Friday 16 October: three days on, past the quiet days but not a week.
    vi.mocked(sendInvoiceEmail).mockClear()
    vi.mocked(sendEmail).mockClear()
    vi.setSystemTime(new Date('2026-10-16T09:30:00.000Z'))
    fakeDb(scenario)
    await run()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()

    // Tuesday 20 October: a week on, so both go again, under the new week's claims.
    vi.mocked(claimIdempotencyKey).mockClear()
    vi.setSystemTime(new Date('2026-10-20T09:30:00.000Z'))
    fakeDb(scenario)
    await run()
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(claimIdempotencyKey).mock.calls.map((call) => call[1])).toEqual([
      'invoice-reminder:v2:inv-1:weekly:2026-10-19',
      'invoice-reminder:v2:inv-2:weekly:2026-10-19',
    ])
  })

  it('counts a send with an unknown outcome as the week\'s email: kept, recorded, not retried that week', async () => {
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, uncertain: true, error: 'The request timed out' })
    const scenario = { invoices: [invoice(OLDER)] }
    const { queries } = fakeDb(scenario)

    await run()

    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-reminder:v2:inv-1:weekly:2026-10-12',
      expect.any(String),
      expect.objectContaining({ state: 'outcome_unknown', stage: 'weekly' }),
      24 * 45
    )
    expect(weeklyWrites(queries).map((query) => query.payload)).toEqual([
      { reminder_last_weekly_sent_at: '2026-10-13T09:30:00.000Z' },
    ])
    expect(summary().text).toContain("It counts as this week's, so the next one goes in a week. Check Sent Items")
    expect(reportCronFailure).toHaveBeenCalledTimes(1)

    // Wednesday 14 October: nothing, even though the claim helper would hand out a claim.
    vi.mocked(sendInvoiceEmail).mockClear()
    vi.setSystemTime(new Date('2026-10-14T09:30:00.000Z'))
    fakeDb(scenario)
    await run()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('hands back the claims of a refused email so the next run tries again', async () => {
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Mailbox unavailable (550)' })
    const { queries } = fakeDb({ invoices: [invoice(OLDER), invoice(NEWER)] })

    await run()

    expect(vi.mocked(releaseIdempotencyClaim).mock.calls.map((call) => call[1])).toEqual([
      'invoice-reminder:v2:inv-1:weekly:2026-10-12',
      'invoice-reminder:v2:inv-2:weekly:2026-10-12',
    ])
    expect(weeklyWrites(queries)).toEqual([])
    expect(summary().text).toContain('The weekly reminder was refused and nothing was sent: Mailbox unavailable (550). The next run will try again')
  })

  it('leaves out an invoice whose claim for this week is already held, and sends the rest', async () => {
    vi.mocked(claimIdempotencyKey).mockImplementation(async (_db, key) =>
      String(key).includes(':inv-1:') ? ({ state: 'in_progress' } as never) : ({ state: 'claimed' } as never)
    )
    const { queries } = fakeDb({ invoices: [invoice(OLDER), invoice(NEWER)] })

    await run()

    const [lead, , subject, body, , attachments, options] = vi.mocked(sendInvoiceEmail).mock.calls[0]
    expect(lead.id).toBe('inv-2')
    expect(subject).toBe('Invoice INV-0102 is overdue')
    expect(body).toContain("I'm writing again about invoice INV-0102. It was due on Tuesday 15 September 2026 and £1,200.00 is still to pay.")
    assertCleanText(String(body))
    expect(attachments).toBeUndefined()
    expect(options).toEqual({ emailKind: 'reminder_weekly' })
    expect(weeklyWrites(queries).map((query) => has(query, 'eq', 'id')?.[2])).toEqual(['inv-2'])
    expect(summary().text).toContain('An earlier attempt this week to send the weekly reminder has an unknown outcome')
  })

  it('puts a first reminder and a weekly one for the same client in the same email', async () => {
    const { queries } = fakeDb({
      invoices: [invoice(OLDER), invoice({ id: 'inv-3', invoice_number: 'INV-0103', due_date: '2026-10-06' })],
    })

    await run()

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][6]).toMatchObject({ emailKind: 'reminder_combined' })
    expect(reminderColumnWrites(queries)).toEqual([
      { reminder_last_weekly_sent_at: '2026-10-13T09:30:00.000Z' },
      { reminder_first_sent_at: '2026-10-13T09:30:00.000Z' },
    ])
    const text = summary().text
    expect(text).toContain('- INV-0101, Acme Events Ltd: weekly reminder to accounts@acme.example')
    expect(text).toContain('- INV-0103, Acme Events Ltd: first reminder to accounts@acme.example')
  })

  it('chases private hire from 21 days, but never the invoice of a cancelled booking', async () => {
    fakeDb({
      invoices: [invoice(OLDER)],
      privateHireInvoiceIds: ['inv-1'],
      privateBookings: [{ id: 'pb-1', invoice_id: 'inv-1', status: 'confirmed' }],
    })
    await run()
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][6]).toEqual({ emailKind: 'reminder_weekly' })

    vi.mocked(sendInvoiceEmail).mockClear()
    vi.mocked(sendEmail).mockClear()
    fakeDb({
      invoices: [invoice(OLDER)],
      privateHireInvoiceIds: ['inv-1'],
      bookingIdByInvoice: { 'inv-1': 'pb-2' },
      privateBookings: [{ id: 'pb-2', status: 'cancelled' }],
    })
    await run()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(summary().text).toContain('Its private booking was cancelled, so it is not chased: settle it with a credit note')
  })

  it('changes nothing without the switch: the owner still takes these', async () => {
    vi.stubEnv('INVOICE_WEEKLY_REMINDERS_FROM', '')
    const { queries } = fakeDb({ invoices: [invoice(OLDER)] })

    const { payload } = await run()

    expect(payload.weekly_chasers_on).toBe(false)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(queries.some((query) => query.table === 'private_bookings')).toBe(false)
    expect(summary().text).toContain('Fell due before automatic reminders were switched on: chase by hand')
  })

  it('previews every invoice the one email would cover, and sends nothing', async () => {
    vi.stubEnv('INVOICE_WEEKLY_REMINDERS_FROM', '')
    const { queries } = fakeDb({ invoices: [invoice(OLDER), invoice(NEWER)] })

    const response = await GET(
      new Request('http://cron.internal/api/cron/invoice-reminders?preview=true&go_live=2026-10-01&weekly_from=2026-10-01')
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ weekly_from: '2026-10-01', weekly_chasers_on: true, one_email_per_client: true })
    expect(payload.would_send.map((line: { invoice_number: string; reminder: string }) => [line.invoice_number, line.reminder])).toEqual([
      ['INV-0101', 'weekly'],
      ['INV-0102', 'weekly'],
    ])
    expect(queries.every((query) => query.op === 'select')).toBe(true)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })

  it('refuses a weekly date it cannot read', async () => {
    fakeDb({ invoices: [invoice(OLDER)] })

    const response = await GET(
      new Request('http://cron.internal/api/cron/invoice-reminders?preview=true&go_live=2026-10-01&weekly_from=2026-13-01')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'weekly_from must be a date written as YYYY-MM-DD' })
  })
})
