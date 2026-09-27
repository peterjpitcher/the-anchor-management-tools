import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * The three figures at the top of an invoice: the paid amount reads green, and the outstanding
 * balance reads red only once the invoice is overdue (the same rule as the invoice list).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (_module: string, action: string) => ['create', 'edit'].includes(action),
  }),
}))


vi.mock('@/app/actions/invoices', () => ({
  createCreditNote: vi.fn(),
  getInvoice: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  deleteInvoice: vi.fn(),
  updateInvoiceDueDate: vi.fn(),
}))

vi.mock('@/app/actions/oj-projects/invoice-reissue', () => ({
  getOjInvoiceReissuePreview: vi.fn(),
  reissueOjInvoice: vi.fn(),
}))

vi.mock('@/app/actions/invoicePayPalActions', () => ({
  getInvoicePortalLink: vi.fn(),
  sendInvoicePaymentLink: vi.fn(),
}))

vi.mock('@/lib/invoices/download-pdf', () => ({
  downloadInvoicePdf: vi.fn(),
}))

function invoice(overrides: Partial<InvoiceWithDetails>): InvoiceWithDetails {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    vendor_id: 'vendor-1',
    invoice_date: '2026-06-01',
    due_date: '2026-06-30',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 100,
    discount_amount: 0,
    vat_amount: 20,
    total_amount: 120,
    paid_amount: 30,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    vendor: {
      id: 'vendor-1',
      name: 'Acme Ltd',
      is_active: true,
      paypal_payments_enabled: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    line_items: [],
    payments: [],
    ...overrides,
  }
}

/** The Stat value, not the same amount printed elsewhere on the page. */
function statValue(text: string): HTMLElement {
  const match = screen.getAllByText(text).find((element) => element.className.includes('text-2xl'))
  if (!match) throw new Error(`No stat shows ${text}`)
  return match
}

describe('InvoiceDetailClient figures', () => {
  it('shows the outstanding balance in red on an overdue invoice', () => {
    render(<InvoiceDetailClient initialInvoice={invoice({ status: 'overdue' })} emailConfigured={false} />)

    expect(statValue('£90.00')).toHaveClass('text-danger-fg')
    expect(statValue('£30.00')).toHaveClass('text-success-fg')
  })

  it('keeps the outstanding balance plain while the invoice is not overdue', () => {
    render(<InvoiceDetailClient initialInvoice={invoice({ status: 'sent' })} emailConfigured={false} />)

    expect(statValue('£90.00')).not.toHaveClass('text-danger-fg')
    expect(statValue('£30.00')).toHaveClass('text-success-fg')
  })
})
