import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => true),
  sendInvoiceEmail: vi.fn(),
}))

vi.mock('@/lib/invoice-recipients', () => ({
  resolveVendorInvoiceRecipients: vi.fn(),
}))

vi.mock('@/lib/invoices/greeting', () => ({
  resolveInvoiceGreetingName: vi.fn(),
}))

vi.mock('@/lib/oj-timesheet', () => ({
  generateOjTimesheetPDF: vi.fn(),
}))

vi.mock('@/lib/oj-projects/billing-alerts', () => ({
  sendBillingRunAlert: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'
import { reportCronFailure } from '@/lib/cron/alerting'
import { claimIdempotencyKey, persistIdempotencyResponse, releaseIdempotencyClaim } from '@/lib/api/idempotency'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import { GET } from '@/app/api/cron/oj-projects-billing/route'

// ---------------------------------------------------------------------------------------------
// A small in-memory database. The billing route is one long conversation with Supabase, and the
// rules under test (which clients a run bills, what the pass record says afterwards) only show
// when the rows it writes are read back. Filters the route relies on for safety (eq, in, lt, is,
// ilike) are honoured; ordering and limits are ignored.
// ---------------------------------------------------------------------------------------------

type Row = Record<string, any>
type Filter = [string, ...any[]]
type Query = { table: string; action: 'select' | 'insert' | 'update' | 'upsert'; payload?: any; filters: Filter[] }

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([kind, column, value]) => {
    if (kind === 'eq') return row[column] === value
    if (kind === 'in') return (value as unknown[]).includes(row[column])
    if (kind === 'lt') return String(row[column]) < String(value)
    if (kind === 'is') return value === null ? row[column] == null : row[column] === value
    if (kind === 'ilike') return String(row[column] ?? '').includes(String(value).replace(/%/g, ''))
    return true
  })
}

function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    cron_job_runs: [],
    invoice_vendors: [],
    oj_billing_runs: [],
    oj_entries: [],
    oj_recurring_charge_instances: [],
    oj_vendor_recurring_charges: [],
    oj_vendor_billing_settings: [],
    invoices: [],
    invoice_email_logs: [],
    ...seed,
  }
  const queries: Query[] = []
  const failing = new Set<string>()
  let nextId = 1
  let nextInvoiceSequence = 1

  const uniqueKeys: Record<string, string[]> = {
    cron_job_runs: ['job_name', 'run_key'],
    oj_billing_runs: ['vendor_id', 'period_yyyymm'],
    oj_recurring_charge_instances: ['vendor_id', 'recurring_charge_id', 'period_yyyymm'],
  }
  const clashes = (table: string, row: Row) =>
    (uniqueKeys[table] ?? []).length > 0 &&
    tables[table].some((existing) => uniqueKeys[table].every((key) => existing[key] === row[key]))

  function resolveQuery(query: Query) {
    if (failing.has(query.table)) return { data: null, error: { message: `${query.table} is unavailable` } }
    const rows = (tables[query.table] ??= [])
    const one = query.filters.some(([kind]) => kind === 'single' || kind === 'maybeSingle')

    if (query.action === 'insert' || query.action === 'upsert') {
      const incoming: Row[] = Array.isArray(query.payload) ? query.payload : [query.payload]
      const inserted: Row[] = []
      for (const payload of incoming) {
        if (clashes(query.table, payload)) {
          if (query.action === 'upsert') continue
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
        const nowIso = new Date().toISOString()
        const defaults: Row =
          query.table === 'oj_billing_runs'
            ? { invoice_id: null, run_started_at: nowIso }
            : query.table === 'oj_recurring_charge_instances'
              ? { status: 'unbilled', billing_run_id: null, invoice_id: null }
              : {}
        const row = { id: `${query.table}-${nextId++}`, created_at: nowIso, ...defaults, ...payload }
        rows.push(row)
        inserted.push(row)
      }
      return { data: one ? inserted[0] ?? null : inserted, error: null }
    }

    const matched = rows.filter((row) => matches(row, query.filters))
    if (query.action === 'update') {
      for (const row of matched) Object.assign(row, query.payload)
      const ids = matched.map((row) => ({ id: row.id }))
      return { data: one ? ids[0] ?? null : ids, count: matched.length, error: null }
    }
    return { data: one ? matched[0] ?? null : matched, error: null }
  }

  function chain(query: Query, resolve: () => Row) {
    const builder: Row = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (onFulfilled: (value: Row) => unknown, onRejected: (reason: unknown) => unknown) =>
              Promise.resolve().then(resolve).then(onFulfilled, onRejected)
          }
          return (...args: any[]) => {
            if (prop === 'insert' || prop === 'update' || prop === 'upsert') {
              query.action = prop
              query.payload = args[0]
            } else {
              query.filters.push([prop, ...args])
            }
            return builder
          }
        },
      }
    )
    return builder
  }

  const client = {
    from(table: string) {
      const query: Query = { table, action: 'select', filters: [] }
      queries.push(query)
      return chain(query, () => resolveQuery(query))
    },
    rpc(name: string, args: Row) {
      const query: Query = { table: `rpc:${name}`, action: 'select', payload: args, filters: [] }
      queries.push(query)
      return chain(query, () => {
        if (name === 'get_and_increment_invoice_series') {
          return { data: { next_sequence: nextInvoiceSequence++ }, error: null }
        }
        if (name === 'create_invoice_transaction') {
          const invoice = {
            id: `invoice-${nextId++}`,
            paid_amount: 0,
            ...args.p_invoice_data,
            line_items: args.p_line_items,
            payments: [],
          }
          tables.invoices.push(invoice)
          return { data: { id: invoice.id }, error: null }
        }
        return { data: null, error: { message: `Unexpected rpc ${name}` } }
      })
    },
  }

  const writesTo = (table: string) => queries.filter((query) => query.table === table && query.action !== 'select')
  const touched = (table: string) => queries.some((query) => query.table === table)

  return { client, tables, queries, failing, writesTo, touched }
}

const PASS_JOB = 'oj-projects-billing-pass'
const OCTOBER = { period_yyyymm: '2026-10', period_start: '2026-10-01', period_end: '2026-10-31' }

const vendor = (id: string, name: string): Row => ({
  id,
  name,
  email: `${id}@example.com`,
  contact_name: null,
  payment_terms: 14,
})

/** An active monthly charge: makes the client a candidate, and the route raises its instance. */
const monthlyCharge = (vendorId: string): Row => ({
  id: `charge-${vendorId}`,
  vendor_id: vendorId,
  description: 'Website hosting and care plan',
  amount_ex_vat: 500,
  vat_rate: 20,
  frequency: 'monthly',
  sort_order: 0,
  is_active: true,
  end_date: null,
  created_at: '2026-01-01T00:00:00.000Z',
})

const passRecord = (status: string): Row => ({
  id: 'pass-1',
  job_name: PASS_JOB,
  run_key: '2026-10',
  status,
  started_at: '2026-11-02T09:05:00.000Z',
})

function at(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
}

function run(query = '') {
  return GET(new Request(`http://localhost/api/cron/oj-projects-billing${query}`))
}

function emailFor(invoiceNumber: string) {
  const call = vi.mocked(sendInvoiceEmail).mock.calls.find(([invoice]) => invoice.invoice_number === invoiceNumber)
  if (!call) throw new Error(`No email was sent for ${invoiceNumber}`)
  return { subject: String(call[2]), body: String(call[3]), attachments: call[5], options: call[6] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as any)
  vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ to: 'accounts@example.com', cc: [] })
  vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
  vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// November 2026: the 1st is a Sunday, so October's pass starts on Monday 2 November.
describe('OJ billing cron: when the monthly pass runs', () => {
  it('does nothing on Sunday 1 November', async () => {
    at('2026-11-01T09:05:00Z')
    const db = makeDb()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toEqual({ skipped: true, reason: 'before_first_weekday' })
    expect(db.writesTo('cron_job_runs')).toHaveLength(0)
    expect(db.touched('oj_entries')).toBe(false)
    expect(db.touched('oj_billing_runs')).toBe(false)
  })

  it('starts the pass on Monday 2 November and records it finished', async () => {
    at('2026-11-02T09:05:00Z')
    const db = makeDb()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ period: '2026-10', invoice_date: '2026-11-02', billing_pass: 'completed' })
    expect(db.tables.cron_job_runs).toHaveLength(1)
    expect(db.tables.cron_job_runs[0]).toMatchObject({ job_name: PASS_JOB, run_key: '2026-10', status: 'completed' })
  })

  it('bills nothing more once the pass is recorded as finished', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('completed')],
      invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-b')],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toEqual({ skipped: true, reason: 'pass_completed' })
    expect(db.touched('oj_billing_runs')).toBe(false)
    expect(db.touched('oj_entries')).toBe(false)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('fails closed, with an alert, when the pass record cannot be read', async () => {
    at('2026-11-02T09:05:00Z')
    const db = makeDb({
      invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-b')],
    })
    db.failing.add('cron_job_runs')
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const response = await run()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to read the billing pass record' })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(db.touched('oj_billing_runs')).toBe(false)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  // September 2026 was billed on 1 October by the old rule and has no record.
  it.each(['2026-10-05T09:05:00Z', '2026-10-08T09:05:00Z'])(
    'leaves the September pass alone after go-live in October (%s)',
    async (instant) => {
      at(instant)
      const db = makeDb({
        invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
        oj_vendor_recurring_charges: [monthlyCharge('vendor-b')],
      })
      vi.mocked(createAdminClient).mockReturnValue(db.client as any)

      const payload = await (await run()).json()

      expect(payload).toEqual({ skipped: true, reason: 'before_pass_records' })
      expect(db.writesTo('cron_job_runs')).toHaveLength(0)
      expect(db.touched('oj_billing_runs')).toBe(false)
      expect(reportCronFailure).not.toHaveBeenCalled()
    }
  )
})

describe('OJ billing cron: a pass cut short is carried on the next weekday', () => {
  // Monday's run billed Alpha and then stopped. Bravo was never reached. On Tuesday both are
  // candidates again (each has an active monthly charge).
  function tuesdayAfterACutShortMonday() {
    at('2026-11-03T09:05:00Z')
    return makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-a', 'Alpha Ltd'), vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-a'), monthlyCharge('vendor-b')],
      oj_billing_runs: [
        {
          id: 'run-a',
          vendor_id: 'vendor-a',
          ...OCTOBER,
          status: 'sent',
          invoice_id: 'invoice-a',
          run_started_at: '2026-11-02T09:05:01.000Z',
          created_at: '2026-11-02T09:05:01.000Z',
        },
      ],
      oj_recurring_charge_instances: [
        {
          id: 'instance-a',
          vendor_id: 'vendor-a',
          recurring_charge_id: 'charge-vendor-a',
          ...OCTOBER,
          status: 'billed',
          billing_run_id: 'run-a',
          invoice_id: 'invoice-a',
        },
      ],
      invoices: [{ id: 'invoice-a', invoice_number: 'INV-ALPHA', vendor_id: 'vendor-a', status: 'sent' }],
    })
  }

  it('bills the client the first run never reached, and does not invoice the other twice', async () => {
    const db = tuesdayAfterACutShortMonday()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 2, sent: 1, skipped: 1, failed: 0, billing_pass: 'completed' })
    // Alpha: still one invoice, one run, and no second email.
    expect(db.tables.invoices.filter((invoice) => invoice.vendor_id === 'vendor-a')).toHaveLength(1)
    expect(db.tables.oj_billing_runs.filter((billingRun) => billingRun.vendor_id === 'vendor-a')).toHaveLength(1)
    // Bravo: billed now, on the day it is raised.
    const bravoInvoices = db.tables.invoices.filter((invoice) => invoice.vendor_id === 'vendor-b')
    expect(bravoInvoices).toHaveLength(1)
    expect(bravoInvoices[0]).toMatchObject({
      invoice_date: '2026-11-03',
      due_date: '2026-11-17',
      reference: 'OJ Projects 2026-10',
      status: 'sent',
      total_amount: 600,
    })
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0].invoice_number).toBe(bravoInvoices[0].invoice_number)
    expect(db.tables.oj_billing_runs.find((billingRun) => billingRun.vendor_id === 'vendor-b')).toMatchObject({
      status: 'sent',
      period_yyyymm: '2026-10',
    })
    // The record already existed, so it is completed, not created a second time.
    expect(db.tables.cron_job_runs).toHaveLength(1)
    expect(db.tables.cron_job_runs[0].status).toBe('completed')
  })

  // The old email told every client "The invoice notes include a breakdown of hours and
  // mileage". Bravo is billed a monthly charge only: its notes carry no hours and no mileage.
  it('emails a recurring-charge-only invoice in the new wording, with no promise of a breakdown', async () => {
    const db = tuesdayAfterACutShortMonday()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    await run()

    const invoice = db.tables.invoices.find((row) => row.vendor_id === 'vendor-b')!
    const { subject, body, attachments, options } = emailFor(invoice.invoice_number)
    expect(resolveInvoiceGreetingName).toHaveBeenCalledWith(db.client, 'vendor-b')
    expect(subject).toBe(`October invoice from Orange Jelly (${invoice.invoice_number})`)
    expect(body).toBe(
      [
        'Hi Sam,',
        "Here's the invoice for October: £600.00, due Tuesday 17 November.",
        'The bank details are on the invoice. Any questions, just reply to this email or give me a ring.',
        INVOICE_SIGN_OFF,
      ].join('\n\n')
    )
    expect(body).not.toContain('breakdown')
    expect(body).not.toContain('Bravo Ltd')
    expect(attachments).toBeUndefined()
    expect(options).toEqual({ emailKind: 'invoice' })
  })

  // A run that times out part-way through a client leaves that client's run at 'processing' and
  // its entries locked. No other candidate query can find the client then, so the retry query
  // has to. The run is a day old, so it is provably dead and is picked up.
  it('picks up a client whose run died part-way, and says the breakdown is on that invoice', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-c', 'Charlie Ltd')],
      oj_billing_runs: [
        {
          id: 'run-c',
          vendor_id: 'vendor-c',
          ...OCTOBER,
          status: 'processing',
          invoice_id: null,
          run_started_at: '2026-11-02T09:05:30.000Z',
          created_at: '2026-11-02T09:05:30.000Z',
        },
      ],
      oj_entries: [
        {
          id: 'entry-c1',
          vendor_id: 'vendor-c',
          entry_type: 'time',
          status: 'billing_pending',
          billing_run_id: 'run-c',
          invoice_id: null,
          billable: true,
          entry_date: '2026-10-14',
          duration_minutes_rounded: 120,
          hourly_rate_ex_vat_snapshot: 75,
          vat_rate_snapshot: 20,
          work_type_name_snapshot: 'Development',
          description: 'Booking form changes',
          start_at: null,
          end_at: null,
          project_id: 'project-1',
          project: { id: 'project-1', project_code: 'OJP-001', project_name: 'Website' },
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 1, sent: 1, failed: 0, billing_pass: 'completed' })
    expect(db.tables.invoices).toHaveLength(1)
    expect(db.tables.oj_billing_runs).toHaveLength(1)
    expect(db.tables.oj_billing_runs[0]).toMatchObject({ id: 'run-c', status: 'sent' })
    expect(db.tables.oj_entries[0]).toMatchObject({ status: 'billed', invoice_id: db.tables.invoices[0].id })
    const { body } = emailFor(db.tables.invoices[0].invoice_number)
    expect(body).toContain(
      "Here's the invoice for October: £180.00, due Tuesday 17 November. The breakdown of hours and mileage is on the invoice.\n\n"
    )
    expect(body).not.toContain('timesheet')
  })

  // An earlier attempt raised the invoice and failed before emailing it. The retry sends that
  // same draft; it must not raise a second invoice.
  it('re-sends a draft left by a failed attempt, in the new wording, without a second invoice', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-d', 'Delta Ltd')],
      oj_billing_runs: [
        {
          id: 'run-d',
          vendor_id: 'vendor-d',
          ...OCTOBER,
          status: 'failed',
          invoice_id: 'invoice-d',
          run_started_at: '2026-11-02T09:05:40.000Z',
          created_at: '2026-11-02T09:05:40.000Z',
        },
      ],
      oj_recurring_charge_instances: [
        {
          id: 'instance-d',
          vendor_id: 'vendor-d',
          recurring_charge_id: 'charge-vendor-d',
          ...OCTOBER,
          status: 'billing_pending',
          billing_run_id: 'run-d',
          invoice_id: null,
        },
      ],
      invoices: [
        {
          id: 'invoice-d',
          invoice_number: 'INV-DELTA',
          vendor_id: 'vendor-d',
          status: 'draft',
          invoice_date: '2026-11-02',
          due_date: '2026-11-16',
          total_amount: 600,
          paid_amount: 0,
          reference: 'OJ Projects 2026-10',
          notes: 'OJ Projects timesheet\nBilling month: 2026-10-01 to 2026-10-31',
          internal_notes: 'Auto-generated by OJ Projects billing run run-d (2026-10).',
        },
      ],
    })
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue(null)
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 1, sent: 1, failed: 0, billing_pass: 'completed' })
    expect(db.tables.invoices).toHaveLength(1)
    expect(db.tables.invoices[0].status).toBe('sent')
    expect(db.tables.oj_recurring_charge_instances[0]).toMatchObject({ status: 'billed', invoice_id: 'invoice-d' })
    const { subject, body, options } = emailFor('INV-DELTA')
    expect(subject).toBe('October invoice from Orange Jelly (INV-DELTA)')
    expect(body.startsWith("Hi there,\n\nHere's the invoice for October: £600.00, due Monday 16 November.\n\n")).toBe(true)
    expect(body).not.toContain('breakdown')
    expect(body).not.toContain('Delta Ltd')
    expect(options).toEqual({ emailKind: 'invoice' })
  })

  it('leaves the pass open when a client is still in flight in another invocation', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-e', 'Echo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-e')],
      oj_billing_runs: [
        {
          id: 'run-e',
          vendor_id: 'vendor-e',
          ...OCTOBER,
          status: 'processing',
          invoice_id: null,
          // Started four seconds ago by another invocation.
          run_started_at: '2026-11-03T09:04:56.000Z',
          created_at: '2026-11-03T09:04:56.000Z',
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 1, sent: 0, skipped: 1, billing_pass: 'still_running' })
    expect(db.tables.cron_job_runs[0].status).toBe('running')
    expect(db.tables.invoices).toHaveLength(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })
})

describe('OJ billing cron: a pass still unfinished on the 8th', () => {
  function mondayTheNinth() {
    at('2026-11-09T09:05:00Z')
    return makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-a', 'Alpha Ltd'), vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-a'), monthlyCharge('vendor-b')],
      oj_billing_runs: [
        {
          id: 'run-a',
          vendor_id: 'vendor-a',
          ...OCTOBER,
          status: 'sent',
          invoice_id: 'invoice-a',
          run_started_at: '2026-11-02T09:05:01.000Z',
          created_at: '2026-11-02T09:05:01.000Z',
        },
      ],
    })
  }

  it('bills nothing, alerts once with the unbilled client, and remembers that it alerted', async () => {
    const db = mondayTheNinth()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const first = await (await run()).json()

    expect(first).toEqual({
      skipped: true,
      reason: 'window_closed',
      period: '2026-10',
      alerted: true,
      no_billing_run: ['Bravo Ltd'],
      unfinished_run: [],
    })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportCronFailure).mock.calls[0][2]).toMatchObject({
      billed_month: 'October 2026',
      clients_with_no_billing_run: 'Bravo Ltd',
    })
    expect(db.tables.cron_job_runs[0].status).toBe('failed')
    expect(db.writesTo('oj_billing_runs')).toHaveLength(0)
    expect(db.tables.invoices).toHaveLength(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()

    // Tuesday the 10th: the same database, and no second alert.
    at('2026-11-10T09:05:00Z')
    const second = await (await run()).json()

    expect(second).toEqual({ skipped: true, reason: 'pass_abandoned' })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(db.writesTo('oj_billing_runs')).toHaveLength(0)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  it('alerts when the pass never started at all, and records that too', async () => {
    at('2026-11-09T09:05:00Z')
    const db = makeDb({
      invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-b')],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ skipped: true, reason: 'window_closed', no_billing_run: ['Bravo Ltd'] })
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    expect(db.tables.cron_job_runs).toHaveLength(1)
    expect(db.tables.cron_job_runs[0]).toMatchObject({ job_name: PASS_JOB, run_key: '2026-10', status: 'failed' })
    expect(db.tables.invoices).toHaveLength(0)
  })
})

describe('OJ billing cron: dry runs and forced runs leave the pass record alone', () => {
  it('a dry run on the first weekday previews without creating the record', async () => {
    at('2026-11-02T09:05:00Z')
    const db = makeDb()
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run('?dry_run=true')).json()

    expect(payload).toMatchObject({ dry_run: true, period: '2026-10' })
    expect(db.tables.cron_job_runs).toHaveLength(0)
    expect(db.writesTo('cron_job_runs')).toHaveLength(0)
  })

  it('a dry run does not complete a pass that is still open', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({ cron_job_runs: [passRecord('running')] })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    await run('?dry_run=true')

    expect(db.writesTo('cron_job_runs')).toHaveLength(0)
    expect(db.tables.cron_job_runs[0].status).toBe('running')
  })

  it('a dry run on the 9th neither alerts nor marks the record', async () => {
    at('2026-11-09T09:05:00Z')
    const db = makeDb({ cron_job_runs: [passRecord('running')] })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run('?dry_run=true')).json()

    expect(payload).toEqual({ skipped: true, reason: 'window_closed' })
    expect(reportCronFailure).not.toHaveBeenCalled()
    expect(db.writesTo('cron_job_runs')).toHaveLength(0)
    expect(db.tables.cron_job_runs[0].status).toBe('running')
  })

  // What the preview screen sends: force, dry_run and one client.
  it('the preview call runs on any day and never reads or writes the record', async () => {
    at('2026-11-15T14:00:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('completed')],
      invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run('?dry_run=true&force=true&vendor_id=vendor-b')).json()

    expect(payload).toMatchObject({ dry_run: true, period: '2026-10', invoice_date: '2026-11-15' })
    expect(payload.vendors).toHaveLength(1)
    expect(db.touched('cron_job_runs')).toBe(false)
    expect(db.writesTo('oj_billing_runs')).toHaveLength(0)
  })

  it('a forced real run skips the day check and does not touch the record', async () => {
    at('2026-11-15T14:00:00Z')
    const db = makeDb({ cron_job_runs: [passRecord('completed')] })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)

    const payload = await (await run('?force=true')).json()

    expect(payload).toMatchObject({ period: '2026-10', processed: 0 })
    expect(payload).not.toHaveProperty('billing_pass')
    expect(db.touched('cron_job_runs')).toBe(false)
  })
})

// A failed send is one of two things. Refused: nothing went, so it is tried again on the next
// weekday while the pass is open. Unknown (the request left, then the connection dropped): the
// client may already hold the invoice, so nothing emails it again and a person checks.
describe('OJ billing cron: a client whose invoice email fails', () => {
  function mondayWithOneClient() {
    at('2026-11-02T09:05:00Z')
    const db = makeDb({
      invoice_vendors: [vendor('vendor-b', 'Bravo Ltd')],
      oj_vendor_recurring_charges: [monthlyCharge('vendor-b')],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)
    return db
  }

  it('leaves the pass open when the email is refused, so the next weekday tries again', async () => {
    const db = mondayWithOneClient()
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Mailbox unavailable' } as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 1, sent: 0, failed: 1 })
    expect(payload).not.toHaveProperty('billing_pass')
    expect(db.tables.cron_job_runs[0]).toMatchObject({ run_key: '2026-10', status: 'running' })
    // A refusal releases the send claim: nothing went, so a retry cannot duplicate anything.
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(db.tables.oj_billing_runs[0]).toMatchObject({ status: 'failed', error_message: 'Mailbox unavailable' })
    expect(db.tables.invoices[0].status).toBe('draft')
  })

  it('keeps the send claim when the outcome is unknown, and says to check Sent Items', async () => {
    const db = mondayWithOneClient()
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: false, error: 'Unable to fetch data', uncertain: true } as any)

    const payload = await (await run()).json()

    expect(payload).toMatchObject({ processed: 1, sent: 0, failed: 1 })
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      'hash',
      expect.objectContaining({ state: 'outcome_unknown' }),
      24 * 180
    )
    expect(db.tables.oj_billing_runs[0].status).toBe('failed')
    expect(db.tables.oj_billing_runs[0].error_message).toContain('Check Sent Items')
    expect(payload.vendors[0].error).toContain('do not send it again')
  })

  it('never emails an invoice again once an attempt has an unknown outcome', async () => {
    at('2026-11-03T09:05:00Z')
    const db = makeDb({
      cron_job_runs: [passRecord('running')],
      invoice_vendors: [vendor('vendor-d', 'Delta Ltd')],
      oj_billing_runs: [
        {
          id: 'run-d',
          vendor_id: 'vendor-d',
          ...OCTOBER,
          status: 'failed',
          invoice_id: 'invoice-d',
          run_started_at: '2026-11-02T09:05:40.000Z',
          created_at: '2026-11-02T09:05:40.000Z',
        },
      ],
      oj_recurring_charge_instances: [
        {
          id: 'instance-d',
          vendor_id: 'vendor-d',
          recurring_charge_id: 'charge-vendor-d',
          ...OCTOBER,
          status: 'billing_pending',
          billing_run_id: 'run-d',
          invoice_id: null,
        },
      ],
      invoices: [
        {
          id: 'invoice-d',
          invoice_number: 'INV-DELTA',
          vendor_id: 'vendor-d',
          status: 'draft',
          invoice_date: '2026-11-02',
          due_date: '2026-11-16',
          total_amount: 600,
          paid_amount: 0,
          reference: 'OJ Projects 2026-10',
          notes: 'OJ Projects timesheet\nBilling month: 2026-10-01 to 2026-10-31',
          internal_notes: 'Auto-generated by OJ Projects billing run run-d (2026-10).',
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as any)
    // Monday's attempt kept its claim, marked unknown.
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'replay', response: { state: 'outcome_unknown' } } as any)

    const payload = await (await run()).json()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(payload).toMatchObject({ processed: 1, sent: 0, skipped: 1, failed: 0 })
    // It stays a draft for a person to settle, and it does not hold the month's pass open.
    expect(db.tables.invoices[0].status).toBe('draft')
    expect(payload.billing_pass).toBe('completed')
  })
})
