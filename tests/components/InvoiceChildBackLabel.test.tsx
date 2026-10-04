import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RecordPaymentPage from '@/app/(authenticated)/invoices/[id]/payment/page'
import EditInvoicePage from '@/app/(authenticated)/invoices/[id]/edit/page'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * The record payment and edit invoice pages go back to the invoice page and name it as that page
 * is titled ("Invoice INV-001"), with "Back to Invoice" only until the invoice has loaded.
 */

// One router object for the whole test: the edit page reloads whenever the router changes.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: 'invoice-1' }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

const mockGetInvoice = vi.fn()

vi.mock('@/app/actions/invoices', () => ({
  getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
  // The record payment page asks who a receipt would go to as it loads.
  getReceiptEmailContext: vi.fn().mockResolvedValue({ context: { firstName: null, to: null, ccCount: 0 } }),
  recordPayment: vi.fn(),
  updateInvoice: vi.fn(),
  getLineItemCatalog: vi.fn().mockResolvedValue({ items: [] }),
}))

vi.mock('@/app/actions/vendors', () => ({
  getVendors: vi.fn().mockResolvedValue({ vendors: [] }),
}))

const invoice: InvoiceWithDetails = {
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
  line_items: [],
  payments: [],
}

describe('Invoice child page back button', () => {
  it('names the invoice page once the invoice has loaded', async () => {
    let resolveInvoice: (value: { invoice: InvoiceWithDetails }) => void = () => {}
    mockGetInvoice.mockReturnValue(new Promise((resolve) => { resolveInvoice = resolve }))

    render(<RecordPaymentPage />)

    expect(screen.getAllByRole('button', { name: 'Back to Invoice' }).length).toBeGreaterThan(0)

    resolveInvoice({ invoice })

    expect((await screen.findAllByRole('button', { name: 'Back to Invoice INV-001' })).length).toBeGreaterThan(0)
  })

  it('does the same on the edit invoice page', async () => {
    let resolveInvoice: (value: { invoice: InvoiceWithDetails }) => void = () => {}
    mockGetInvoice.mockReturnValue(new Promise((resolve) => { resolveInvoice = resolve }))

    render(<EditInvoicePage />)

    expect(screen.getAllByRole('button', { name: 'Back to Invoice' }).length).toBeGreaterThan(0)

    resolveInvoice({ invoice: { ...invoice, status: 'draft' } })

    expect((await screen.findAllByRole('button', { name: 'Back to Invoice INV-001' })).length).toBeGreaterThan(0)
  })
})
