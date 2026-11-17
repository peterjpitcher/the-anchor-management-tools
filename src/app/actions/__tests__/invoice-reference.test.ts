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

import { updateInvoiceReference } from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const INVOICE_ID = 'inv-1'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-003WZ',
    status: 'overdue',
    reference: '20520136',
    internal_notes: null,
    ...overrides,
  }
}

/** Captures the payload the update was called with, and the guard put on it. */
let lastUpdate: Record<string, unknown> | null = null
let lastGuard: { method: string; args: unknown[] } | null = null

function mockClients(row: Record<string, unknown> | null, updateResult?: Record<string, unknown> | null) {
  lastUpdate = null
  lastGuard = null

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
        chain.select = vi.fn().mockReturnValue(chain)
        for (const m of ['eq', 'is']) {
          chain[m] = vi.fn((...args: unknown[]) => {
            if (args[0] === 'reference') lastGuard = { method: m, args }
            return chain
          })
        }
        chain.maybeSingle = vi.fn().mockResolvedValue({
          data: updateResult === null ? null : { id: INVOICE_ID, reference: payload.reference },
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

describe('updateInvoiceReference', () => {
  it('changes the reference on an issued invoice and leaves its status alone', async () => {
    mockClients(invoice())

    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: ' 20553782 ' }))

    expect(result.error).toBeUndefined()
    expect(result.reference).toBe('20553782')
    expect(lastUpdate!.reference).toBe('20553782')
    expect(lastUpdate!.status).toBeUndefined()
    expect(String(lastUpdate!.internal_notes)).toContain('[2026-09-03] Reference changed from 20520136 to 20553782.')
    expect(lastGuard).toEqual({ method: 'eq', args: ['reference', '20520136'] })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      old_values: { reference: '20520136' },
      new_values: expect.objectContaining({ action: 'reference_changed', reference: '20553782' }),
    }))
  })

  it('adds a reference to an invoice that has none, guarding on null', async () => {
    mockClients(invoice({ reference: null }))

    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: 'PO-1' }))

    expect(result.error).toBeUndefined()
    expect(lastUpdate!.reference).toBe('PO-1')
    expect(lastGuard).toEqual({ method: 'is', args: ['reference', null] })
  })

  it('clears the reference when given an empty value', async () => {
    mockClients(invoice())

    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '   ' }))

    expect(result.error).toBeUndefined()
    expect(lastUpdate!.reference).toBeNull()
  })

  it('keeps existing internal notes and adds to them', async () => {
    mockClients(invoice({ internal_notes: 'Kier pays electricity and water.' }))

    await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))

    expect(String(lastUpdate!.internal_notes)).toMatch(/^Kier pays electricity and water\.\n\n\[2026-09-03\] Reference changed/)
  })

  it('works on a paid invoice', async () => {
    mockClients(invoice({ status: 'paid' }))
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))
    expect(result.error).toBeUndefined()
  })

  it.each(['void', 'written_off'])('refuses a %s invoice', async (status) => {
    mockClients(invoice({ status }))
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))
    expect(result.error).toContain('withdrawn')
    expect(lastUpdate).toBeNull()
  })

  it('refuses an OJ Projects billing invoice, whose reference the billing run looks up', async () => {
    mockClients(invoice({ reference: 'OJ Projects 2026-10' }))
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))
    expect(result.error).toMatch(/billing run/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses a new reference that would look like a billing run invoice', async () => {
    mockClients(invoice())
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: 'oj projects 2026-11' }))
    expect(result.error).toMatch(/reserved/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses the same reference', async () => {
    mockClients(invoice())
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20520136' }))
    expect(result.error).toMatch(/already the reference/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses a reference over 100 characters', async () => {
    mockClients(invoice())
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: 'x'.repeat(101) }))
    expect(result.error).toMatch(/at most 100/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses a caller without invoice edit permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))
    expect(result.error).toMatch(/permission/i)
  })

  it('refuses when the invoice no longer carries the reference the editor was showing', async () => {
    // Someone else saved 20553000 while this dialog was open on 20520136.
    mockClients(invoice({ reference: '20553000' }))
    const result = await updateInvoiceReference(
      form({ invoiceId: INVOICE_ID, reference: '20553782', expectedReference: '20520136' }),
    )
    expect(result.error).toMatch(/changed while you were editing/i)
    expect(lastUpdate).toBeNull()
  })

  it('refuses when the editor saw no reference but one has since been added', async () => {
    mockClients(invoice({ reference: '20553000' }))
    const result = await updateInvoiceReference(
      form({ invoiceId: INVOICE_ID, reference: '20553782', expectedReference: '' }),
    )
    expect(result.error).toMatch(/changed while you were editing/i)
    expect(lastUpdate).toBeNull()
  })

  it('saves when the expected reference still matches', async () => {
    mockClients(invoice())
    const result = await updateInvoiceReference(
      form({ invoiceId: INVOICE_ID, reference: '20553782', expectedReference: '20520136' }),
    )
    expect(result.error).toBeUndefined()
    expect(lastUpdate!.reference).toBe('20553782')
  })

  it('reports a concurrent edit rather than silently overwriting it', async () => {
    mockClients(invoice(), null)
    const result = await updateInvoiceReference(form({ invoiceId: INVOICE_ID, reference: '20553782' }))
    expect(result.error).toMatch(/changed while you were editing/i)
  })
})
