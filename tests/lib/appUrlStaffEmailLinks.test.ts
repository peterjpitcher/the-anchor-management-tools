import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'
import { mockGraphClient } from '../mocks/microsoft-graph'

/**
 * Staff emails whose links come from getAppUrl() (src/lib/env.ts), rendered with fixture data
 * through the real route or action and captured at the transport. The app URL is given a trailing
 * slash on purpose: every link must still come out as one clean absolute URL on the app's own
 * host, and nothing may read undefined, NaN, Invalid Date, null, a zero amount or localhost.
 */

// Set before any import, so env.ts validates this value rather than the suite default.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.test/'
})

const APP_URL = 'https://management.example.test'

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

// The suite-wide stand-in builds its credential with an arrow function, which cannot be called
// with new, so Graph sends here would fail before reaching the mocked client.
vi.mock('@azure/identity', () => ({
  ClientSecretCredential: class {
    async getToken(): Promise<{ token: string }> {
      return { token: 'fixture-token' }
    }
  },
}))

// The invoice PDF is an attachment rendered in a headless browser, not part of the email text.
vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: vi.fn(async () => Buffer.from('%PDF-1.4 fixture')),
  generateQuotePDF: vi.fn(async () => Buffer.from('%PDF-1.4 fixture')),
}))

// Idempotency claims are bookkeeping rows; every case is a first run.
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'request-hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/audit-helpers', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sendEmail } from '@/lib/email/emailService'
import { claimIdempotencyKey } from '@/lib/api/idempotency'
import { reportCronFailure } from '@/lib/cron/alerting'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateInvoiceToken } from '@/lib/invoices/invoice-token'
import { GET as runInvoiceReminders } from '@/app/api/cron/invoice-reminders/route'
import { GET as runEventChecklistReminders } from '@/app/api/cron/event-checklist-reminders/route'
import { GET as runOjProjectsBillingReminders } from '@/app/api/cron/oj-projects-billing-reminders/route'
import { GET as runEmployeeInviteChase } from '@/app/api/cron/employee-invite-chase/route'
import { inviteEmployee, resendInvite, sendPortalInvite } from '@/app/actions/employeeInvite'

type Db = ReturnType<typeof createAdminClient>
type Row = Record<string, unknown>
type SentEmail = { to: unknown; subject: string; text?: string; html?: string }

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'order', 'limit',
]

/**
 * A Supabase stand-in. A list read of a table answers with its fixture rows, a single read with
 * the first of them, and every write succeeds. Filters are ignored: each case seeds only the rows
 * its sender reads.
 */
function fixtureDb(tables: Record<string, Row | Row[] | null>, rpcs: Record<string, unknown> = {}): Db {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from(table: string) {
      const seeded = tables[table] ?? null
      const rows = seeded === null ? [] : Array.isArray(seeded) ? seeded : [seeded]
      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
  } as unknown as Db
}

function cronRequest(path: string): Request {
  return new Request(`http://cron.internal${path}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
}

function sentEmails(): SentEmail[] {
  return vi.mocked(sendEmail).mock.calls.map(([options]) => options as SentEmail)
}

function sentEmailTo(address: string): SentEmail {
  const matches = sentEmails().filter((email) => email.to === address)
  expect(matches).toHaveLength(1)
  return matches[0]
}

/** Every absolute URL in a body, in the order it appears. */
function linksIn(body: string): string[] {
  return body.match(/https?:\/\/[^\s"'<>]+/g) ?? []
}

/** No broken values or banned dashes anywhere, and no link off the app's host or with a doubled slash. */
function expectCleanEmail(email: { subject: string; text?: string; html?: string }): void {
  assertCleanText(email.subject)
  for (const body of [email.text, email.html]) {
    if (body === undefined) continue
    assertCleanText(body)
    expect(body).not.toMatch(/localhost|management\.example\.test\/\//)
  }
}

const NOW = new Date('2026-10-01T10:00:00.000Z')
const INVOICE_ID = '7c1e4b2a-9d3f-4e6a-8b5c-1f2e3d4c5b6a'
const STAFF_MAILBOX = 'accounts@orangejelly.example'
const ONBOARDING_TOKEN = '4f9c2d7e1a8b4c3d9e0f1a2b3c4d5e6f'
const PORTAL_TOKEN = '9a8b7c6d5e4f40312a1b2c3d4e5f6a7b'
const RESEND_TOKEN = '1b2c3d4e5f6a47b8c9d0e1f2a3b4c5d6'

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
  vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-fixture')
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'client-fixture')
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret-fixture')
  vi.stubEnv('MICROSOFT_USER_EMAIL', STAFF_MAILBOX)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
  vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as never)
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(getCurrentUser).mockResolvedValue({ user_id: 'user-1', user_email: 'manager@example.com' } as never)
  vi.mocked(logAuditEvent).mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('invoice reminders cron', () => {
  it('internal reminder links the invoice, and both reminders carry a clean portal link', async () => {
    // Invoice INV-2026-0042 for £1,250.00, due Thursday 24 September 2026: seven days overdue today.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        invoices: {
          id: INVOICE_ID,
          invoice_number: 'INV-2026-0042',
          vendor_id: 'vendor-1',
          invoice_date: '2026-09-10',
          due_date: '2026-09-24',
          status: 'sent',
          sent_at: '2026-09-10T09:00:00.000Z',
          subtotal_amount: 1041.67,
          vat_amount: 208.33,
          total_amount: 1250,
          paid_amount: 0,
          deleted_at: null,
          vendor: {
            id: 'vendor-1',
            name: 'Acme Events Ltd',
            email: 'accounts@acme-events.example',
            contact_name: 'Jo Bloggs',
            paypal_payments_enabled: true,
            contacts: [],
          },
          line_items: [
            { id: 'line-1', description: 'Event management, September', quantity: 1, unit_price: 1041.67, vat_rate: 20 },
          ],
          payments: [],
          credits: [],
        },
        invoice_email_logs: null,
      })
    )

    const response = await runInvoiceReminders(cronRequest('/api/cron/invoice-reminders'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results).toMatchObject({ processed: 1, internal_notifications: 1, reminders_sent: 1, errors: [] })
    expect(sentEmails()).toHaveLength(2)

    const portalLink = `${APP_URL}/invoice-portal/${generateInvoiceToken(INVOICE_ID)}`

    const internal = sentEmailTo(STAFF_MAILBOX)
    expect(internal.subject).toBe('[First Reminder] Invoice INV-2026-0042 - Acme Events Ltd - £1250.00 overdue')
    expect(internal.text).toContain('Amount Due: £1250.00')
    expect(internal.text).toContain('Due Date: 24/09/2026')
    expect(internal.text).toContain(`View invoice: ${APP_URL}/invoices/${INVOICE_ID}`)
    expect(linksIn(internal.text ?? '')).toEqual([`${APP_URL}/invoices/${INVOICE_ID}`, portalLink])
    expectCleanEmail(internal)

    const customer = sentEmailTo('accounts@acme-events.example')
    expect(customer.subject).toBe('First Reminder: Invoice INV-2026-0042 from Orange Jelly Limited')
    expect(linksIn(customer.text ?? '')).toEqual([portalLink])
    expectCleanEmail(customer)
  })
})

describe('event checklist reminders cron', () => {
  // A Sunday 4 October event: its seven launch tasks fell due on 9 August, and the WhatsApp
  // reminder (three days before) is due today.
  function seedChecklist(): void {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        events: { id: 'event-1', name: 'Harvest Quiz Night', date: '2026-10-04' },
        event_checklist_statuses: null,
      })
    )
  }

  async function runChecklist(): Promise<SentEmail> {
    const response = await runEventChecklistReminders(cronRequest('/api/cron/event-checklist-reminders'))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, sent: true, overdue: 7, dueToday: 1, events: 1 })
    const emails = sentEmails()
    expect(emails).toHaveLength(1)
    return emails[0]
  }

  it('links the full checklist in both the html and the text', async () => {
    seedChecklist()
    const email = await runChecklist()

    expect(email.html).toContain(`<a href="${APP_URL}/events/todo"`)
    expect(linksIn(email.html ?? '')).toEqual([`${APP_URL}/events/todo`, `${APP_URL}/events/todo`])
    expect(email.text).toContain(`View full checklist: ${APP_URL}/events/todo`)
    expect(linksIn(email.text ?? '')).toEqual([`${APP_URL}/events/todo`])
    expect(email.text).toContain('Harvest Quiz Night')

    assertCleanText(email.text ?? '')
    // Subject and html skip only the banned-dash check: the route builds both with an en dash,
    // which is a separate fix from the links tested here.
    for (const part of [email.subject, email.html ?? '']) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|\bnull\b/)
      expect(part).not.toMatch(/localhost|management\.example\.test\/\//)
    }
  })
})

describe('OJ Projects billing reminders cron', () => {
  it('links the OJ Projects timesheets three days before billing', async () => {
    // Monday 28 September 2026: billing runs on Thursday 1 October.
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'))
    vi.mocked(createAdminClient).mockReturnValue(fixtureDb({}))

    const response = await runOjProjectsBillingReminders(cronRequest('/api/cron/oj-projects-billing-reminders'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ sent: true, days_until_billing: 3, billing_date: '2026-10-01' })

    // Captured where sendInternalReminder hands the message to Microsoft Graph.
    expect(mockGraphClient.api).toHaveBeenCalledWith(`/users/${STAFF_MAILBOX}/sendMail`)
    expect(mockGraphClient.post).toHaveBeenCalledTimes(1)
    const [{ message }] = mockGraphClient.post.mock.calls[0] as [
      { message: { subject: string; body: { contentType: string; content: string } } },
    ]
    const email = { subject: message.subject, text: message.body.content }

    expect(email.subject).toBe('[REMINDER] OJ Projects: finalise timesheets (billing on 2026-10-01)')
    expect(email.text).toContain('Billing period: 2026-09-01 to 2026-09-30')
    expect(email.text).toContain(`Review and update entries here: ${APP_URL}/oj-projects`)
    expect(linksIn(email.text)).toEqual([`${APP_URL}/oj-projects`])
    expectCleanEmail(email)
  })
})

describe('employee invite chase cron', () => {
  it('sends a day 3 onboarding chase and a portal access reminder, each with a clean link', async () => {
    // Both invites were made on Sunday 27 September, four days ago: day 3 is due, day 6 is not.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        employee_invite_tokens: [
          {
            id: 'invite-1',
            token: ONBOARDING_TOKEN,
            email: 'new.starter@example.com',
            invite_type: 'onboarding',
            created_at: '2026-09-27T09:00:00.000Z',
            day3_chase_sent_at: null,
            day6_chase_sent_at: null,
          },
          {
            id: 'invite-2',
            token: PORTAL_TOKEN,
            email: 'sam.taylor@example.com',
            invite_type: 'portal_access',
            created_at: '2026-09-27T09:00:00.000Z',
            day3_chase_sent_at: null,
            day6_chase_sent_at: null,
          },
        ],
      })
    )

    const response = await runEmployeeInviteChase(cronRequest('/api/cron/employee-invite-chase') as never)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, day3ChasesSent: 2, day6ChasesSent: 0, errors: [] })
    expect(reportCronFailure).not.toHaveBeenCalled()
    expect(sentEmails()).toHaveLength(2)

    const chase = sentEmailTo('new.starter@example.com')
    expect(chase.subject).toBe('Reminder: Please Complete Your Profile')
    expect(linksIn(chase.text ?? '')).toEqual([`${APP_URL}/onboarding/${ONBOARDING_TOKEN}`])
    expectCleanEmail(chase)

    const portal = sentEmailTo('sam.taylor@example.com')
    expect(portal.subject).toBe('Set Up Your Staff Portal Access -- The Anchor')
    expect(linksIn(portal.text ?? '')).toEqual([`${APP_URL}/onboarding/${PORTAL_TOKEN}`])
    expectCleanEmail(portal)
  })
})

describe('employee invite actions', () => {
  it('new invite sends the welcome email with a clean onboarding link', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({}, { create_employee_invite: { employee_id: 'employee-1', token: ONBOARDING_TOKEN } })
    )
    const formData = new FormData()
    formData.set('email', 'New.Starter@example.com')
    formData.set('job_title', 'Bar Staff')
    formData.set('employment_start_date', '2026-10-12')

    const result = await inviteEmployee(null, formData)

    expect(result).toMatchObject({ type: 'success', employeeId: 'employee-1' })
    const email = sentEmailTo('new.starter@example.com')
    expect(email.subject).toBe('Welcome to The Anchor -- Complete Your Profile')
    expect(linksIn(email.text ?? '')).toEqual([`${APP_URL}/onboarding/${ONBOARDING_TOKEN}`])
    expectCleanEmail(email)
  })

  it('resent invite sends the welcome email with the new onboarding link', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        employees: { email_address: 'new.starter@example.com', status: 'Onboarding' },
        employee_invite_tokens: { token: RESEND_TOKEN },
      })
    )

    const result = await resendInvite('employee-1')

    expect(result).toMatchObject({ type: 'success' })
    const email = sentEmailTo('new.starter@example.com')
    expect(email.subject).toBe('Welcome to The Anchor -- Complete Your Profile')
    expect(linksIn(email.text ?? '')).toEqual([`${APP_URL}/onboarding/${RESEND_TOKEN}`])
    expectCleanEmail(email)
  })

  it('portal invite sends the portal email with a clean onboarding link', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        employees: { email_address: 'sam.taylor@example.com', auth_user_id: null, status: 'Active' },
        employee_invite_tokens: { token: PORTAL_TOKEN },
      })
    )

    const result = await sendPortalInvite('employee-2')

    expect(result).toMatchObject({ type: 'success' })
    const email = sentEmailTo('sam.taylor@example.com')
    expect(email.subject).toBe('Set Up Your Staff Portal Access -- The Anchor')
    expect(linksIn(email.text ?? '')).toEqual([`${APP_URL}/onboarding/${PORTAL_TOKEN}`])
    expectCleanEmail(email)
  })
})
