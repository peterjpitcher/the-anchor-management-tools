import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// Only "today" is faked. The date maths (the due date, the schedule's next date, the weekday
// check) runs for real, because those are the rules under test.
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: vi.fn(() => '2026-06-24'),
}))

vi.mock('@/services/invoices', () => ({
  InvoiceService: {
    createInvoiceAsAdmin: vi.fn(),
  },
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

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  getAppUrl: vi.fn(() => 'https://management.example.test'),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(() => 'hash'),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { getIsoWeekday, getTodayIsoDate } from '@/lib/dateUtils'
import { InvoiceService } from '@/services/invoices'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'
import { claimIdempotencyKey, persistIdempotencyResponse } from '@/lib/api/idempotency'
import { reportCronFailure } from '@/lib/cron/alerting'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import { GET } from '@/app/api/cron/recurring-invoices/route'

const recurringInvoice = {
  id: 'recurring-1',
  vendor_id: 'vendor-1',
  next_invoice_date: '2026-06-24',
  frequency: 'monthly',
  days_before_due: 30,
  reference: 'Monthly services',
  invoice_discount_percentage: 0,
  notes: null,
  internal_notes: null,
  end_date: null as string | null,
  vendor: {
    id: 'vendor-1',
    name: 'Client Ltd',
    email: 'billing@example.com',
    contact_name: 'Billing',
    payment_terms: 30,
  },
  line_items: [{
    catalog_item_id: null,
    description: 'Services',
    quantity: 1,
    unit_price: 100,
    discount_percentage: 0,
    vat_rate: 20,
  }],
}

// The invoice as the route reloads it for emailing, once it has been created.
const reloadedInvoice = {
  id: 'invoice-1',
  invoice_number: 'INV-1',
  status: 'draft',
  reference: 'Monthly services',
  invoice_date: '2026-06-24',
  due_date: '2026-07-24',
  total_amount: 120,
  paid_amount: 0,
  vendor: recurringInvoice.vendor,
  line_items: [],
  payments: [],
}

function makeSupabase(overrides: {
  recurring?: Partial<typeof recurringInvoice>
  invoice?: Record<string, unknown>
} = {}) {
  const dueRow = { ...recurringInvoice, ...overrides.recurring }
  const dueOrder = vi.fn().mockResolvedValue({ data: [dueRow], error: null })
  const dueLte = vi.fn(() => ({ order: dueOrder }))
  const dueEq = vi.fn(() => ({ lte: dueLte }))
  const dueSelect = vi.fn(() => ({ eq: dueEq }))

  const recurringUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'recurring-1' }, error: null })
  const recurringUpdateSelect = vi.fn(() => ({ maybeSingle: recurringUpdateMaybeSingle }))
  const recurringUpdateEq = vi.fn(() => ({ select: recurringUpdateSelect }))
  const recurringUpdate = vi.fn((_patch: Record<string, unknown>) => ({ eq: recurringUpdateEq }))

  const invoiceLoadSingle = vi.fn().mockResolvedValue({
    data: { ...reloadedInvoice, ...overrides.invoice },
    error: null,
  })
  const invoiceLoadEq = vi.fn(() => ({ single: invoiceLoadSingle }))
  // Line items are ordered explicitly now: without display_order PostgREST
  // gives no stable order, so a PDF could print its lines differently between
  // generating, retrying and downloading.
  const invoiceLoadOrder = vi.fn(() => ({ eq: invoiceLoadEq }))
  const invoiceSelect = vi.fn(() => ({ order: invoiceLoadOrder, eq: invoiceLoadEq }))

  const invoiceStatusMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'invoice-1' }, error: null })
  const invoiceStatusSelect = vi.fn(() => ({ maybeSingle: invoiceStatusMaybeSingle }))
  const invoiceStatusEqStatus = vi.fn(() => ({ select: invoiceStatusSelect }))
  const invoiceStatusEqId = vi.fn(() => ({ eq: invoiceStatusEqStatus }))
  const invoiceUpdate = vi.fn(() => ({ eq: invoiceStatusEqId }))

  const emailLogInsert = vi.fn().mockResolvedValue({ error: null })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'recurring_invoices') {
        return { select: dueSelect, update: recurringUpdate }
      }
      if (table === 'invoices') {
        return { select: invoiceSelect, update: invoiceUpdate }
      }
      if (table === 'invoice_email_logs') {
        return { insert: emailLogInsert }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }

  return { supabase, invoiceUpdate, emailLogInsert, recurringUpdate }
}

function makeFetchErrorSupabase() {
  const dueOrder = vi.fn().mockResolvedValue({
    data: null,
    error: {
      message: 'permission denied for table recurring_invoices',
      details: 'service-role details',
    },
  })
  const dueLte = vi.fn(() => ({ order: dueOrder }))
  const dueEq = vi.fn(() => ({ lte: dueLte }))
  const dueSelect = vi.fn(() => ({ eq: dueEq }))

  return {
    from: vi.fn((table: string) => {
      if (table === 'recurring_invoices') {
        return { select: dueSelect }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

function run() {
  return GET(new Request('http://localhost/api/cron/recurring-invoices'))
}

describe('recurring invoices cron A-046', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTodayIsoDate).mockReturnValue('2026-06-24')
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as any)
    vi.mocked(persistIdempotencyResponse).mockResolvedValue(undefined)
    vi.mocked(InvoiceService.createInvoiceAsAdmin).mockResolvedValue({
      id: 'invoice-1',
      invoice_number: 'INV-1',
    } as any)
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({
      to: 'billing@example.com',
      cc: [],
    })
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
    vi.mocked(sendInvoiceEmail).mockResolvedValue({
      success: false,
      error: 'Graph send failed',
    })
  })

  // The invoice used to be marked sent BEFORE the email was attempted. A failed email then left
  // it looking delivered, with no sent_at, so it was never retried and never chased. It now
  // stays a draft and the owner is told which one to send by hand.
  it('leaves the invoice a draft and alerts the owner when the email fails', async () => {
    const { supabase, invoiceUpdate } = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results.send_failed).toBe(1)
    expect(payload.results.sent).toBe(0)
    expect(invoiceUpdate).not.toHaveBeenCalled()
    expect(sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'invoice-1', status: 'draft' }),
      'billing@example.com',
      expect.any(String),
      expect.any(String),
      [],
      undefined,
      { emailKind: 'invoice' },
    )
    expect(reportCronFailure).toHaveBeenCalledWith(
      'recurring-invoices',
      expect.objectContaining({ message: 'Invoice INV-1 was raised but not emailed: Graph send failed' }),
      expect.objectContaining({
        invoice: 'INV-1',
        draft: 'https://management.example.test/invoices/invoice-1',
      }),
    )
    expect(persistIdempotencyResponse).toHaveBeenCalledWith(
      supabase,
      expect.any(String),
      'hash',
      expect.objectContaining({
        state: 'processed',
        invoice_id: 'invoice-1',
        sent: false,
        reason: 'email_send_failed',
      }),
      24 * 90,
    )
  })

  // sent_at is what the reminder job reads to decide an invoice was ever delivered. The job never
  // wrote it, so recurring invoices were never chased.
  it('marks the invoice sent, with sent_at and sent_to, only after the email succeeds', async () => {
    const { supabase, invoiceUpdate } = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results.sent).toBe(1)
    expect(invoiceUpdate).toHaveBeenCalledTimes(1)
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        sent_to: 'billing@example.com',
        sent_at: expect.any(String),
      }),
    )
    const sendOrder = vi.mocked(sendInvoiceEmail).mock.invocationCallOrder[0]
    const updateOrder = invoiceUpdate.mock.invocationCallOrder[0]
    expect(sendOrder).toBeLessThan(updateOrder)
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('leaves the invoice a draft and alerts the owner when the client has no address', async () => {
    const { supabase, invoiceUpdate } = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ to: null, cc: [] } as any)

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results.skipped_send_no_recipient).toBe(1)
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(invoiceUpdate).not.toHaveBeenCalled()
    expect(reportCronFailure).toHaveBeenCalledWith(
      'recurring-invoices',
      expect.objectContaining({
        message: 'Invoice INV-1 was raised but not emailed: the client has no email address on file',
      }),
      expect.objectContaining({ draft: 'https://management.example.test/invoices/invoice-1' }),
    )
  })

  it('does not leak raw database errors when loading due recurring invoices fails', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeFetchErrorSupabase() as any)

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to fetch recurring invoices' })
    expect(JSON.stringify(payload)).not.toContain('permission denied')
    expect(JSON.stringify(payload)).not.toContain('service-role details')
  })

  it('does not leak raw fatal errors in the cron response', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('database password leaked in stack')
    })

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to process recurring invoices' })
    expect(JSON.stringify(payload)).not.toContain('database password')
    expect(reportCronFailure).toHaveBeenCalledWith(
      'recurring-invoices',
      expect.any(Error),
    )
  })
})

// R4: invoices go out on a weekday morning. Saturday 7 November 2026 and Monday 9 November 2026
// are the pair used throughout; the first test pins their weekdays so a wrong fixture cannot
// pass by accident.
describe('recurring invoices cron: raised on a weekday, dated the day it is raised', () => {
  const SATURDAY = '2026-11-07'
  const SUNDAY = '2026-11-08'
  const MONDAY = '2026-11-09'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as any)
    vi.mocked(persistIdempotencyResponse).mockResolvedValue(undefined)
    vi.mocked(InvoiceService.createInvoiceAsAdmin).mockResolvedValue({
      id: 'invoice-1',
      invoice_number: 'INV-1',
    } as any)
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ to: 'billing@example.com', cc: [] })
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)
  })

  it('uses a real Saturday, Sunday and Monday', () => {
    expect(getIsoWeekday(SATURDAY)).toBe(6)
    expect(getIsoWeekday(SUNDAY)).toBe(7)
    expect(getIsoWeekday(MONDAY)).toBe(1)
  })

  it('dates a Saturday schedule the Monday it is raised, and keeps the schedule on its own day', async () => {
    vi.mocked(getTodayIsoDate).mockReturnValue(MONDAY)
    const { supabase, recurringUpdate } = makeSupabase({ recurring: { next_invoice_date: SATURDAY } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    const response = await run()
    const payload = await response.json()

    expect(payload.results.sent).toBe(1)
    // Dated the Monday, with the 30 day terms counted from the Monday (not Monday 7 December,
    // which is 30 days from the Saturday).
    expect(InvoiceService.createInvoiceAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_date: '2026-11-09', due_date: '2026-12-09' }),
    )
    // The schedule moves on from the Saturday it was due, so it stays on the 7th.
    expect(recurringUpdate).toHaveBeenCalledTimes(1)
    expect(recurringUpdate.mock.calls[0][0]).toMatchObject({
      next_invoice_date: '2026-12-07',
      last_invoice_id: 'invoice-1',
    })
    // The claim is still keyed on the scheduled date, so a second run cannot raise it twice.
    expect(claimIdempotencyKey).toHaveBeenCalledWith(
      supabase,
      'cron:recurring-invoice:recurring-1:2026-11-07',
      'hash',
      24 * 90,
    )
  })

  it.each([SATURDAY, SUNDAY])('does nothing when it is called on a weekend day (%s)', async (weekendDay) => {
    vi.mocked(getTodayIsoDate).mockReturnValue(weekendDay)
    const { supabase } = makeSupabase({ recurring: { next_invoice_date: SATURDAY } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    const response = await run()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, skipped: true, reason: 'Not a weekday in Europe/London' })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(InvoiceService.createInvoiceAsAdmin).not.toHaveBeenCalled()
    expect(sendInvoiceEmail).not.toHaveBeenCalled()
  })

  // The job used to run every day, so "has the end date passed?" could be asked of today. Now a
  // last invoice due on a Saturday is handled on the Monday, by which time the end date is behind
  // us. It must still be raised.
  it('still raises a last invoice whose scheduled date and end date fell at the weekend', async () => {
    vi.mocked(getTodayIsoDate).mockReturnValue(MONDAY)
    const { supabase, recurringUpdate } = makeSupabase({
      recurring: { next_invoice_date: SATURDAY, end_date: SATURDAY },
    })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await run()

    expect(InvoiceService.createInvoiceAsAdmin).toHaveBeenCalledTimes(1)
    expect(recurringUpdate.mock.calls[0][0]).not.toHaveProperty('is_active')
  })

  it('switches off a schedule whose end date is before its next scheduled invoice', async () => {
    vi.mocked(getTodayIsoDate).mockReturnValue(MONDAY)
    const { supabase, recurringUpdate } = makeSupabase({
      recurring: { next_invoice_date: SATURDAY, end_date: '2026-11-06' },
    })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await run()

    expect(InvoiceService.createInvoiceAsAdmin).not.toHaveBeenCalled()
    expect(recurringUpdate).toHaveBeenCalledTimes(1)
    expect(recurringUpdate.mock.calls[0][0]).toMatchObject({ is_active: false })
  })
})

describe('recurring invoices cron: the email wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTodayIsoDate).mockReturnValue('2026-11-09')
    vi.mocked(claimIdempotencyKey).mockResolvedValue({ state: 'claimed' } as any)
    vi.mocked(persistIdempotencyResponse).mockResolvedValue(undefined)
    vi.mocked(InvoiceService.createInvoiceAsAdmin).mockResolvedValue({
      id: 'invoice-1',
      invoice_number: 'INV-1',
    } as any)
    vi.mocked(resolveVendorInvoiceRecipients).mockResolvedValue({ to: 'billing@example.com', cc: [] })
    vi.mocked(sendInvoiceEmail).mockResolvedValue({ success: true } as any)
  })

  function sentEmail() {
    const call = vi.mocked(sendInvoiceEmail).mock.calls[0]
    return { subject: String(call[2]), body: String(call[3]), options: call[6] }
  }

  it('greets the contact by first name and says what is owed and when', async () => {
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
    const { supabase } = makeSupabase({ invoice: { due_date: '2026-12-09' } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await run()

    const { subject, body, options } = sentEmail()
    expect(resolveInvoiceGreetingName).toHaveBeenCalledWith(supabase, 'vendor-1')
    expect(subject).toBe('Invoice INV-1 from Orange Jelly')
    expect(body).toBe(
      [
        'Hi Sam,',
        "I hope you're well. Invoice INV-1 is attached (your reference: Monthly services): £120.00, due Wednesday 9 December.",
        'The bank details are on the invoice. Any questions, just reply to this email or give me a ring.',
        INVOICE_SIGN_OFF,
      ].join('\n\n'),
    )
    expect(options).toEqual({ emailKind: 'invoice' })
  })

  it('says "Hi there" when the client has no named contact, never the company name', async () => {
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue(null)
    const { supabase } = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await run()

    const { body } = sentEmail()
    expect(body.startsWith('Hi there,\n\n')).toBe(true)
    // The old wording greeted the vendor's contact_name or, failing that, the company.
    expect(body).not.toContain('Client Ltd')
    expect(body).not.toContain('Billing')
    expect(body).not.toContain('Dear')
    expect(body).not.toContain('generated automatically')
    expect(body).not.toContain('Best regards')
    expect(body).not.toMatch(/undefined|NaN|Invalid Date/)
  })

  it('asks for what is still to pay, not the invoice total', async () => {
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
    const { supabase } = makeSupabase({ invoice: { total_amount: 120, paid_amount: 20 } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await run()

    const { body } = sentEmail()
    expect(body).toContain(': £100.00, due ')
    expect(body).toContain('Payments received: £20.00')
    expect(body).toContain('Balance due: £100.00')
  })

  // The balance helpers throw on an amount they cannot read. That must not escape to the catch
  // at the bottom of the loop, which raises no alert: the schedule has already moved on, so the
  // draft would be left unsent and nobody told.
  it('keeps the draft and alerts the owner when the wording cannot be built', async () => {
    vi.mocked(resolveInvoiceGreetingName).mockResolvedValue('Sam')
    const { supabase, invoiceUpdate } = makeSupabase({ invoice: { total_amount: 'not a number' } })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    const response = await run()
    const payload = await response.json()

    expect(sendInvoiceEmail).not.toHaveBeenCalled()
    expect(invoiceUpdate).not.toHaveBeenCalled()
    expect(payload.results.send_failed).toBe(1)
    expect(payload.results.failed).toBe(0)
    expect(reportCronFailure).toHaveBeenCalledWith(
      'recurring-invoices',
      expect.objectContaining({
        message: 'Invoice INV-1 was raised but not emailed: the email wording could not be built from the invoice figures',
      }),
      expect.objectContaining({ draft: 'https://management.example.test/invoices/invoice-1' }),
    )
  })
})
