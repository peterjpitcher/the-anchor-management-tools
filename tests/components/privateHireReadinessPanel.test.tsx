import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HireReadinessView } from '@/services/private-bookings/readiness'

/**
 * The booking page says what stops a hire being confirmed (review BK-005 and BK-007, owner
 * decision D24): a paid deposit left as a draft, with the reasons recorded when it came in; no
 * room, no guest count, or more guests than the rooms hold; and, for managers, a way to allow
 * more guests than the rooms hold, with a reason.
 */

vi.mock('@/app/actions/privateBookingWorkflow', () => ({
  allowPrivateBookingOverCapacity: vi.fn(async () => ({ success: true })),
}))

import { allowPrivateBookingOverCapacity } from '@/app/actions/privateBookingWorkflow'
import { HireReadinessPanel } from '@/app/(authenticated)/private-bookings/[id]/HireReadinessPanel'

function view(overrides: Partial<HireReadinessView> = {}): HireReadinessView {
  return {
    live: true,
    status: 'draft',
    roomProblems: [],
    paidNotConfirmed: null,
    roomNames: ['The Dining Room'],
    roomCapacity: 50,
    capacityOverride: null,
    contractNotSent: false,
    ...overrides,
  }
}

const OVER = {
  code: 'over_capacity' as const,
  message:
    'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add The Main Area or Entire Pub so the guests fit, or ask a manager to allow it.',
}

describe('the hire readiness panel', () => {
  it('shows a paid deposit that did not confirm the booking, with the reasons', () => {
    render(
      <HireReadinessPanel
        bookingId="booking-1"
        view={view({
          paidNotConfirmed: { reasons: ['Guest count 70 exceeds the maximum capacity of 50 for The Dining Room'], recordedAt: '2026-10-09T19:26:13.000Z' },
          roomProblems: [OVER],
        })}
        guestCount={70}
        canOverrideCapacity={false}
        onChanged={() => {}}
      />
    )

    expect(screen.getByText('Deposit paid, not confirmed')).toBeInTheDocument()
    expect(screen.getByText('Guest count 70 exceeds the maximum capacity of 50 for The Dining Room')).toBeInTheDocument()
    expect(screen.getByText('This hire cannot be confirmed yet')).toBeInTheDocument()
    expect(screen.getByText(OVER.message)).toBeInTheDocument()
    // Staff who cannot override are not offered it.
    expect(screen.queryByRole('button', { name: 'Allow More Guests' })).not.toBeInTheDocument()
  })

  it('says a confirmed hire with no room needs sorting out', () => {
    render(
      <HireReadinessPanel
        bookingId="booking-1"
        view={view({
          status: 'confirmed',
          roomNames: [],
          roomCapacity: null,
          roomProblems: [{ code: 'no_room', message: 'No room is booked for this hire.' }],
        })}
        guestCount={30}
        canOverrideCapacity={true}
        onChanged={() => {}}
      />
    )

    expect(screen.getByText('This confirmed hire needs its rooms sorting out')).toBeInTheDocument()
    expect(screen.getByText('No room is booked for this hire.')).toBeInTheDocument()
  })

  it('lets a manager allow more guests, with a reason', async () => {
    const onChanged = vi.fn()
    render(
      <HireReadinessPanel
        bookingId="booking-1"
        view={view({ roomProblems: [OVER] })}
        guestCount={70}
        canOverrideCapacity={true}
        onChanged={onChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow More Guests' }))
    fireEvent.change(screen.getByLabelText(/Why the guests fit/), { target: { value: 'Standing reception with the garden open' } })
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() =>
      expect(allowPrivateBookingOverCapacity).toHaveBeenCalledWith({
        bookingId: 'booking-1',
        maxGuests: '70',
        reason: 'Standing reception with the garden open',
      })
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  // Review BK-006, owner decision D25: from the moment the deposit is confirmed, a missing contract
  // shows on the booking, not only 14 days before the event.
  it('says the contract has not been sent, and that the booking cannot be confirmed until it is', () => {
    render(
      <HireReadinessPanel bookingId="booking-1" view={view({ contractNotSent: true })} guestCount={40} canOverrideCapacity={false} onChanged={() => {}} />
    )

    expect(screen.getByText('Contract not sent')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The contract has not been sent, so this booking cannot be confirmed. Send it from the Signatures panel, or record that the customer accepted it another way.'
      )
    ).toBeInTheDocument()
  })

  it('shows nothing for a hire that is in order', () => {
    const { container } = render(
      <HireReadinessPanel bookingId="booking-1" view={view()} guestCount={40} canOverrideCapacity={false} onChanged={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says so when the rooms could not be checked', () => {
    render(
      <HireReadinessPanel bookingId="booking-1" view={null} loadFailed guestCount={40} canOverrideCapacity={false} onChanged={() => {}} />
    )
    expect(screen.getByText('Rooms not checked')).toBeInTheDocument()
  })
})
