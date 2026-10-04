import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The email history behind the invoice page's "Emails" panel: who may read it, what it reads,
 * and what it leaves out.
 */

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
// The reminder job module is imported for its shared readers only; nothing here may send.
vi.mock('@/lib/microsoft-graph', () => ({ isGraphConfigured: vi.fn(() => true), sendInvoiceEmail: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: vi.fn(() => 'https://management.example.test') }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { sendEmail } from '@/lib/email/emailService'
import { getInvoiceEmailHistory } from '@/app/actions/invoice-reminders'

type Row = Record<string, unknown>
type Filter = [method: string, ...args: unknown[]]

interface Query {
  table: string
  filters: Filter[]
}

interface Scenario {
  invoice: Row | null
  emails?: Row[]
  isPrivateHire?: boolean
  todayRun?: Row | null
  failEmails?: boolean
  failBookingLink?: boolean
}

const INVOICE_ID = '7c1e4b2a-9d3f-4e6a-8b5c-1f2e3d4c5b6a'
const OWNER = 'peter@orangejelly.example'

function invoice(overrides: Row = {}): Row {
  return {
    id: INVOICE_ID,
    vendor_id: 'vendor-1',
    status: 'overdue',
    invoice_date: '2026-09-24',
    // Due Thursday 8 October: four days overdue on Monday 12th.
    due_date: '2026-10-08',
    total_amount: 1200,
    paid_amount: 0,
    sent_at: '2026-09-24T09:00:00.000Z',
    deleted_at: null,
    reminders_held_until: null,
    reminder_first_sent_at: null,
    reminder_second_sent_at: null,
    credits: [],
    ...overrides,
  }
}

function email(overrides: Row = {}): Row {
  return {
    id: 'email-1',
    to_address: 'accounts@acme.example',
    subject: 'Invoice INV-0101 from Orange Jelly',
    status: 'sent',
    error: null,
    created_at: '2026-09-24T09:00:00.000Z',
    sent_at: '2026-09-24T09:00:04.000Z',
    body_text: 'Hi Jo,\n\nInvoice INV-0101 is attached.',
    metadata: { invoice_number: 'INV-0101', email_kind: 'invoice', cc: ['director@acme.example'] },
    resend_message_id: null,
    ...overrides,
  }
}

function has(query: Query, method: string, column: string): boolean {
  return query.filters.some((filter) => filter[0] === method && filter[1] === column)
}

function seed(scenario: Scenario): Query[] {
  const queries: Query[] = []

  const answer = (query: Query): { data: unknown; error: { message: string } | null } => {
    switch (query.table) {
      case 'invoices':
        // The invoice itself is read by id. The other reads belong to the "recent emails to
        // this client" lookup, which finds nothing here.
        return { data: has(query, 'eq', 'id') ? scenario.invoice : [], error: null }
      case 'email_messages':
        if (!has(query, 'eq', 'invoice_id')) return { data: [], error: null }
        return scenario.failEmails
          ? { data: null, error: { message: 'statement timeout' } }
          : { data: scenario.emails ?? [], error: null }
      case 'private_booking_invoices':
        return scenario.failBookingLink
          ? { data: null, error: { message: 'permission denied' } }
          : { data: scenario.isPrivateHire ? { invoice_id: INVOICE_ID } : null, error: null }
      case 'cron_job_runs':
        return { data: scenario.todayRun ?? null, error: null }
      default:
        throw new Error(`Unexpected table ${query.table}`)
    }
  }

  const admin = {
    from(table: string) {
      const query: Query = { table, filters: [] }
      queries.push(query)
      const builder: Record<string, unknown> = {
        select: () => builder,
        maybeSingle: async () => answer(query),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => answer(query))
            .then(resolve, reject),
      }
      for (const method of ['eq', 'in', 'is', 'not', 'or', 'gte', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          query.filters.push([method, ...args])
          return builder
        }
      }
      return builder
    },
  }

  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  return queries
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Monday 12 October 2026, after the day's run.
  vi.setSystemTime(new Date('2026-10-12T11:00:00.000Z'))
  vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-10-01')
  vi.mocked(checkUserPermission).mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  // Reading the history must never send anything.
  expect(sendInvoiceEmail).not.toHaveBeenCalled()
  expect(sendEmail).not.toHaveBeenCalled()
})

describe('getInvoiceEmailHistory: access', () => {
  it('refuses a user without invoices view permission, before touching the database', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    seed({ invoice: invoice(), emails: [email()] })

    const result = await getInvoiceEmailHistory(INVOICE_ID)

    expect(result).toEqual({ error: 'You do not have permission to view invoices' })
    expect(checkUserPermission).toHaveBeenCalledWith('invoices', 'view')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('checks the permission on every call', async () => {
    seed({ invoice: invoice(), emails: [] })

    await getInvoiceEmailHistory(INVOICE_ID)
    await getInvoiceEmailHistory(INVOICE_ID)

    expect(checkUserPermission).toHaveBeenCalledTimes(2)
  })

  it.each(['', 'not-an-id', "1' or '1'='1", '7c1e4b2a-9d3f-4e6a-8b5c'])('returns nothing for a malformed id: %s', async (id) => {
    seed({ invoice: invoice(), emails: [email()] })

    expect(await getInvoiceEmailHistory(id)).toEqual({ history: null })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('returns nothing for an unknown or deleted invoice, and reads no emails for it', async () => {
    const queries = seed({ invoice: null, emails: [email()] })

    expect(await getInvoiceEmailHistory(INVOICE_ID)).toEqual({ history: null })

    const invoiceRead = queries.find((query) => query.table === 'invoices')
    expect(invoiceRead?.filters).toContainEqual(['eq', 'id', INVOICE_ID])
    expect(invoiceRead?.filters).toContainEqual(['is', 'deleted_at', null])
    expect(queries.some((query) => query.table === 'email_messages')).toBe(false)
  })

  it('says so when the emails cannot be read', async () => {
    seed({ invoice: invoice(), failEmails: true })

    expect(await getInvoiceEmailHistory(INVOICE_ID)).toEqual({ error: 'The email history could not be loaded' })
  })
})

describe('getInvoiceEmailHistory: what it shows', () => {
  it('reads outbound emails for the invoice, newest first, with a cap', async () => {
    const queries = seed({ invoice: invoice(), emails: [email()] })

    await getInvoiceEmailHistory(INVOICE_ID)

    const read = queries.find((query) => query.table === 'email_messages' && has(query, 'eq', 'invoice_id'))
    expect(read?.filters).toEqual([
      ['eq', 'invoice_id', INVOICE_ID],
      ['eq', 'direction', 'outbound'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 101],
    ])
  })

  it('leaves out internal alerts but keeps a genuine email to the owner address', async () => {
    seed({
      invoice: invoice(),
      emails: [
        email({
          id: 'alert',
          to_address: OWNER,
          subject: '[First Reminder] Invoice INV-0101 - Acme Events Ltd - £1200.00 overdue',
          metadata: { invoice_number: 'REMINDER: INV-0101', document_kind: 'invoice' },
        }),
        email({ id: 'to-owner', to_address: OWNER, metadata: { invoice_number: 'INV-0101', email_kind: 'invoice' } }),
        email({ id: 'to-customer' }),
      ],
    })

    const { history } = await getInvoiceEmailHistory(INVOICE_ID)

    expect(history?.emails.map((entry) => entry.id)).toEqual(['to-owner', 'to-customer'])
    expect(history?.emails[0].to).toBe(OWNER)
  })

  it('maps kinds, outcomes and copies', async () => {
    seed({
      invoice: invoice(),
      emails: [
        email({ id: 'first', subject: 'Invoice INV-0101: a quick reminder', metadata: { email_kind: 'reminder_first', cc: [] } }),
        email({
          id: 'old-receipt',
          subject: 'Receipt: Invoice INV-0101 (Paid)',
          status: 'delivered',
          resend_message_id: 're_1',
          metadata: { invoice_number: 'INV-0101', document_kind: 'remittance_advice' },
        }),
        email({ id: 'bounced', status: 'bounced', resend_message_id: 're_2' }),
        email({ id: 'refused', status: 'suppressed' }),
      ],
    })

    const { history } = await getInvoiceEmailHistory(INVOICE_ID)
    const byId = Object.fromEntries((history?.emails ?? []).map((entry) => [entry.id, entry]))

    expect(byId.first).toMatchObject({
      kindLabel: 'First reminder',
      kindInferred: false,
      outcome: 'Sent (delivery not tracked)',
      copies: [],
      sentAtLabel: '24 September 2026, 10:00',
      body: 'Hi Jo,\n\nInvoice INV-0101 is attached.',
    })
    expect(byId['old-receipt']).toMatchObject({ kindLabel: 'Receipt', kindInferred: true, outcome: 'Delivered', copies: null })
    expect(byId.bounced).toMatchObject({ outcome: 'Bounced', copies: ['director@acme.example'] })
    expect(byId.refused).toMatchObject({ outcome: 'Refused: the address is on the block list' })
  })

  it('flags a list that was cut short at the cap', async () => {
    seed({
      invoice: invoice(),
      emails: Array.from({ length: 101 }, (_, index) => email({ id: `email-${index}` })),
    })

    const { history } = await getInvoiceEmailHistory(INVOICE_ID)

    expect(history?.emails).toHaveLength(100)
    expect(history?.truncated).toBe(true)
  })

  it('gives the forecast line and the invoice record as a cross-check', async () => {
    seed({ invoice: invoice({ reminder_first_sent_at: null }), emails: [] })

    const { history } = await getInvoiceEmailHistory(INVOICE_ID)

    expect(history?.nextReminder).toEqual({
      line: 'Next automatic reminder: Tuesday 13 October (forecast)',
      detail: 'The first reminder. Everything is checked again before it is sent.',
    })
    expect(history?.crossCheck).toEqual([
      { label: 'Invoice emailed', value: 'Thursday 24 September 2026' },
      { label: 'First reminder', value: 'Not sent' },
      { label: 'Second reminder', value: 'Not sent' },
    ])
    expect(history?.earlierEmailsNotRecorded).toBe(false)
    expect(history?.emails).toEqual([])
  })

  it('points at today until the run for the day has happened', async () => {
    // Tuesday 13 October, 08:00 London: five days overdue and the 09:30 UTC run is still to come.
    vi.setSystemTime(new Date('2026-10-13T07:00:00.000Z'))
    seed({ invoice: invoice(), todayRun: null })

    const before = await getInvoiceEmailHistory(INVOICE_ID)
    expect(before.history?.nextReminder.line).toBe('Next automatic reminder: Tuesday 13 October (forecast)')

    seed({ invoice: invoice(), todayRun: { status: 'completed' } })

    const after = await getInvoiceEmailHistory(INVOICE_ID)
    expect(after.history?.nextReminder.line).toBe('Next automatic reminder: Wednesday 14 October (forecast)')
  })

  it('shows the hold, the reminder dates and the private hire rule', async () => {
    seed({ invoice: invoice({ reminders_held_until: '2026-10-20' }) })
    expect((await getInvoiceEmailHistory(INVOICE_ID)).history?.nextReminder.line).toBe('Reminders held until Tuesday 20 October')

    seed({
      invoice: invoice({
        due_date: '2026-09-25',
        // 23:30 UTC on 1 October is already 2 October in London.
        reminder_first_sent_at: '2026-10-01T23:30:00.000Z',
        reminder_second_sent_at: '2026-10-09T09:30:00.000Z',
      }),
    })
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-09-01')
    const bothSent = (await getInvoiceEmailHistory(INVOICE_ID)).history
    expect(bothSent?.nextReminder.line).toBe('No automatic reminders: both have been sent')
    expect(bothSent?.crossCheck).toEqual([
      { label: 'Invoice emailed', value: 'Thursday 24 September 2026' },
      { label: 'First reminder', value: 'Friday 2 October 2026' },
      { label: 'Second reminder', value: 'Friday 9 October 2026' },
    ])

    seed({ invoice: invoice(), isPrivateHire: true })
    expect((await getInvoiceEmailHistory(INVOICE_ID)).history?.nextReminder).toEqual({
      line: 'No automatic reminders: chase by hand',
      detail: '4 days overdue. Private hire: chase by hand.',
    })
  })

  it('says chase by hand while the switch is off', async () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '')
    seed({ invoice: invoice() })

    expect((await getInvoiceEmailHistory(INVOICE_ID)).history?.nextReminder.line).toBe('No automatic reminders: chase by hand')
  })

  it('makes no forecast when it cannot tell whether the invoice is private hire', async () => {
    seed({ invoice: invoice(), emails: [email()], failBookingLink: true })

    const { history } = await getInvoiceEmailHistory(INVOICE_ID)

    expect(history?.nextReminder.line).toBe('The next automatic reminder could not be worked out')
    // The emails themselves are still shown.
    expect(history?.emails).toHaveLength(1)
  })

  it('notes that earlier emails are missing for an invoice sent before 25 June 2026', async () => {
    seed({ invoice: invoice({ sent_at: '2026-06-24T22:30:00.000Z', invoice_date: '2026-06-24' }) })
    expect((await getInvoiceEmailHistory(INVOICE_ID)).history?.earlierEmailsNotRecorded).toBe(true)

    // 23:30 UTC on 24 June is 25 June in London: on the right side of the line.
    seed({ invoice: invoice({ sent_at: '2026-06-24T23:30:00.000Z', invoice_date: '2026-06-24' }) })
    expect((await getInvoiceEmailHistory(INVOICE_ID)).history?.earlierEmailsNotRecorded).toBe(false)

    // Never stamped as sent: the invoice date is the best evidence there is.
    seed({ invoice: invoice({ sent_at: null, invoice_date: '2026-03-01' }) })
    const unstamped = (await getInvoiceEmailHistory(INVOICE_ID)).history
    expect(unstamped?.earlierEmailsNotRecorded).toBe(true)
    expect(unstamped?.crossCheck[0]).toEqual({ label: 'Invoice emailed', value: 'No record' })
  })
})
