// Covers the guest-request badges on the FOH booking detail modal: the
// "Step-free table" badge appears only when the guest asked for an accessible
// table, alongside the existing Outside and High chair badges.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FohBookingDetailModal } from '../FohBookingDetailModal'
import type { FohBooking, SelectedBookingContext } from '../../types'

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
    notes: null,
    start_datetime: '2026-07-30T18:00:00Z',
    end_datetime: '2026-07-30T20:00:00Z',
    high_chair_count: 0,
    is_outside_seating: false,
    requires_accessible_table: false,
    ...overrides,
  }
}

function renderModal(booking: FohBooking) {
  const context: SelectedBookingContext = {
    booking,
    laneTableId: null,
    laneTableName: null,
  }

  return render(
    <FohBookingDetailModal
      selectedBookingContext={context}
      canEdit={false}
      bookingActionInFlight={null}
      showCancelBookingConfirmation={false}
      showNoShowConfirmation={false}
      selectedMoveTarget=""
      selectedMoveOptions={[]}
      loadingSelectedMoveOptions={false}
      onClose={vi.fn()}
      onRunAction={vi.fn(async () => true)}
      onMoveTargetChange={vi.fn()}
      onSetShowCancelBookingConfirmation={vi.fn()}
      onSetShowNoShowConfirmation={vi.fn()}
      onOpenPartySizeEdit={vi.fn()}
      onOpenWalkoutModal={vi.fn()}
    />
  )
}

describe('FohBookingDetailModal guest-request badges', () => {
  it('shows the Step-free table badge when the guest asked for an accessible table', () => {
    renderModal(makeBooking({ requires_accessible_table: true }))

    expect(screen.getByText('Step-free table')).toBeTruthy()
  })

  it('does not show the Step-free table badge otherwise', () => {
    renderModal(makeBooking())

    expect(screen.queryByText('Step-free table')).toBeNull()
  })

  it('shows step-free, outside and high-chair badges together', () => {
    renderModal(
      makeBooking({
        requires_accessible_table: true,
        is_outside_seating: true,
        high_chair_count: 2,
      })
    )

    expect(screen.getByText('Step-free table')).toBeTruthy()
    expect(screen.getByText('Outside')).toBeTruthy()
    expect(screen.getByText('High chair ×2')).toBeTruthy()
  })
})
