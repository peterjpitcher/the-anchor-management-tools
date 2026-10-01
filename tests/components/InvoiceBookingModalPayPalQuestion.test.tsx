import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InvoiceBookingModal } from '@/app/(authenticated)/private-bookings/[id]/InvoiceBookingModal'
import type { PrivateBookingInvoicePreview } from '@/app/actions/privateBookingInvoice'

/**
 * A first invoice creates the customer's billing record, and the "pay online"
 * link in the email is decided from that record. So the dialog has to get an
 * answer before it sends, and must not ask a customer whose record, and
 * setting, already exist.
 */

function buildPreview(
  overrides: Partial<PrivateBookingInvoicePreview> = {},
): PrivateBookingInvoicePreview {
  return {
    bookingId: '11111111-1111-1111-1111-111111111111',
    customerName: 'Kim Renyard',
    recipientEmail: 'kim@example.com',
    lines: [
      {
        description: 'The Dining Room',
        quantity: 1,
        unitPrice: 500,
        discountPercentage: 0,
        vatRate: 20,
        lineTotal: 500,
      },
    ],
    subtotal: 500,
    vatAmount: 100,
    invoiceTotal: 600,
    paymentsReceived: 0,
    balanceHoldingDeposit: 600,
    balanceDeductingDeposit: 600,
    deposit: null,
    depositWouldOverpay: false,
    suggestedReference: 'Kim Renyard Birthday, 15 October 2026',
    dueDate: '2026-10-08',
    warnings: [],
    sourceHash: 'hash',
    previousTreatment: null,
    createsBillingRecord: true,
    ...overrides,
  }
}

function renderModal(preview: PrivateBookingInvoicePreview) {
  const onConfirm = vi.fn()
  render(
    <InvoiceBookingModal
      open
      onClose={vi.fn()}
      preview={preview}
      loading={false}
      sending={false}
      error={null}
      onConfirm={onConfirm}
    />,
  )
  return { onConfirm, send: screen.getByRole('button', { name: 'Send Invoice' }) }
}

describe('InvoiceBookingModal, the PayPal question on a first invoice', () => {
  it('asks, with neither answer chosen, and will not send until one is', () => {
    const { onConfirm, send } = renderModal(buildPreview())

    expect(
      screen.getByRole('group', { name: /Can Kim pay online by card or PayPal\?/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Yes, add a payment link' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'No, bank transfer only' })).not.toBeChecked()
    expect(screen.getByText(/Choose one to send the invoice/)).toBeInTheDocument()

    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('sends yes, and says what the customer will be asked to pay', () => {
    const { onConfirm, send } = renderModal(buildPreview())

    fireEvent.click(screen.getByRole('radio', { name: 'Yes, add a payment link' }))
    expect(
      screen.getByText('The email includes a link to pay the £600.00 online by card or PayPal.'),
    ).toBeInTheDocument()

    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ paypalPaymentsEnabled: true }),
    )
  })

  it('sends no', () => {
    const { onConfirm, send } = renderModal(buildPreview())

    fireEvent.click(screen.getByRole('radio', { name: 'No, bank transfer only' }))
    fireEvent.click(send)

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ paypalPaymentsEnabled: false }),
    )
  })

  it('does not promise a link when nothing is owed', () => {
    // A fully paid booking has no balance, so the email carries no link
    // whatever the answer. The answer is still saved for later invoices.
    renderModal(buildPreview({ paymentsReceived: 600, balanceHoldingDeposit: 0, balanceDeductingDeposit: 0 }))

    expect(screen.getByText(/Nothing is owed on this invoice, so this email has no link/)).toBeInTheDocument()
    expect(screen.queryByText(/The email includes a link to pay/)).not.toBeInTheDocument()
  })

  it('does not ask a customer who already has a billing record', () => {
    const { onConfirm, send } = renderModal(buildPreview({ createsBillingRecord: false }))

    expect(screen.queryByRole('group', { name: /pay online by card or PayPal/ })).not.toBeInTheDocument()

    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty('paypalPaymentsEnabled')
  })
})
