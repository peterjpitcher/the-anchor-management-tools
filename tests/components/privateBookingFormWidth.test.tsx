import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * The new and edit booking forms are long (five or six cards, rows up to three fields across), so
 * they use the full page width, like the invoice builder. On 26 September 2026 a consistency pass
 * put both in the narrow form column (containerSize="md"). On a 1440px screen the form then
 * filled 54% of the page and sat against the left edge, which the owner reported on
 * 13 October 2026. PageLayout caps its body with a max-w-screen-* class for every size but full.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/private-bookings/new',
}))

const mockGetPrivateBooking = vi.fn()

vi.mock('@/app/actions/privateBookingActions', () => ({
  createPrivateBooking: vi.fn(),
  getPrivateBooking: (...args: unknown[]) => mockGetPrivateBooking(...args),
  updatePrivateBooking: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/components/features/customers/CustomerSearchInput', () => ({ default: () => null }))

import NewPrivateBookingPage from '@/app/(authenticated)/private-bookings/new/page'
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

/** The PageLayout body: the element the page's form sits in directly. */
function pageBodyOf(container: HTMLElement): HTMLElement {
  const form = container.querySelector('form')
  if (!form?.parentElement) throw new Error('The page rendered no form')
  return form.parentElement
}

function expectFullWidth(body: HTMLElement): void {
  expect(body.className).toContain('max-w-full')
  expect(body.className).not.toMatch(/max-w-screen-/)
}

describe('private booking forms use the full page width', () => {
  it('does not put the New Booking form in the narrow form column', async () => {
    const { container } = render(<NewPrivateBookingPage />)

    expect(await screen.findByRole('button', { name: 'Create Booking' })).toBeTruthy()
    expectFullWidth(pageBodyOf(container))
  })

  it('does not put the Edit Booking form in the narrow form column', async () => {
    mockGetPrivateBooking.mockResolvedValue({ data: booking })

    // The page reads its params with use(), so it suspends once before its first render.
    let container: HTMLElement = document.body
    await act(async () => {
      container = render(
        <Suspense fallback={null}>
          <EditPrivateBookingPage params={Promise.resolve({ id: 'booking-1' })} />
        </Suspense>,
      ).container
    })

    expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeTruthy()
    expectFullWidth(pageBodyOf(container))
  })
})
