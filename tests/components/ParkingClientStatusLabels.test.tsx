// The parking list names its search box and shows status words from the one label map beside
// the one colour map, never the stored value ("pending_payment", "paid").

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParkingClient from '@/app/(authenticated)/parking/_components/ParkingClient'

const mockListParkingBookings = vi.fn()
const mockGetNotifications = vi.fn()

vi.mock('@/app/actions/parking', () => ({
  createParkingBooking: vi.fn(),
  generateParkingPaymentLink: vi.fn(),
  markParkingBookingPaid: vi.fn(),
  updateParkingBookingStatus: vi.fn(),
  updateParkingBookingDetails: vi.fn(),
  listParkingBookings: (...args: unknown[]) => mockListParkingBookings(...args),
  getParkingBookingNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  getParkingRateConfig: vi.fn(),
  getParkingRateSettings: vi.fn(),
  saveParkingRateConfig: vi.fn(),
}))

vi.mock('@/app/actions/refundActions', () => ({
  getRefundHistory: vi.fn(),
  getParkingPaymentForRefund: vi.fn(),
  processPayPalRefund: vi.fn(),
  processManualRefund: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/parking',
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const permissions = { canCreate: false, canManage: false, canRefund: false }

const BOOKING = {
  id: 'pk-1',
  reference: 'PK-001',
  customer_id: null,
  customer_first_name: 'Ada',
  customer_last_name: 'Lovelace',
  customer_mobile: '+447700900000',
  customer_email: null,
  vehicle_registration: 'AB12CDE',
  vehicle_make: null,
  vehicle_model: null,
  vehicle_colour: null,
  start_at: '2026-10-01T09:00:00Z',
  end_at: '2026-10-01T17:00:00Z',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 12,
  override_price: null,
  payment_due_at: null,
  notes: null,
}

describe('ParkingClient status words and search name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the search box and shows status labels, not stored values', async () => {
    mockListParkingBookings.mockResolvedValue({ data: [BOOKING] })
    render(<ParkingClient permissions={permissions} />)

    expect(screen.getByRole('textbox', { name: 'Search parking bookings' })).toBeInTheDocument()

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Pending payment')).toBeInTheDocument()
    expect(within(table).getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('pending payment')).not.toBeInTheDocument()
    expect(screen.queryByText('pending')).not.toBeInTheDocument()
  })

  it('shows a notification delivery status through the shared delivery map', async () => {
    mockListParkingBookings.mockResolvedValue({ data: [BOOKING] })
    mockGetNotifications.mockResolvedValue({
      data: [
        {
          id: 'n1',
          booking_id: 'pk-1',
          channel: 'sms',
          event_type: 'payment_request',
          status: 'failed',
          sent_at: null,
          retries: 0,
          created_at: '2026-10-01T09:00:00Z',
        },
      ],
    })
    const user = userEvent.setup()
    render(<ParkingClient permissions={permissions} />)

    const table = await screen.findByRole('table')
    await user.click(within(table).getByText('PK-001'))
    await user.click(screen.getByRole('tab', { name: 'Notifications' }))

    const notifications = await screen.findByRole('table')
    expect(within(notifications).getByText('SMS')).toBeInTheDocument()
    // The event in sentence case, as a table cell, from the label map.
    expect(within(notifications).getByText('Payment request')).toBeInTheDocument()
    expect(within(notifications).getByText('Failed')).toBeInTheDocument()
  })
})
