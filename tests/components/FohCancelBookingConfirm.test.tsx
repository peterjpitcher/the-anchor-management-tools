import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FohCancelBookingConfirm } from '@/app/(authenticated)/table-bookings/foh/components/FohCancelBookingConfirm'
import type { FohBooking } from '@/app/(authenticated)/table-bookings/foh/types'

/** BK-046: the FOH cancel asks who is cancelling, and only a manager chooses the refund amount. */

const PAID = {
  id: 'b-1',
  status: 'confirmed',
  payment_status: 'completed',
  deposit_amount_locked: 160,
} as unknown as FohBooking

function renderConfirm(canChooseRefund: boolean, booking: FohBooking = PAID) {
  const onConfirm = vi.fn()
  render(
    <FohCancelBookingConfirm
      booking={booking}
      canChooseRefund={canChooseRefund}
      busy={false}
      cancelling={false}
      onKeep={vi.fn()}
      onConfirm={onConfirm}
    />
  )
  return onConfirm
}

describe('FOH cancel confirmation', () => {
  it('will not cancel until someone says who is cancelling', () => {
    const onConfirm = renderConfirm(false)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose who is cancelling.')
  })

  it('sends the pub as the canceller', () => {
    const onConfirm = renderConfirm(false)

    fireEvent.click(screen.getByRole('radio', { name: /The pub is cancelling/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))

    expect(onConfirm).toHaveBeenCalledWith({ cancelledBy: 'venue', refundAmountGbp: null })
  })

  it('offers no refund amount to someone who cannot choose one', () => {
    renderConfirm(false)
    expect(screen.queryByRole('checkbox', { name: /Choose the refund amount/ })).toBeNull()
  })

  it("lets a manager choose the amount, starting from what the guest paid", () => {
    const onConfirm = renderConfirm(true)

    fireEvent.click(screen.getByRole('radio', { name: /The guest asked to cancel/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Choose the refund amount/ }))
    const amount = screen.getByLabelText('Refund (£)')
    expect(amount).toHaveValue(160)
    fireEvent.change(amount, { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }))

    expect(onConfirm).toHaveBeenCalledWith({ cancelledBy: 'guest', refundAmountGbp: 40 })
  })

  it('offers no amount when the booking holds no deposit', () => {
    renderConfirm(true, { ...PAID, payment_status: null, deposit_amount_locked: null } as unknown as FohBooking)
    expect(screen.queryByRole('checkbox', { name: /Choose the refund amount/ })).toBeNull()
  })
})
