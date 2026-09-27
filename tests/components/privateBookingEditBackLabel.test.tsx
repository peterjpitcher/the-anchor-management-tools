import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * The edit page is titled with its action ("Edit Booking") and goes back to the booking page,
 * naming it as that page is titled: the customer's name, with "Back to Private Booking" only
 * until the booking has loaded (docs/standards/UI_UX.md, back labels).
 */

// One router object for the whole test: the page reloads the booking whenever it changes.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

const mockGetPrivateBooking = vi.fn()

vi.mock('@/app/actions/privateBookingActions', () => ({
  getPrivateBooking: (...args: unknown[]) => mockGetPrivateBooking(...args),
  updatePrivateBooking: vi.fn(),
}))

vi.mock('@/components/features/customers/CustomerSearchInput', () => ({ default: () => null }))
vi.mock('@/components/private-bookings/EventDetailsRiskSection', () => ({ EventDetailsRiskSection: () => null }))

import EditPrivateBookingPage from '@/app/(authenticated)/private-bookings/[id]/edit/page'

const booking = {
  id: 'booking-1',
  customer_id: null,
  customer_name: 'Jane Doe',
  customer_full_name: 'Jane Doe',
  customer_first_name: 'Jane',
  customer_last_name: 'Doe',
  contact_phone: '+441234567890',
  contact_email: null,
  event_date: '2026-11-14',
  start_time: '18:00:00',
  end_time: '23:00:00',
  event_type: 'Birthday party',
  guest_count: 30,
  status: 'draft',
  deposit_amount: 250,
  total_amount: 0,
  internal_notes: null,
  items: [],
} as unknown as PrivateBookingWithDetails

describe('edit private booking page header', () => {
  it('names the booking page it goes back to once the booking has loaded', async () => {
    let resolveBooking: (value: { data: PrivateBookingWithDetails }) => void = () => {}
    mockGetPrivateBooking.mockReturnValue(new Promise((resolve) => { resolveBooking = resolve }))

    // The page reads its params with use(), so it suspends once before its first render.
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <EditPrivateBookingPage params={Promise.resolve({ id: 'booking-1' })} />
        </Suspense>,
      )
    })

    // The title and the back button render in the desktop header and again in the phone header.
    expect((await screen.findAllByRole('button', { name: 'Back to Private Booking' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { level: 1, name: 'Edit Booking' }).length).toBeGreaterThan(0)

    await act(async () => {
      resolveBooking({ data: booking })
    })

    expect((await screen.findAllByRole('button', { name: 'Back to Jane Doe' })).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { level: 1, name: 'Edit Booking' }).length).toBeGreaterThan(0)
  })
})
