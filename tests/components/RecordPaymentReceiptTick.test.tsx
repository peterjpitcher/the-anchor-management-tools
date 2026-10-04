import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RecordPaymentPage from '@/app/(authenticated)/invoices/[id]/payment/page'
import { toast } from '@/ds'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * The receipt tick on Record Payment.
 *
 * Until this, the receipt left the moment the payment was saved and the screen never said so.
 * Now staff see who it goes to and what it says, and can hold it back. The page only ever sends
 * the choice: the server enforces it, and a receipt problem must never read as a failed payment.
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  getInvoice: vi.fn(),
  getReceiptEmailContext: vi.fn(),
  recordPayment: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useParams: () => ({ id: 'invoice-1' }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

vi.mock('@/app/actions/invoices', () => ({
  getInvoice: (...args: unknown[]) => mocks.getInvoice(...args),
  getReceiptEmailContext: (...args: unknown[]) => mocks.getReceiptEmailContext(...args),
  recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
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

const known = (context: { firstName: string | null; to: string | null; ccCount: number }) => ({ context })

async function renderLoaded() {
  render(<RecordPaymentPage />)
  // The form appears once the invoice has loaded; the tick's label once the lookup answers.
  await screen.findByRole('button', { name: 'Record Payment' })
  await waitFor(() => expect(screen.queryByText('Checking who this goes to.')).not.toBeInTheDocument())
  return screen.getByRole('checkbox') as HTMLInputElement
}

/** The FormData the page handed to the server action. */
function submitted(): FormData {
  expect(mocks.recordPayment).toHaveBeenCalledTimes(1)
  return mocks.recordPayment.mock.calls[0][0] as FormData
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInvoice.mockResolvedValue({ invoice })
  mocks.getReceiptEmailContext.mockResolvedValue(known({ firstName: 'Sam', to: 'sam@client.example', ccCount: 1 }))
  mocks.recordPayment.mockResolvedValue({ success: true, payment: { id: 'pay-1' }, receipt: { outcome: 'sent' } })
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'warning').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Record Payment: the receipt tick', () => {
  it('is ticked by default, names the contact and says where the receipt goes', async () => {
    const tick = await renderLoaded()

    expect(screen.getByRole('checkbox', { name: 'Email a receipt to Sam' })).toBe(tick)
    expect(tick).toBeChecked()
    expect(tick).toBeEnabled()
    expect(screen.getByText('Goes to sam@client.example, with 1 copied address.')).toBeInTheDocument()
    expect(mocks.getReceiptEmailContext).toHaveBeenCalledWith('invoice-1')
  })

  it('shows the wording that will be sent, in plain text, and keeps it in step with the amount', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    expect(screen.getByText('Payment received for invoice INV-001')).toBeInTheDocument()
    const wording = screen.getByText(/I've received your payment of/)
    expect(wording).toHaveTextContent('Hi Sam,')
    expect(wording).toHaveTextContent("I've received your payment of £120.00 for invoice INV-001, thank you. That settles the invoice in full. A receipt is attached for your records.")
    expect(wording).toHaveTextContent('Many thanks, Peter Pitcher Orange Jelly Limited 07990 587315')
    // Plain text: no markup of its own inside the wording.
    expect(wording.children).toHaveLength(0)

    const amount = screen.getByRole('spinbutton')
    await user.clear(amount)
    expect(screen.getByText('Enter the amount to see the wording.')).toBeInTheDocument()

    await user.type(amount, '50')
    expect(screen.getByText(/I've received your payment of/)).toHaveTextContent(
      "I've received your payment of £50.00 for invoice INV-001, thank you. That leaves £70.00 still to pay."
    )
  })

  it('says "the customer" and greets "Hi there" when there is no contact name', async () => {
    mocks.getReceiptEmailContext.mockResolvedValue(known({ firstName: null, to: 'accounts@client.example', ccCount: 0 }))

    const tick = await renderLoaded()

    expect(screen.getByRole('checkbox', { name: 'Email a receipt to the customer' })).toBe(tick)
    expect(screen.getByText('Goes to accounts@client.example.')).toBeInTheDocument()
    expect(screen.getByText(/I've received your payment of/)).toHaveTextContent('Hi there,')
  })

  it('sends the choice to the server as true when the tick is left on', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/invoices/invoice-1'))
    expect(submitted().get('send_receipt')).toBe('true')
    expect(submitted().get('amount')).toBe('120')
  })

  it('can be unticked with the keyboard, which hides the wording and sends false', async () => {
    const user = userEvent.setup()
    const tick = await renderLoaded()

    tick.focus()
    await user.keyboard(' ')

    expect(tick).not.toBeChecked()
    expect(screen.queryByText(/I've received your payment of/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1))
    expect(submitted().get('send_receipt')).toBe('false')
  })

  it('says plainly that no receipt can be sent to a client with no email address', async () => {
    const user = userEvent.setup()
    mocks.getReceiptEmailContext.mockResolvedValue(known({ firstName: null, to: null, ccCount: 0 }))

    const tick = await renderLoaded()

    expect(tick).not.toBeChecked()
    expect(tick).toBeDisabled()
    expect(screen.getByText('This client has no email address, so a receipt cannot be sent.')).toBeInTheDocument()
    expect(screen.queryByText(/I've received your payment of/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1))
    expect(submitted().get('send_receipt')).toBe('false')
  })

  it.each([
    ['the lookup returns an error', () => mocks.getReceiptEmailContext.mockResolvedValue({ error: 'permission denied' })],
    ['the lookup throws', () => mocks.getReceiptEmailContext.mockRejectedValue(new Error('network'))],
  ])('says it could not check who the receipt goes to, rather than guessing, when %s', async (_case, arrange) => {
    const user = userEvent.setup()
    arrange()

    const tick = await renderLoaded()

    expect(screen.getByRole('checkbox', { name: 'Email a receipt to the customer' })).toBe(tick)
    expect(screen.getByText(/We could not check who this goes to\./)).toBeInTheDocument()
    expect(screen.queryByText(/Goes to/)).not.toBeInTheDocument()
    // The form still works, and the server decides who gets it.
    expect(tick).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1))
    expect(submitted().get('send_receipt')).toBe('true')
  })

  it('shows a receipt warning on top of the success, never as a failed payment', async () => {
    const user = userEvent.setup()
    const warning = 'Payment recorded, but the receipt email was not sent (Recipient email address is suppressed). Please send the customer a receipt by hand.'
    mocks.recordPayment.mockResolvedValue({
      success: true,
      payment: { id: 'pay-1' },
      receipt: { outcome: 'refused', error: 'Recipient email address is suppressed', attemptLogged: true },
      warning,
    })
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/invoices/invoice-1'))
    expect(toast.success).toHaveBeenCalledWith('Payment recorded successfully!')
    expect(toast.warning).toHaveBeenCalledWith(warning, expect.objectContaining({ duration: expect.any(Number) }))
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no warning when the receipt simply went', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/invoices/invoice-1'))
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('still reports a payment that really failed as an error, and stays on the page', async () => {
    const user = userEvent.setup()
    mocks.recordPayment.mockResolvedValue({ error: 'Payment exceeds the balance' })
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))

    expect(await screen.findByText('Payment exceeds the balance')).toBeInTheDocument()
    expect(mocks.router.push).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
