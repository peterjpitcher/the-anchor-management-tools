import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParkingClient from '@/app/(authenticated)/parking/_components/ParkingClient'

const mockListParkingBookings = vi.fn()

vi.mock('@/app/actions/parking', () => ({
  createParkingBooking: vi.fn(),
  generateParkingPaymentLink: vi.fn(),
  markParkingBookingPaid: vi.fn(),
  updateParkingBookingStatus: vi.fn(),
  updateParkingBookingDetails: vi.fn(),
  listParkingBookings: (...args: unknown[]) => mockListParkingBookings(...args),
  getParkingBookingNotifications: vi.fn(),
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

// PageLayout reads the router and the path for its header.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/parking',
}))

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const permissions = { canCreate: false, canManage: false, canRefund: false }

describe('ParkingClient load states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a failed load as a failure, not as an empty list, and recovers on Try Again', async () => {
    mockListParkingBookings.mockResolvedValueOnce({ error: 'Database unavailable' })
    render(<ParkingClient permissions={permissions} />)

    expect(await screen.findByText('Bookings could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
    // Neither the empty-list message nor figures of 0 stand in for the outage.
    expect(screen.queryByText('No bookings yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Bookings')).not.toBeInTheDocument()
    expect(screen.queryByText('0 bookings total')).not.toBeInTheDocument()

    mockListParkingBookings.mockResolvedValueOnce({ data: [] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText('No bookings yet')).toBeInTheDocument()
    expect(screen.queryByText('Bookings could not be loaded')).not.toBeInTheDocument()
    expect(screen.getByText('Total Bookings')).toBeInTheDocument()
  })

  it('shows no figures or count before the first load finishes, only the loading state', () => {
    // Never settles: the page is still on its first load.
    mockListParkingBookings.mockReturnValueOnce(new Promise(() => {}))
    render(<ParkingClient permissions={permissions} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading bookings')
    // PageLayout renders its header twice (desktop and phone), so the subtitle is counted.
    expect(screen.queryAllByText('0 bookings total')).toHaveLength(0)
    expect(screen.queryByText('Total Bookings')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending Payments')).not.toBeInTheDocument()
  })

  it('treats a server action that throws the same way', async () => {
    mockListParkingBookings.mockRejectedValueOnce(new Error('fetch failed'))
    render(<ParkingClient permissions={permissions} />)

    await waitFor(() => expect(screen.getByText('Bookings could not be loaded')).toBeInTheDocument())
    expect(screen.queryByText('No bookings yet')).not.toBeInTheDocument()
  })
})
