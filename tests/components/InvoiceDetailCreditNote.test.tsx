import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import type { InvoiceWithDetails } from '@/types/invoices'

const routerRefresh = vi.fn()
const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
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

const mockCreateCreditNote = vi.fn()
const mockGetInvoice = vi.fn()

vi.mock('@/app/actions/invoices', () => ({
  createCreditNote: (...args: unknown[]) => mockCreateCreditNote(...args),
  getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
  updateInvoiceStatus: vi.fn(),
  deleteInvoice: vi.fn(),
}))

vi.mock('@/app/actions/oj-projects/invoice-reissue', () => ({
  getOjInvoiceReissuePreview: vi.fn(),
  reissueOjInvoice: vi.fn(),
}))

vi.mock('@/lib/invoices/download-pdf', () => ({
  downloadInvoicePdf: vi.fn(),
}))

const paidInvoice: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-06-01',
  due_date: '2026-06-30',
  status: 'paid',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 120,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Acme Ltd',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  line_items: [
    {
      id: 'line-1',
      invoice_id: 'invoice-1',
      description: 'Services',
      quantity: 1,
      unit_price: 100,
      discount_percentage: 0,
      vat_rate: 20,
      subtotal_amount: 100,
      discount_amount: 0,
      vat_amount: 20,
      total_amount: 120,
      created_at: '2026-06-01T00:00:00.000Z',
    },
  ],
  payments: [
    {
      id: 'payment-1',
      invoice_id: 'invoice-1',
      payment_date: '2026-06-02',
      amount: 120,
      payment_method: 'bank_transfer',
      created_at: '2026-06-02T00:00:00.000Z',
    },
  ],
}

describe('InvoiceDetailClient credit note UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateCreditNote.mockResolvedValue({
      success: true,
      creditNote: {
        id: 'credit-note-1',
        credit_note_number: 'CN-2026-001',
        amount_inc_vat: 120,
      },
    })
    mockGetInvoice.mockResolvedValue({ invoice: paidInvoice })
  })

  it('surfaces credit note creation for paid invoices', async () => {
    render(<InvoiceDetailClient initialInvoice={paidInvoice} emailConfigured={false} />)

    fireEvent.click(screen.getAllByRole('button', { name: /issue credit note/i })[0])

    const amountInput = await screen.findByLabelText('Amount ex VAT')
    expect(amountInput).toHaveValue(100)

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Refund for billing adjustment' },
    })

    const buttons = screen.getAllByRole('button', { name: /issue credit note/i })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(mockCreateCreditNote).toHaveBeenCalledWith(
        'invoice-1',
        100,
        'Refund for billing adjustment'
      )
    })
    expect(mockGetInvoice).toHaveBeenCalledWith('invoice-1')
  })

  it('uses persisted invoice totals rather than recomputing detail totals from lines', () => {
    const invoiceWithStoredTotals: InvoiceWithDetails = {
      ...paidInvoice,
      status: 'sent',
      paid_amount: 0,
      subtotal_amount: 10,
      vat_amount: 1.23,
      total_amount: 11.23,
      line_items: [{
        ...paidInvoice.line_items[0],
        quantity: 1,
        unit_price: 100,
        vat_rate: 20,
      }],
      payments: [],
    }

    render(<InvoiceDetailClient initialInvoice={invoiceWithStoredTotals} emailConfigured={false} />)

    const lineItemsCard = screen.getByRole('heading', { name: 'Line Items' }).parentElement as HTMLElement

    expect(within(lineItemsCard).getByText('£10.00')).toBeInTheDocument()
    expect(within(lineItemsCard).getByText('£1.23')).toBeInTheDocument()
    expect(within(lineItemsCard).getByText('£11.23')).toBeInTheDocument()
  })

  it('routes the top payment action to record payment instead of marking paid directly', () => {
    const sentInvoice: InvoiceWithDetails = {
      ...paidInvoice,
      status: 'sent',
      paid_amount: 0,
      payments: [],
    }

    render(<InvoiceDetailClient initialInvoice={sentInvoice} emailConfigured={false} />)

    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /record payment/i })[0])

    expect(routerPush).toHaveBeenCalledWith('/invoices/invoice-1/payment')
  })
})
