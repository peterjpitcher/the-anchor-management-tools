import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('@/lib/invoices/invoice-token', () => ({
  verifyInvoiceToken: vi.fn(() => 'invoice-1'),
}))

let invoiceRow: Record<string, unknown>
const select = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select,
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn(),
    }),
  }),
}))

vi.mock('@/app/invoice-portal/[token]/InvoicePayClient', () => ({
  InvoicePayClient: () => <button type="button">Pay invoice</button>,
}))

vi.mock('@/app/invoice-portal/[token]/InvoicePayCaptureClient', () => ({
  InvoicePayCaptureClient: () => <div data-testid="capture-payment">Capturing payment</div>,
}))

import InvoicePortalPage from '@/app/invoice-portal/[token]/page'

function invoice(paypalPaymentsEnabled: boolean) {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    status: 'sent',
    total_amount: 120,
    paid_amount: 0,
    invoice_date: '2026-09-01',
    due_date: '2026-09-30',
    sent_at: '2026-09-01T12:00:00.000Z',
    vendor: {
      name: 'Acme Ltd',
      contact_name: 'Alex',
      paypal_payments_enabled: paypalPaymentsEnabled,
    },
  }
}

async function renderPage(searchParams: Record<string, string> = {}) {
  const element = await InvoicePortalPage({
    params: Promise.resolve({ token: 'invoice-token' }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

beforeEach(() => {
  vi.clearAllMocks()
  invoiceRow = invoice(true)

  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.eq = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: invoiceRow, error: null }))
  select.mockReturnValue(chain)
})

describe('invoice payment page', () => {
  it('offers payment for an enabled collectible invoice', async () => {
    await renderPage()

    expect(screen.getByRole('button', { name: 'Pay invoice' })).toBeInTheDocument()
    expect(screen.getByText('Secure payment via PayPal')).toBeInTheDocument()
    expect(select).toHaveBeenCalledWith(expect.stringContaining('paypal_payments_enabled'))
  })

  it('explains that online payment is unavailable for a disabled vendor', async () => {
    invoiceRow = invoice(false)

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Online payment is unavailable' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Hi Alex, please use the payment details on the invoice or contact us if you need help.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Online payment is not available for this invoice.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay invoice' })).not.toBeInTheDocument()
    expect(screen.queryByText('Secure payment via PayPal')).not.toBeInTheDocument()
  })

  it('mounts capture recovery after the vendor is disabled', async () => {
    invoiceRow = invoice(false)

    await renderPage({ payment_pending: '1', token: 'ORDER-1' })

    expect(screen.getByTestId('capture-payment')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay invoice' })).not.toBeInTheDocument()
  })
})
