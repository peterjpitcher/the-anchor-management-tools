import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn().mockReturnValue(false),
  sendInvoiceEmail: vi.fn(),
}))
vi.mock('@/services/invoices', () => ({
  InvoiceService: { getInvoiceById: vi.fn(), recordPayment: vi.fn(), updateInvoiceStatus: vi.fn() },
  CreateInvoiceSchema: { parse: vi.fn() },
}))
vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e as Error)?.message || String(e)),
}))
vi.mock('@/lib/dateUtils', () => ({ getTodayIsoDate: vi.fn(() => '2026-09-03') }))

import { updateInvoiceDueDate } from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

const INVOICE_ID = 'inv-1'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-003WK',
    status: 'partially_paid',
    invoice_date: '2026-09-03',
    due_date: '2026-09-03',
    paid_amount: 250,
    internal_notes: null,
    ...overrides,
  }
}

/** Captures the payload the update was called with. */
let lastUpdate: Record<string, unknown> | null = null

function mockClients(row: Record<string, unknown> | null, updateResult?: Record<string, unknown> | null) {
  lastUpdate = null

  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is']) chain[m] = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({ data: row, error: row ? null : { message: 'not found' } })
      return chain
    }),
  } as any)

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        lastUpdate = payload
        const chain: Record<string, unknown> = {}
        for (const m of ['eq', 'select']) chain[m] = vi.fn().mockReturnValue(chain)
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: updateResult === null
            ? null
            : { id: INVOICE_ID, due_date: payload.due_date, status: payload.status ?? row?.status },
          error: null,
        })
        return chain
      }),
    })),
  } as any)
}

function form(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkUserPermission).mockResolvedValue(true)
})

describe('updateInvoiceDueDate', () => {
  it('moves the due date on an issued invoice', async () => {
    mockClients(invoice())

    const result = await updateInvoiceDueDate(
      form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09', reason: 'Re-issued too close to the event' }),
    )

    expect(result.error).toBeUndefined()
    expect(result.dueDate).toBe('2026-09-09')
    expect(lastUpdate!.due_date).toBe('2026-09-09')
    expect(String(lastUpdate!.internal_notes)).toContain('2026-09-03 to 2026-09-09')
  })

  it('releases an overdue invoice back to partially_paid when time is given', async () => {
    mockClients(invoice({ status: 'overdue', paid_amount: 250 }))

    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09' }))

    expect(result.error).toBeUndefined()
    expect(lastUpdate!.status).toBe('partially_paid')
  })

  it('releases an unpaid overdue invoice back to sent', async () => {
    mockClients(invoice({ status: 'overdue', paid_amount: 0 }))

    await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09' }))

    expect(lastUpdate!.status).toBe('sent')
  })

  it('leaves the status alone when the new date is still in the past', async () => {
    mockClients(invoice({ status: 'overdue', invoice_date: '2026-08-01' }))

    await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-01' }))

    expect(lastUpdate!.status).toBeUndefined()
  })

  it('does not touch the status of an invoice that was never overdue', async () => {
    mockClients(invoice({ status: 'sent' }))

    await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-20' }))

    expect(lastUpdate!.status).toBeUndefined()
  })

  it.each([
    ['void', 'withdrawn'],
    ['written_off', 'withdrawn'],
    ['paid', 'already paid'],
  ])('refuses a %s invoice', async (status, message) => {
    mockClients(invoice({ status }))
    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09' }))
    expect(result.error).toContain(message)
  })

  it('refuses a due date before the invoice date', async () => {
    mockClients(invoice({ invoice_date: '2026-09-03' }))
    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-01' }))
    expect(result.error).toMatch(/before the invoice date/i)
  })

  it('rejects a malformed date rather than writing it', async () => {
    mockClients(invoice())
    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: 'next Tuesday' }))
    expect(result.error).toMatch(/not a valid date/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses a caller without invoice edit permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09' }))
    expect(result.error).toMatch(/permission/i)
  })

  it('reports a concurrent edit rather than silently overwriting it', async () => {
    // The guarded update matches zero rows because someone else moved the date.
    mockClients(invoice(), null)
    const result = await updateInvoiceDueDate(form({ invoiceId: INVOICE_ID, dueDate: '2026-09-09' }))
    expect(result.error).toMatch(/changed while you were editing/i)
  })
})
