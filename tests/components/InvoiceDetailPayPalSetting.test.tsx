import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceDetailClient from '@/app/(authenticated)/invoices/[id]/InvoiceDetailClient'
import { getInvoicePortalLink } from '@/app/actions/invoicePayPalActions'
import { toast } from '@/ds'
import type { InvoiceWithDetails } from '@/types/invoices'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

/** What each email dialog was last rendered with, so the props handed down can be read. */
const dialogProps = vi.hoisted(() => ({
  email: null as Record<string, unknown> | null,
  chase: null as Record<string, unknown> | null,
}))

// The two email dialogs are loaded with next/dynamic. Each is stood in by a stub that keeps
// its props and shows a named dialog while open. They are told apart by the module the
// loader imports.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const which = /ChasePaymentModal/.test(String(loader)) ? 'chase' : 'email'
    return function DialogStub(props: Record<string, unknown>) {
      dialogProps[which] = props
      return props.isOpen
        ? <div role="dialog" aria-label={which === 'chase' ? 'Chase Payment' : 'Email Invoice'} />
        : null
    }
  },
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
    dialogProps.email = null
    dialogProps.chase = null
  })

  it('shows payment-link actions for an enabled vendor', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)

    expect(screen.getByRole('button', { name: 'Resend Invoice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Payment Link' })).toBeInTheDocument()
  })

  it('hides payment-link actions for a disabled vendor', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(false)} emailConfigured={true} />)

    expect(screen.getAllByRole('button', { name: 'Email Invoice' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Resend Invoice' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy Payment Link' })).not.toBeInTheDocument()
  })
})

/**
 * The separate "payment link" email was retired on 4 October 2026: every invoice email
 * already carries the link as a P.S. Its button now reopens the ordinary Email Invoice
 * dialog, and nothing on this page suggests sending a payment link over WhatsApp, because
 * invoices are chased by email only.
 */
describe('InvoiceDetailClient resending the invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialogProps.email = null
    dialogProps.chase = null
  })

  it('has no Email Payment Link button any more', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)

    expect(screen.queryByRole('button', { name: /email payment link/i })).not.toBeInTheDocument()
  })

  it('opens the Email Invoice dialog from Resend Invoice', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)
    expect(screen.queryByRole('dialog', { name: 'Email Invoice' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resend Invoice' }))

    expect(screen.getByRole('dialog', { name: 'Email Invoice' })).toBeInTheDocument()
  })

  it('offers no resend when email is not set up, but still lets the link be copied', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={false} />)

    expect(screen.queryByRole('button', { name: 'Resend Invoice' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Payment Link' })).toBeInTheDocument()
  })

  it('confirms a copied link without mentioning WhatsApp', async () => {
    vi.mocked(getInvoicePortalLink).mockResolvedValue({ url: 'https://management.example.test/invoice-portal/token' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id')

    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Payment Link' }))

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith('https://management.example.test/invoice-portal/token')
    expect(success).toHaveBeenCalledWith('Payment link copied, ready to paste into an email')
    expect(String(success.mock.calls[0][0])).not.toMatch(/whatsapp/i)
    success.mockRestore()
  })
})

describe('InvoiceDetailClient greeting handed to the email dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialogProps.email = null
    dialogProps.chase = null
  })

  it('passes the server-resolved first name to both dialogs and the booking date to the chase', () => {
    render(
      <InvoiceDetailClient
        initialInvoice={invoice(true)}
        emailConfigured={true}
        emailGreetingName="Priya"
        emailBookingEventDate="2026-11-14"
      />,
    )

    expect(dialogProps.email).toMatchObject({ greetingName: 'Priya' })
    expect(dialogProps.chase).toMatchObject({ greetingName: 'Priya', bookingEventDate: '2026-11-14' })
  })

  it('passes no name when the server found none, so the dialogs greet "Hi there"', () => {
    render(<InvoiceDetailClient initialInvoice={invoice(true)} emailConfigured={true} />)

    expect(dialogProps.email).toMatchObject({ greetingName: null })
    expect(dialogProps.chase).toMatchObject({ greetingName: null, bookingEventDate: null })
  })
})
