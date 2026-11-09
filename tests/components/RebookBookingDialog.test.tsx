import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Rebook dialog (owner request, 9 November 2026): staff choose the tickets, who is coming when
 * there are fewer tickets than guests, and how the guest pays. Cash or card shows the figure to
 * take before anything is booked.
 */

const actions = vi.hoisted(() => ({ getEventRebookPreview: vi.fn(), rebookLapsedEventBooking: vi.fn() }))
vi.mock('@/app/actions/event-rebook', () => actions)

import { RebookBookingDialog } from '@/app/(authenticated)/events/[id]/RebookBookingDialog'

const helen = {
  bookingId: 'booking-helen',
  customerName: 'Helen Bhoobun',
  seats: 2,
  guests: [{ id: 'g1', name: 'Helen Bhoobun' }, { id: 'g2', name: 'Amar Bhoobun' }],
  doorUnitPrice: 45,
  linkGoesBy: 'email' as const,
  refusal: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.getEventRebookPreview.mockResolvedValue({ success: true, data: helen })
  actions.rebookLapsedEventBooking.mockResolvedValue({
    success: true,
    data: { booking_id: 'new', state: 'confirmed', next_step_url: null, manage_booking_url: null, details_to_follow: false, payment_recorded: true, payment_error: null },
  })
})

describe('RebookBookingDialog', () => {
  it('starts at the old ticket count and says the guest details carry across', async () => {
    render(<RebookBookingDialog bookingId="booking-helen" onClose={vi.fn()} onDone={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Rebook Helen Bhoobun' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tickets')).toHaveValue('2')
    expect(screen.getByText('Guest details carry across: Helen Bhoobun, Amar Bhoobun.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebook and Send Link' })).toBeEnabled()
  })

  it('asks who is coming when there are fewer tickets than guests, and holds the button until one is unticked', async () => {
    render(<RebookBookingDialog bookingId="booking-helen" onClose={vi.fn()} onDone={vi.fn()} />)
    const tickets = await screen.findByLabelText('Tickets')
    fireEvent.change(tickets, { target: { value: '1' } })
    expect(screen.getByText('Who is coming?')).toBeInTheDocument()
    // Changing the count keeps the guests ticked, so staff must choose.
    expect(screen.getByRole('button', { name: 'Rebook and Send Link' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Helen Bhoobun'))
    expect(screen.getByRole('button', { name: 'Rebook and Send Link' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Rebook and Send Link' }))
    await waitFor(() => expect(actions.rebookLapsedEventBooking).toHaveBeenCalledWith({
      bookingId: 'booking-helen',
      seats: 1,
      keepGuestIds: ['g2'],
      payment: 'link',
      confirmedAmount: undefined,
    }))
  })

  it('shows the door price to take for cash and sends that figure', async () => {
    const onClose = vi.fn()
    const onDone = vi.fn()
    render(<RebookBookingDialog bookingId="booking-helen" onClose={onClose} onDone={onDone} />)
    await screen.findByLabelText('Tickets')
    fireEvent.click(screen.getByLabelText('Cash at the bar now'))
    expect(screen.getByText('Take £90.00: 2 tickets at £45.00, the door price.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rebook and Record £90.00' }))
    await waitFor(() => expect(actions.rebookLapsedEventBooking).toHaveBeenCalledWith(expect.objectContaining({ payment: 'cash', confirmedAmount: 90, seats: 2 })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalled()
  })

  it('keeps the dialog open with the error when the booking cannot be made', async () => {
    actions.rebookLapsedEventBooking.mockResolvedValue({ error: 'Only 1 place is left. Nothing was booked.' })
    const onClose = vi.fn()
    render(<RebookBookingDialog bookingId="booking-helen" onClose={onClose} onDone={vi.fn()} />)
    await screen.findByLabelText('Tickets')
    fireEvent.click(screen.getByRole('button', { name: 'Rebook and Send Link' }))
    expect(await screen.findByText('Only 1 place is left. Nothing was booked.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says what still needs doing when the booking is made but the cash is not recorded', async () => {
    actions.rebookLapsedEventBooking.mockResolvedValue({
      success: true,
      data: { booking_id: 'new', state: 'pending_payment', next_step_url: null, manage_booking_url: null, details_to_follow: false, payment_recorded: false, payment_error: 'The booking is made but the payment was not recorded: Failed. Use Cash Paid on the new booking.' },
    })
    render(<RebookBookingDialog bookingId="booking-helen" onClose={vi.fn()} onDone={vi.fn()} />)
    await screen.findByLabelText('Tickets')
    fireEvent.click(screen.getByLabelText('Cash at the bar now'))
    fireEvent.click(screen.getByRole('button', { name: 'Rebook and Record £90.00' }))
    expect(await screen.findByText(/Use Cash Paid on the new booking/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('shows the reason instead of the form when the booking cannot be rebooked', async () => {
    actions.getEventRebookPreview.mockResolvedValue({ success: true, data: { ...helen, refusal: 'This guest already has a confirmed booking for this event.' } })
    render(<RebookBookingDialog bookingId="booking-helen" onClose={vi.fn()} onDone={vi.fn()} />)
    expect(await screen.findByText('This guest already has a confirmed booking for this event.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tickets')).not.toBeInTheDocument()
  })
})
