import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPaymentsToConfirm } from '@/app/(authenticated)/receipts/_components/ui/CustomerPaymentsToConfirm'
import type { CustomerPaymentToConfirm } from '@/services/receipts/receiptPaymentConfirmations'

const confirmCustomerPayment = vi.fn()
const dismissCustomerPayment = vi.fn()
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/receipts', () => ({
  confirmCustomerPayment: (...args: unknown[]) => confirmCustomerPayment(...args),
  dismissCustomerPayment: (...args: unknown[]) => dismissCustomerPayment(...args),
}))

const KIER: CustomerPaymentToConfirm = {
  matchId: 'match-1',
  transactionId: 'tx-kier',
  date: '2026-09-03',
  details: 'KIER SERVICES LTD-600213-80975313',
  amount: 2520,
  vendorName: 'Kier Services Maintenance South',
  reason: 'several_invoices_fit',
  error: null,
  options: [
    { index: 0, kind: 'record', parts: [{ invoiceId: 'w8', invoiceNumber: 'INV-003W8', amount: 2520, paymentId: null, date: '2026-08-01' }] },
    { index: 1, kind: 'record', parts: [{ invoiceId: 'wd', invoiceNumber: 'INV-003WD', amount: 2520, paymentId: null, date: '2026-09-01' }] },
  ],
  recentInvoices: [
    { invoiceId: 'w8', invoiceNumber: 'INV-003W8', invoiceDate: '2026-08-01', status: 'overdue', total: 2520, outstanding: 2520 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmCustomerPayment.mockResolvedValue({ success: true, invoiceNumbers: ['INV-003W8'] })
  dismissCustomerPayment.mockResolvedValue({ success: true })
})

describe('CustomerPaymentsToConfirm', () => {
  it('shows nothing when no payment is waiting', () => {
    const { container } = render(<CustomerPaymentsToConfirm items={[]} canConfirm />)

    expect(container).toBeEmptyDOMElement()
  })

  it('says what arrived, why it is waiting, and offers each stored choice', () => {
    render(<CustomerPaymentsToConfirm items={[KIER]} canConfirm />)

    expect(screen.getByText('£2,520.00 from Kier Services Maintenance South on 3 September 2026')).toBeInTheDocument()
    expect(screen.getByText('More than one invoice fits this payment exactly. Choose the one it paid.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record against INV-003W8' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Record against INV-003WD' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Not an invoice payment' })).toBeEnabled()
  })

  it('sends back only the payment and the number of the choice', async () => {
    render(<CustomerPaymentsToConfirm items={[KIER]} canConfirm />)

    fireEvent.click(screen.getByRole('button', { name: 'Record against INV-003WD' }))

    await waitFor(() => expect(confirmCustomerPayment).toHaveBeenCalledWith({ matchId: 'match-1', optionIndex: 1 }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Payment recorded on the invoice'))
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the reason when a choice is refused, and changes nothing on screen', async () => {
    confirmCustomerPayment.mockResolvedValue({ error: 'INV-003W8 now owes £0.00, less than £2,520.00. Nothing was recorded.' })
    render(<CustomerPaymentsToConfirm items={[KIER]} canConfirm />)

    fireEvent.click(screen.getByRole('button', { name: 'Record against INV-003W8' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('INV-003W8 now owes £0.00, less than £2,520.00. Nothing was recorded.'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('takes a payment off the list', async () => {
    render(<CustomerPaymentsToConfirm items={[KIER]} canConfirm />)

    fireEvent.click(screen.getByRole('button', { name: 'Not an invoice payment' }))

    await waitFor(() => expect(dismissCustomerPayment).toHaveBeenCalledWith({ matchId: 'match-1' }))
  })

  it('lets someone without permission see the list but not act on it', () => {
    render(<CustomerPaymentsToConfirm items={[KIER]} canConfirm={false} />)

    expect(screen.getByRole('button', { name: 'Record against INV-003W8' })).toBeDisabled()
    expect(screen.getByText('Confirming needs permission to manage receipts and to edit invoices.')).toBeInTheDocument()
  })

  it('offers "Dealt with" when nothing fitted exactly', () => {
    render(<CustomerPaymentsToConfirm items={[{ ...KIER, reason: 'no_exact_fit', options: [] }]} canConfirm />)

    expect(screen.getByRole('button', { name: 'Dealt with' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Record against/ })).not.toBeInTheDocument()
  })

  it('says plainly when the list could not be loaded', () => {
    render(<CustomerPaymentsToConfirm items={[]} canConfirm loadError="The customer payments to confirm could not be loaded." />)

    expect(screen.getByText(/The customer payments to confirm could not be loaded\. Reload the page to try again\./)).toBeInTheDocument()
  })
})
