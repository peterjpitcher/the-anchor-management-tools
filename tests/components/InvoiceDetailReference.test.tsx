import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * A customer's reference (their PO number) can be added or changed after the invoice has been
 * issued. OJ Projects billing invoices are excluded, because the billing run finds them by it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

// The reminder hold control and the Emails panel sit on this page and call these on mount.
vi.mock('@/app/actions/invoice-reminders', () => ({
  getInvoiceEmailHistory: vi.fn().mockResolvedValue({ history: null }),
  holdInvoiceReminders: vi.fn(),
  resumeInvoiceReminders: vi.fn(),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (_module: string, action: string) => ['create', 'edit'].includes(action),
  }),
}))

const mockUpdateInvoiceReference = vi.fn()
const mockGetInvoice = vi.fn()

vi.mock('@/app/actions/invoices', () => ({
  createCreditNote: vi.fn(),
  getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
  updateInvoiceStatus: vi.fn(),
  deleteInvoice: vi.fn(),
  updateInvoiceDueDate: vi.fn(),
  updateInvoiceReference: (...args: unknown[]) => mockUpdateInvoiceReference(...args),
}))

vi.mock('@/app/actions/oj-projects/invoice-reissue', () => ({
  getOjInvoiceReissuePreview: vi.fn(),
  reissueOjInvoice: vi.fn(),
}))

vi.mock('@/app/actions/invoicePayPalActions', () => ({
  getInvoicePortalLink: vi.fn(),
}))

vi.mock('@/lib/invoices/download-pdf', () => ({
  downloadInvoicePdf: vi.fn(),
}))

const sentInvoice: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-06-01',
  due_date: '2099-06-30',
  status: 'sent',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
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
}

describe('InvoiceDetailClient reference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('changes the reference of an issued invoice', async () => {
    const invoice = { ...sentInvoice, status: 'overdue' as const, reference: '20520136' }
    mockUpdateInvoiceReference.mockResolvedValue({ success: true, reference: '20553782' })
    mockGetInvoice.mockResolvedValue({ invoice: { ...invoice, reference: '20553782' } })
    render(<InvoiceDetailClient initialInvoice={invoice} emailConfigured={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change Reference' }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save Reference' })
    expect(save).toBeDisabled()

    const input = within(dialog).getByLabelText('Reference')
    expect(input).toHaveValue('20520136')
    fireEvent.change(input, { target: { value: '20553782' } })
    fireEvent.click(save)

    await waitFor(() => expect(mockUpdateInvoiceReference).toHaveBeenCalledTimes(1))
    const sent = mockUpdateInvoiceReference.mock.calls[0][0] as FormData
    expect(sent.get('invoiceId')).toBe('invoice-1')
    expect(sent.get('reference')).toBe('20553782')
    expect(sent.get('expectedReference')).toBe('20520136')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('20553782')).toBeInTheDocument()
  })

  it('offers to add a reference when the invoice has none', () => {
    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)
    expect(screen.getByRole('button', { name: 'Add Reference' })).toBeInTheDocument()
  })

  it('keeps the dialog open and shows nothing saved when the action refuses', async () => {
    const invoice = { ...sentInvoice, reference: '20520136' }
    mockUpdateInvoiceReference.mockResolvedValue({ error: 'The invoice changed while you were editing it. Reload and try again.' })
    render(<InvoiceDetailClient initialInvoice={invoice} emailConfigured={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change Reference' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Reference'), { target: { value: '20553782' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Reference' }))

    await waitFor(() => expect(mockUpdateInvoiceReference).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockGetInvoice).not.toHaveBeenCalled()
  })

  it.each([
    ['a void invoice', { status: 'void' as const, reference: '20520136' }],
    ['an OJ Projects billing invoice', { reference: 'OJ Projects 2026-10' }],
  ])('offers no reference change on %s', (_label, overrides) => {
    render(<InvoiceDetailClient initialInvoice={{ ...sentInvoice, ...overrides }} emailConfigured={false} />)
    expect(screen.queryByRole('button', { name: /Reference/ })).not.toBeInTheDocument()
  })
})
