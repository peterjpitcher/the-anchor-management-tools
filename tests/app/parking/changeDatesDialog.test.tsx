import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/app/actions/parking', () => ({
  previewParkingDateChange: vi.fn(),
  changeParkingBookingDates: vi.fn(),
}))

import { previewParkingDateChange, changeParkingBookingDates } from '@/app/actions/parking'
import { ChangeDatesDialog } from '@/app/(authenticated)/parking/_components/ChangeDatesDialog'
import type { ParkingBooking } from '@/types/parking'

const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
start.setUTCHours(10, 0, 0, 0)
const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

const booking = {
  id: 'booking-1',
  reference: 'PAR-TEST-0001',
  status: 'confirmed',
  payment_status: 'paid',
  start_at: start.toISOString(),
  end_at: end.toISOString(),
  calculated_price: 75,
  override_price: null,
  customer_first_name: 'Leon',
  updated_at: '2026-11-24T09:00:00.000Z',
} as unknown as ParkingBooking

const extraPreview = {
  bookingId: 'booking-1',
  updatedAt: '2026-11-24T09:00:00.000Z',
  oldPrice: 75,
  newPrice: 105,
  netPaid: 75,
  balanceAfter: 30,
  kind: 'extra' as const,
  refundDue: 0,
  refundDefault: 0,
  extraDue: 30,
  insideNoRefundWindow: false,
  started: false,
  ended: false,
  hadOverride: false,
  overridePrice: null,
  canRefund: true,
  paypalRefundPossible: true,
  extendingPaidAvailable: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(previewParkingDateChange).mockResolvedValue({ success: true, data: extraPreview })
  vi.mocked(changeParkingBookingDates).mockResolvedValue({ success: true, textStatus: 'sent' })
})

async function openAndExtend() {
  render(<ChangeDatesDialog open booking={booking} onClose={vi.fn()} onChanged={vi.fn()} />)
  const endInput = screen.getByLabelText(/New end/i) as HTMLInputElement
  const later = new Date(end.getTime() + 2 * 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  // Built in London time as the input expects; the preview is mocked, so the exact minute does not matter.
  fireEvent.change(endInput, {
    target: { value: `${later.getUTCFullYear()}-${pad(later.getUTCMonth() + 1)}-${pad(later.getUTCDate())}T10:00` },
  })
  await screen.findByText('£30.00 extra to pay')
}

describe('ChangeDatesDialog, a paid stay that now costs more', () => {
  it('offers the three choices, with a payment link chosen and its text previewed', async () => {
    await openAndExtend()
    expect(screen.getByLabelText('Text a payment link')).toBeChecked()
    expect(screen.getByLabelText('Paid at the venue')).not.toBeChecked()
    expect(screen.getByLabelText('No extra charge')).not.toBeChecked()
    expect(screen.getByText(/There is £30.00 extra to pay: \[payment link\]/)).toBeInTheDocument()
  })

  it('paid at the venue by card sends that choice and the extra the screen showed', async () => {
    await openAndExtend()
    fireEvent.click(screen.getByLabelText('Paid at the venue'))
    fireEvent.click(screen.getByLabelText('Card terminal'))
    expect(screen.getByText(/Thanks for the £30.00 you paid today/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Save new dates/ }))
    await waitFor(() => expect(changeParkingBookingDates).toHaveBeenCalledTimes(1))
    expect(vi.mocked(changeParkingBookingDates).mock.calls[0][1]).toMatchObject({
      extraChoice: 'venue',
      venueMethod: 'card_terminal',
      expectedExtra: 30,
    })
  })

  it('no extra charge cannot be saved without a reason', async () => {
    await openAndExtend()
    fireEvent.click(screen.getByLabelText('No extra charge'))
    expect(screen.getByRole('button', { name: /Save new dates/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason \(required\)/), { target: { value: 'Flight delayed' } })
    expect(screen.getByRole('button', { name: /Save new dates/ })).toBeEnabled()
  })
})
