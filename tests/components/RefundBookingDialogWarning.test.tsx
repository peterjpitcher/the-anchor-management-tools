import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefundBookingDialog } from '@/app/(authenticated)/events/[id]/RefundBookingDialog'
import { getEventBookingRefundInfo, refundEventBookingManual, type EventBookingRow } from '@/app/actions/events'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

vi.mock('@/app/actions/events', () => ({
  getEventBookingRefundInfo: vi.fn(),
  refundEventBookingManual: vi.fn(),
}))

const PAYMENT_NOT_UPDATED =
  'The refund went through, but the original payment was not updated to show it. Do not refund again: ' +
  'tell the developer so the payment record can be corrected.'

const booking = { id: 'booking-1', paid_amount: 20 } as unknown as EventBookingRow

async function issueRefund() {
  render(<RefundBookingDialog booking={booking} onClose={vi.fn()} onDone={vi.fn()} />)
  const amount = await screen.findByLabelText('Refund amount')
  fireEvent.change(amount, { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: 'Issue Refund' }))
}

describe('RefundBookingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEventBookingRefundInfo).mockResolvedValue({
      success: true,
      data: { canRefund: true, amountPaid: 20, alreadyRefunded: 0, maxRefundable: 20, policySuggestion: 20 },
    } as never)
  })

  it('shows the warning, not "Refund issued", when the payment record did not update', async () => {
    vi.mocked(refundEventBookingManual).mockResolvedValue({
      success: true,
      data: { booking_id: 'booking-1', refund_status: 'succeeded', refund_amount: 20, max_refundable: 20, warning: PAYMENT_NOT_UPDATED },
    })

    await issueRefund()

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(PAYMENT_NOT_UPDATED, { duration: 12000 }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('still confirms an ordinary refund', async () => {
    vi.mocked(refundEventBookingManual).mockResolvedValue({
      success: true,
      data: { booking_id: 'booking-1', refund_status: 'succeeded', refund_amount: 20, max_refundable: 20, warning: null },
    })

    await issueRefund()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Refund issued: £20.00'))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
