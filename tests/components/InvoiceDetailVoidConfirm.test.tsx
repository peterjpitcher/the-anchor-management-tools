import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * Voiding used two browser confirm() prompts: "Void this invoice?", then, only when the invoice
 * has linked OJ Projects items, a second prompt to void anyway and unbill them. Both are now
 * ConfirmDialogs; these tests pin the same two-step behaviour.
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

const mockUpdateInvoiceStatus = vi.fn()
const mockGetInvoice = vi.fn()

vi.mock('@/app/actions/invoices', () => ({
  createCreditNote: vi.fn(),
  getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
  updateInvoiceStatus: (...args: unknown[]) => mockUpdateInvoiceStatus(...args),
  deleteInvoice: vi.fn(),
  updateInvoiceDueDate: vi.fn(),
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

function statusSent(call: unknown[]): string | null {
  return (call[0] as FormData).get('status') as string | null
}

function forceSent(call: unknown[]): string | null {
  return (call[0] as FormData).get('force') as string | null
}

describe('InvoiceDetailClient void confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetInvoice.mockResolvedValue({ invoice: { ...sentInvoice, status: 'void' } })
  })

  it('asks before voiding and does nothing when cancelled', async () => {
    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)

    // Void is a header action, drawn in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[0])
    expect(await screen.findByText('Void this invoice?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Void this invoice?')).not.toBeInTheDocument())
    expect(mockUpdateInvoiceStatus).not.toHaveBeenCalled()
  })

  it('voids once confirmed', async () => {
    mockUpdateInvoiceStatus.mockResolvedValue({ success: true })
    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)

    // Void is a header action, drawn in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[0])
    await screen.findByText('Void this invoice?')
    const voidButtons = screen.getAllByRole('button', { name: 'Void' })
    fireEvent.click(voidButtons[voidButtons.length - 1])

    await waitFor(() => expect(mockUpdateInvoiceStatus).toHaveBeenCalledTimes(1))
    expect(statusSent(mockUpdateInvoiceStatus.mock.calls[0])).toBe('void')
    expect(forceSent(mockUpdateInvoiceStatus.mock.calls[0])).toBeNull()
  })

  it('asks a second time when OJ Projects items are linked, and forces the void on yes', async () => {
    mockUpdateInvoiceStatus
      .mockResolvedValueOnce({ error: 'This invoice has 3 linked OJ Projects items.', code: 'OJ_LINKED_ITEMS' })
      .mockResolvedValueOnce({ success: true })
    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)

    // Void is a header action, drawn in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[0])
    await screen.findByText('Void this invoice?')
    const voidButtons = screen.getAllByRole('button', { name: 'Void' })
    fireEvent.click(voidButtons[voidButtons.length - 1])

    expect(await screen.findByText('Void and unbill linked OJ Projects items?')).toBeInTheDocument()
    expect(screen.getByText('This invoice has 3 linked OJ Projects items.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Void and Unbill' }))

    await waitFor(() => expect(mockUpdateInvoiceStatus).toHaveBeenCalledTimes(2))
    expect(forceSent(mockUpdateInvoiceStatus.mock.calls[1])).toBe('true')
  })

  it('shows why nothing happened when the second confirm is cancelled', async () => {
    mockUpdateInvoiceStatus.mockResolvedValueOnce({
      error: 'This invoice has 3 linked OJ Projects items.',
      code: 'OJ_LINKED_ITEMS',
    })
    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)

    // Void is a header action, drawn in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' })[0])
    await screen.findByText('Void this invoice?')
    const voidButtons = screen.getAllByRole('button', { name: 'Void' })
    fireEvent.click(voidButtons[voidButtons.length - 1])

    await screen.findByText('Void and unbill linked OJ Projects items?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByText('Void and unbill linked OJ Projects items?')).not.toBeInTheDocument(),
    )
    expect(mockUpdateInvoiceStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByText('This invoice has 3 linked OJ Projects items.')).toBeInTheDocument()
  })
})
