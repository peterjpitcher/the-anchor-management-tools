import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/privateBookingActions', () => ({
  closeOutPrivateBooking: vi.fn(),
}))

import { CloseOutPanel } from '@/app/(authenticated)/private-bookings/[id]/CloseOutPanel'

function renderPanel(props: { balanceOutstanding: number; depositLeft: number; invoiced: boolean }): void {
  render(
    <CloseOutPanel
      bookingId="b1"
      {...props}
      canClose
      canRefund={false}
      onOpenRefund={() => {}}
      onClosed={() => {}}
    />,
  )
}

describe('CloseOutPanel', () => {
  it('offers putting the deposit against the bill when it fits inside the balance', () => {
    renderPanel({ balanceOutstanding: 300, depositLeft: 250, invoiced: false })
    expect(screen.getByLabelText('Put against the final bill')).toBeInTheDocument()
  })

  it('does not offer it when the deposit is more than the balance left, and says why', () => {
    renderPanel({ balanceOutstanding: 100, depositLeft: 250, invoiced: false })
    expect(screen.queryByLabelText('Put against the final bill')).not.toBeInTheDocument()
    expect(screen.getByText(/more than the £100\.00 balance left/)).toBeInTheDocument()
  })

  it('sends an invoiced hire to its invoice for the deposit and the balance', () => {
    renderPanel({ balanceOutstanding: 300, depositLeft: 250, invoiced: true })
    expect(screen.queryByLabelText('Put against the final bill')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/settled at the till/)).not.toBeInTheDocument()
    expect(screen.getByText(/record it on the invoice/)).toBeInTheDocument()
    expect(screen.getByText(/balance is on the invoice/)).toBeInTheDocument()
  })
})
