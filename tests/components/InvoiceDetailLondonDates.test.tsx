// The invoice detail page around midnight, on the London clock.
//
// The change-due-date modal warns that giving an overdue invoice more time also stops the
// overdue chasers, but only when the new due date is today or later. "Today" was the UTC date,
// which is still yesterday from 00:00 to 00:59 British Summer Time, so choosing yesterday's date
// in that hour showed the warning for a date that is already past.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// 00:30 BST on Friday 2 October 2026 in London; still Thursday 1 October in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'
const OVERDUE_NOTE = /This invoice is marked overdue/

function overdueInvoice(): InvoiceWithDetails {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    vendor_id: 'vendor-1',
    invoice_date: '2026-10-01',
    due_date: '2026-10-01',
    status: 'overdue',
    invoice_discount_percentage: 0,
    subtotal_amount: 100,
    discount_amount: 0,
    vat_amount: 20,
    total_amount: 120,
    paid_amount: 0,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    vendor: {
      id: 'vendor-1',
      name: 'Acme Ltd',
      paypal_payments_enabled: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    line_items: [],
    payments: [
      {
        id: 'payment-1',
        invoice_id: 'invoice-1',
        payment_date: '2026-10-01',
        amount: 20,
        payment_method: 'bank_transfer',
        created_at: '2026-10-01T09:00:00.000Z',
      },
    ],
  }
}

function chooseNewDueDate(isoDate: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Change due date' }))
  fireEvent.change(screen.getByLabelText('New due date'), { target: { value: isoDate } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('InvoiceDetailClient on the London clock', () => {
  it('does not warn about stopping chasers for a due date that is already past in London', () => {
    render(<InvoiceDetailClient initialInvoice={overdueInvoice()} emailConfigured={false} />)

    chooseNewDueDate('2026-10-01')

    expect(screen.queryByText(OVERDUE_NOTE)).not.toBeInTheDocument()
  })

  it('warns about stopping chasers for a due date of today in London', () => {
    render(<InvoiceDetailClient initialInvoice={overdueInvoice()} emailConfigured={false} />)

    chooseNewDueDate('2026-10-02')

    expect(screen.getByText(OVERDUE_NOTE)).toBeInTheDocument()
  })

  it('shows the invoice, due and payment dates as stored, whatever the host zone', () => {
    render(<InvoiceDetailClient initialInvoice={overdueInvoice()} emailConfigured={false} />)

    // Invoice date, due date and the payment date are all Postgres date columns.
    expect(screen.getAllByText('01/10/2026')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Change due date' }))
    expect(screen.getAllByText('01/10/2026')).toHaveLength(4)
  })
})
