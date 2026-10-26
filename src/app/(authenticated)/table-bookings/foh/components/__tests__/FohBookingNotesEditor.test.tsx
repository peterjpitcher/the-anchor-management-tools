// BK-052: FOH staff can change a booking's notes and allergies from the detail modal, and the
// allergies go to their own field, split the same way as everywhere else.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FohBookingDetailModal } from '../FohBookingDetailModal'
import type { FohBooking } from '../../types'

const postBookingAction = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('../../utils', async (importActual) => ({
  ...(await importActual<typeof import('../../utils')>()),
  postBookingAction,
}))

function makeBooking(overrides: Partial<FohBooking> = {}): FohBooking {
  return {
    id: 'booking-1',
    booking_reference: 'TB-2026-0001',
    guest_name: 'Jo Bloggs',
    booking_time: '19:00',
    party_size: 4,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: 'Window please',
    special_requirements: 'Window please',
    allergies: ['Peanuts'],
    start_datetime: '2026-07-30T18:00:00Z',
    end_datetime: '2026-07-30T20:00:00Z',
    ...overrides,
  }
}

function renderModal(booking: FohBooking, canEdit: boolean, onRunAction = vi.fn(async (action: () => Promise<unknown>) => { await action(); return true })) {
  render(
    <FohBookingDetailModal
      selectedBookingContext={{ booking, laneTableId: null, laneTableName: null }}
      canEdit={canEdit}
      bookingActionInFlight={null}
      showCancelBookingConfirmation={false}
      showNoShowConfirmation={false}
      selectedMoveTarget=""
      selectedMoveOptions={[]}
      loadingSelectedMoveOptions={false}
      onClose={vi.fn()}
      onRunAction={onRunAction}
      onMoveTargetChange={vi.fn()}
      onSetShowCancelBookingConfirmation={vi.fn()}
      onSetShowNoShowConfirmation={vi.fn()}
      onOpenPartySizeEdit={vi.fn()}
      onOpenWalkoutModal={vi.fn()}
      onOpenChangeTime={vi.fn()}
    />
  )
  return onRunAction
}

beforeEach(() => vi.clearAllMocks())

describe('FohBookingDetailModal notes and allergies', () => {
  it('saves the notes and the allergies split into a list', async () => {
    const onRunAction = renderModal(makeBooking(), true)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Notes and Allergies' }))
    expect(screen.getByLabelText('Allergies')).toHaveValue('Peanuts')
    expect(screen.getByLabelText('Notes')).toHaveValue('Window please')

    fireEvent.change(screen.getByLabelText('Allergies'), { target: { value: 'Peanuts, sesame' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }))

    await waitFor(() => expect(onRunAction).toHaveBeenCalled())
    expect(postBookingAction).toHaveBeenCalledWith('/api/foh/bookings/booking-1/notes', {
      notes: 'Window please',
      allergies: ['Peanuts', 'sesame'],
    })
    await waitFor(() => expect(screen.queryByLabelText('Allergies')).toBeNull())
  })

  it('is not offered without edit permission', () => {
    renderModal(makeBooking(), false)
    expect(screen.queryByRole('button', { name: 'Edit Notes and Allergies' })).toBeNull()
  })
})
