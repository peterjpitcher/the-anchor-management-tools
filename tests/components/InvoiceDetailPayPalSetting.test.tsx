import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import type { InvoiceWithDetails } from '@/types/invoices'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (_module: string, action: string) => action === 'edit',
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

function invoice(paypalPaymentsEnabled: boolean): InvoiceWithDetails {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    vendor_id: 'vendor-1',
    invoice_date: '2026-09-01',
    due_date: '2026-09-30',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 100,
    discount_amount: 0,
    vat_amount: 20,
    total_amount: 120,
    paid_amount: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    vendor: {
      id: 'vendor-1',
      name: 'Acme Ltd',
      paypal_payments_enabled: paypalPaymentsEnabled,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    line_items: [],
    payments: [],
  }
}

describe('InvoiceDetailClient vendor PayPal setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows payment-link actions for an enabled vendor', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)

    expect(screen.getByRole('button', { name: 'Email payment link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy payment link' })).toBeInTheDocument()
  })

  it('hides payment-link actions for a disabled vendor', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(false)} emailConfigured={true} />)

    expect(screen.getAllByRole('button', { name: 'Email' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Email payment link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy payment link' })).not.toBeInTheDocument()
  })
})
