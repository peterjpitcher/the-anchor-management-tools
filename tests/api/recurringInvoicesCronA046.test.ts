import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/dateUtils', () => ({
  getTodayIsoDate: vi.fn(() => '2026-06-24'),
}))

vi.mock('@/services/invoices', () => ({
  InvoiceService: {
    createInvoiceAsAdmin: vi.fn(),
  },
}))

vi.mock('@/lib/recurringInvoiceSchedule', () => ({
  addDaysIsoDate: vi.fn(() => '2026-07-24'),
  calculateNextInvoiceIsoDate: vi.fn(() => '2026-07-24'),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => true),
  sendInvoiceEmail: vi.fn(),
}))

vi.mock('@/lib/invoice-recipients', () => ({
  resolveVendorInvoiceRecipients: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
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
import { InvoiceService } from '@/services/invoices'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { claimIdempotencyKey, persistIdempotencyResponse } from '@/lib/api/idempotency'
import { reportCronFailure } from '@/lib/cron/alerting'
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
  end_date: null,
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

function makeSupabase() {
  const dueOrder = vi.fn().mockResolvedValue({ data: [recurringInvoice], error: null })
  const dueLte = vi.fn(() => ({ order: dueOrder }))
  const dueEq = vi.fn(() => ({ lte: dueLte }))
  const dueSelect = vi.fn(() => ({ eq: dueEq }))

  const recurringUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'recurring-1' }, error: null })
  const recurringUpdateSelect = vi.fn(() => ({ maybeSingle: recurringUpdateMaybeSingle }))
  const recurringUpdateEq = vi.fn(() => ({ select: recurringUpdateSelect }))
  const recurringUpdate = vi.fn(() => ({ eq: recurringUpdateEq }))

  const invoiceLoadSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'invoice-1',
      invoice_number: 'INV-1',
      status: 'draft',
      vendor: recurringInvoice.vendor,
      line_items: [],
      payments: [],
    },
    error: null,
  })
  const invoiceLoadEq = vi.fn(() => ({ single: invoiceLoadSingle }))
  const invoiceSelect = vi.fn(() => ({ eq: invoiceLoadEq }))

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

  return { supabase, invoiceUpdate, emailLogInsert }
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

describe('recurring invoices cron A-046', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.mocked(sendInvoiceEmail).mockResolvedValue({
      success: false,
      error: 'Graph send failed',
    })
  })

  it('marks generated invoices sent before email so failed sends cannot leave sealed drafts', async () => {
    const { supabase, invoiceUpdate } = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    const response = await GET(new Request('http://localhost/api/cron/recurring-invoices'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.results.send_failed).toBe(1)
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
    expect(sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'invoice-1', status: 'sent' }),
      'billing@example.com',
      expect.any(String),
      expect.any(String),
      [],
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

  it('does not leak raw database errors when loading due recurring invoices fails', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeFetchErrorSupabase() as any)

    const response = await GET(new Request('http://localhost/api/cron/recurring-invoices'))
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

    const response = await GET(new Request('http://localhost/api/cron/recurring-invoices'))
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
