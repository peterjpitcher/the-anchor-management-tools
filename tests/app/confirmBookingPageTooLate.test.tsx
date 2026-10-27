import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * BK-112: once the table time has started the confirm page offers neither answer and says it is
 * too late to change online, with the pub's number. It used to show both buttons, and "Sorry, I
 * need to cancel" led to "Your table is cancelled" for a booking that stayed confirmed.
 */

const lookup = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/table-bookings/confirm-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/confirm-token')>()),
  lookupConfirmToken: lookup,
}))

import ConfirmBookingPage from '@/app/g/[token]/confirm-booking/page'
import { GUEST_CONTACT } from '@/lib/guest-contact'

function bookingStartingIn(offsetMs: number) {
  return {
    ok: true,
    booking: {
      id: 'tb-1',
      bookingReference: 'TB-0001',
      bookingDate: '2026-09-12',
      bookingTime: '19:30:00',
      startDateTime: new Date(Date.now() + offsetMs).toISOString(),
      partySize: 4,
      status: 'confirmed',
      guestConfirmedAt: null,
      customerFirstName: 'Jane',
    },
  }
}

async function renderPage(state?: string) {
  const page = await ConfirmBookingPage({
    params: Promise.resolve({ token: 'conf-token' }),
    searchParams: Promise.resolve({ state }),
  })
  return render(page)
}

describe('the confirm page after the table time has started', () => {
  it('offers no answer and gives the phone number', async () => {
    lookup.mockResolvedValue(bookingStartingIn(-10 * 60 * 1000))
    const { container } = await renderPage()

    expect(screen.getByRole('heading', { name: "It's too late to change this online" })).toBeInTheDocument()
    expect(container.querySelector('form')).toBeNull()
    expect(screen.getAllByText(GUEST_CONTACT.phoneDisplay).length).toBeGreaterThan(0)
  })

  it('shows the too-late page for the state the route sends', async () => {
    lookup.mockResolvedValue(bookingStartingIn(60 * 60 * 1000))
    await renderPage('too_late')

    expect(screen.getByRole('heading', { name: "It's too late to change this online" })).toBeInTheDocument()
    expect(screen.queryByText('Your table is cancelled')).toBeNull()
  })

  it('still asks before the table time', async () => {
    lookup.mockResolvedValue(bookingStartingIn(60 * 60 * 1000))
    await renderPage()

    expect(screen.getByRole('heading', { name: 'Are you still coming?' })).toBeInTheDocument()
  })
})
