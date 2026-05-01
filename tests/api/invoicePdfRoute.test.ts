import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/invoices/[id]/pdf/route'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { generateInvoicePDF } from '@/lib/pdf-generator'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: vi.fn(),
}))

const invoice = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-04-01',
  due_date: '2026-04-15',
  status: 'sent',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
}

function mockSupabaseInvoice(invoiceResult = invoice) {
  const single = vi.fn().mockResolvedValue({ data: invoiceResult, error: null })
  const is = vi.fn(() => ({ single }))
  const eq = vi.fn(() => ({ is }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))

  ;(createClient as unknown as vi.Mock).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    from,
  })
}

describe('invoice PDF route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(generateInvoicePDF as unknown as vi.Mock).mockResolvedValue(Buffer.from('pdf'))
    ;(logAuditEvent as unknown as vi.Mock).mockResolvedValue(undefined)
    mockSupabaseInvoice()
  })

  it('returns inline PDFs by default', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/invoices/invoice-1/pdf'),
      { params: Promise.resolve({ id: 'invoice-1' }) }
    )

    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="invoice-INV-001.pdf"'
    )
  })

  it('returns attachment PDFs when requested for one-click downloads', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/invoices/invoice-1/pdf?download=1'),
      { params: Promise.resolve({ id: 'invoice-1' }) }
    )

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="invoice-INV-001.pdf"'
    )
  })
})
