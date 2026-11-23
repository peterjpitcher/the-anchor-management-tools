// The booking panel on the floor iPad (owner decisions, 22 November 2026): only the buttons that
// fit the booking's state, Seated and Left never side by side, the reason something is missing as
// words on the screen, one tap with an Undo label instead of a confirm box, and what an action
// said shown inside the panel.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FohBooking } from '../../types'
import type { FohPanelNotice, FohRunAction } from '../../hooks/useFohBookingActions'

vi.mock('../../utils', async (importActual) => ({
  ...(await importActual<typeof import('../../utils')>()),
  postBookingAction: vi.fn(async () => ({ success: true })),
}))

import { FohBookingDetailModal } from '../FohBookingDetailModal'
import { postBookingAction } from '../../utils'

// Booked 7pm to 9pm on 21 November 2026.
const START = '2026-11-21T19:00:00.000Z'
const BEFORE = new Date('2026-11-21T18:30:00.000Z')
const AFTER = new Date('2026-11-21T19:20:00.000Z')

function makeBooking(overrides: Partial<FohBooking> = {}): FohBooking {
  return {
    id: 'booking-1',
    booking_reference: 'TB-0001',
    guest_name: 'Jo Bloggs',
    guest_phone: '+447700900123',
    booking_time: '19:00',
    party_size: 4,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: null,
    start_datetime: START,
    end_datetime: '2026-11-21T21:00:00.000Z',
    ...overrides,
  }
}

function renderPanel(booking: FohBooking, options: { now?: Date; notice?: FohPanelNotice | null; onRunAction?: FohRunAction } = {}) {
  const onRunAction = options.onRunAction ?? vi.fn<FohRunAction>(async (action) => { await action(); return true })
  const onClose = vi.fn()
  render(
    <FohBookingDetailModal
      selectedBookingContext={{ booking, laneTableId: 'table-1', laneTableName: 'Table 1' }}
      canEdit
      bookingActionInFlight={null}
      showCancelBookingConfirmation={false}
      selectedMoveTarget=""
      selectedMoveOptions={[]}
      loadingSelectedMoveOptions={false}
      onClose={onClose}
      onRunAction={onRunAction}
      onMoveTargetChange={vi.fn()}
      onSetShowCancelBookingConfirmation={vi.fn()}
      onOpenPartySizeEdit={vi.fn()}
      onOpenWalkoutModal={vi.fn()}
      onOpenChangeTime={vi.fn()}
      notice={options.notice ?? null}
      onDismissNotice={vi.fn()}
      now={options.now ?? AFTER}
    />
  )
  return { onRunAction, onClose }
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name })

beforeEach(() => vi.clearAllMocks())

describe('the buttons fit the state of the booking', () => {
  it('offers Seated, and neither Left nor No-show, before the booking starts', () => {
    renderPanel(makeBooking(), { now: BEFORE })

    expect(button('Seated')).toBeInTheDocument()
    expect(button('Left')).toBeNull()
    expect(button('No-show')).toBeNull()
    // The reason is on the screen, not in a hover.
    expect(screen.getByText('No-show can be recorded once the booking time has passed.')).toBeInTheDocument()
  })

  it('offers No-show once the booking time has passed, and still not Left', () => {
    renderPanel(makeBooking())

    expect(button('Seated')).toBeInTheDocument()
    expect(button('No-show')).toBeInTheDocument()
    expect(button('Left')).toBeNull()
  })

  it('offers Left, and not Seated or No-show, once the party is seated', () => {
    renderPanel(makeBooking({ seated_at: START }))

    expect(button('Left')).toBeInTheDocument()
    expect(button('Seated')).toBeNull()
    expect(button('No-show')).toBeNull()
  })

  it('offers only to put a party that has left back at its table', () => {
    renderPanel(makeBooking({ seated_at: START, left_at: '2026-11-21T19:15:00.000Z' }))

    expect(button('Back at the table')).toBeInTheDocument()
    expect(button('Seated')).toBeNull()
    expect(button('Left')).toBeNull()
    expect(screen.getByText('This party has left.')).toBeInTheDocument()
  })

  it('offers only Undo no-show for a no-show', () => {
    renderPanel(makeBooking({ status: 'no_show', no_show_at: '2026-11-21T19:40:00.000Z' }))

    expect(button('Undo no-show')).toBeInTheDocument()
    expect(button('Seated')).toBeNull()
    expect(button('Cancel booking')).toBeNull()
    expect(button('Edit party size')).toBeNull()
  })

  it('says why an event table has no No-show or Cancel', () => {
    renderPanel(makeBooking({ booking_purpose: 'event', event_name: 'Quiz Night' }))

    expect(button('No-show')).toBeNull()
    expect(button('Cancel booking')).toBeNull()
    expect(button('Change time')).toBeNull()
    expect(screen.getByText(/done from the event, because this table is tied to an event booking/)).toBeInTheDocument()
  })
})

describe('one tap, then Undo', () => {
  it('seats on one tap, hands over the Undo label and closes the panel', async () => {
    const { onRunAction, onClose } = renderPanel(makeBooking())

    await userEvent.click(screen.getByRole('button', { name: 'Seated' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(postBookingAction).toHaveBeenCalledWith('/api/foh/bookings/booking-1/seated', undefined)
    expect(onRunAction).toHaveBeenCalledWith(expect.any(Function), 'Marked as seated', 'seated', { undoLabel: 'Jo Bloggs marked as seated' })
  })

  it('records a no-show on one tap, with no confirm step', async () => {
    const { onRunAction } = renderPanel(makeBooking())

    await userEvent.click(screen.getByRole('button', { name: 'No-show' }))

    await waitFor(() => expect(postBookingAction).toHaveBeenCalledWith('/api/foh/bookings/booking-1/no-show', undefined))
    expect(onRunAction).toHaveBeenCalledWith(expect.any(Function), 'No-show recorded', 'no_show', { undoLabel: 'Jo Bloggs marked as a no-show' })
    expect(screen.queryByText(/confirm no-show/i)).toBeNull()
  })

  it('puts a no-show back through the undo route, with the stamp it carries', async () => {
    renderPanel(makeBooking({ status: 'no_show', no_show_at: '2026-11-21T19:40:00.000Z' }))

    await userEvent.click(screen.getByRole('button', { name: 'Undo no-show' }))

    await waitFor(() =>
      expect(postBookingAction).toHaveBeenCalledWith('/api/foh/bookings/booking-1/undo', {
        action: 'no_show',
        stamp: '2026-11-21T19:40:00.000Z',
      })
    )
  })

  it('keeps the panel open when the action fails', async () => {
    const onRunAction = vi.fn<FohRunAction>(async () => false)
    const { onClose } = renderPanel(makeBooking(), { onRunAction })

    await userEvent.click(screen.getByRole('button', { name: 'Seated' }))

    await waitFor(() => expect(onRunAction).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('what the panel shows', () => {
  it('shows an error inside the panel, not only on the page underneath', () => {
    renderPanel(makeBooking(), {
      notice: { tone: 'danger', text: 'Booking cannot be seated until the required deposit is paid.' },
    })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Booking cannot be seated until the required deposit is paid.')
  })

  it('shows a success inside the panel as a status, not an alert', () => {
    renderPanel(makeBooking(), { notice: { tone: 'success', text: 'Notes and allergies saved' } })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Notes and allergies saved')).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('shows the guest phone number as a link staff can ring', () => {
    renderPanel(makeBooking())

    expect(screen.getByRole('link', { name: '+447700900123' })).toHaveAttribute('href', 'tel:+447700900123')
  })

  it('shows times in 12 hour format', () => {
    renderPanel(makeBooking())

    expect(screen.getByText(/7pm - 9pm · 4 people/)).toBeInTheDocument()
  })

  it('says in plain words why a private hire table cannot be changed', () => {
    renderPanel(makeBooking({ is_private_block: true, status: 'private_block', guest_phone: null }))

    expect(screen.getByText(/held for a private hire, so it cannot be booked or changed from here/)).toBeInTheDocument()
    expect(screen.queryByText(/area mapping/)).toBeNull()
  })
})
