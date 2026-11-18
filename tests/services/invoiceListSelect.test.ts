import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: () => '2026-11-18',
}))

import { createClient } from '@/lib/supabase/server'
import { InvoiceService, INVOICE_LIST_SELECT } from '@/services/invoices'

type Call = { method: string; args: unknown[] }

function fakeClient(rows: unknown[]) {
  const calls: Call[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'is', 'in', 'or', 'eq', 'gte', 'lte', 'order', 'range', 'ilike']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: rows, error: null, count: rows.length })
  return { client: { from: vi.fn(() => builder) }, calls }
}

const slimRow = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  reference: 'March work',
  status: 'sent',
  invoice_date: '2026-10-01',
  due_date: '2026-10-15',
  total_amount: 120,
  paid_amount: 20,
  vendor: { id: 'vendor-1', name: 'Acme Supplies' },
  credits: [{ status: 'issued', amount_inc_vat: 10 }],
}

describe('invoice list select', () => {
  beforeEach(() => vi.clearAllMocks())

  it('the list page selects only the list columns, with an exact count', async () => {
    const { client, calls } = fakeClient([slimRow])
    vi.mocked(createClient).mockResolvedValue(client as never)

    const result = await InvoiceService.getInvoiceListRows('unpaid', 1, 20)

    const select = calls.find((call) => call.method === 'select')
    expect(select?.args).toEqual([INVOICE_LIST_SELECT, { count: 'exact' }])
    expect(INVOICE_LIST_SELECT).not.toContain('*')
    for (const column of [
      'id', 'invoice_number', 'reference', 'status', 'invoice_date', 'due_date', 'total_amount',
      'paid_amount', 'vendor:invoice_vendors(id, name)', 'credits:credit_notes(status, amount_inc_vat)',
    ]) {
      expect(INVOICE_LIST_SELECT).toContain(column)
    }
    expect(calls).toContainEqual({ method: 'in', args: ['status', ['draft', 'sent', 'partially_paid', 'overdue']] })
    expect(result.total).toBe(1)
    // A sent invoice past its due date still reads as overdue.
    expect(result.invoices[0]).toEqual({ ...slimRow, status: 'overdue' })
  })

  it('getInvoices (agents) still returns full rows', async () => {
    const { client, calls } = fakeClient([])
    vi.mocked(createClient).mockResolvedValue(client as never)

    await InvoiceService.getInvoices(undefined, 1, 20)

    const select = calls.find((call) => call.method === 'select')
    const clause = String(select?.args[0]).replace(/\s+/g, ' ').trim()
    expect(clause).toBe('*, vendor:invoice_vendors(*), credits:credit_notes(status, amount_inc_vat)')
    expect(select?.args[1]).toEqual({ count: 'exact' })
  })
})
