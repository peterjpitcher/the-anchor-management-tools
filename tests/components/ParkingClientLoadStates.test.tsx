import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParkingClient, { PARKING_SEARCH_DEBOUNCE_MS } from '@/app/(authenticated)/parking/_components/ParkingClient'
import type { ParkingBooking, ParkingRate } from '@/types/parking'
import { getParkingRateConfig, getParkingRateSettings } from '@/app/actions/parking'

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
const managerPermissions = { canCreate: true, canManage: true, canRefund: false }

const BOOKING = {
  id: 'pk-1',
  reference: 'PK-001',
  status: 'confirmed',
  payment_status: 'paid',
  calculated_price: 20,
  override_price: null,
  pricing_breakdown: [],
  start_at: '2026-11-20T09:00:00Z',
  end_at: '2026-11-21T09:00:00Z',
  duration_minutes: 1440,
  customer_first_name: 'Ada',
  customer_last_name: 'Lovelace',
  customer_mobile: '+447700900000',
  vehicle_registration: 'AB12 CDE',
  created_at: '2026-11-01T09:00:00Z',
  updated_at: '2026-11-01T09:00:00Z',
} as unknown as ParkingBooking

const RATE: ParkingRate = {
  id: 'rate-1',
  effective_from: '2026-01-01T00:00:00Z',
  hourly_rate: 2.5,
  daily_rate: 15,
  weekly_rate: 75,
  monthly_rate: 265,
  capacity_override: 12,
  notes: 'Winter rates',
}

describe('ParkingClient load states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the list the server sent without fetching it again on mount', async () => {
    render(<ParkingClient permissions={permissions} initialBookings={{ data: [BOOKING] }} initialRates={null} />)

    expect(screen.getByRole('table')).toHaveTextContent('PK-001')
    expect(screen.getByText('Total Bookings')).toBeInTheDocument()
    // Give any mount effect a chance to run, then prove nothing asked the server.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockListParkingBookings).not.toHaveBeenCalled()
    expect(getParkingRateConfig).not.toHaveBeenCalled()
    expect(getParkingRateSettings).not.toHaveBeenCalled()
  })

  it('still fetches again when a filter changes', async () => {
    mockListParkingBookings.mockResolvedValue({ data: [] })
    render(<ParkingClient permissions={permissions} initialBookings={{ data: [BOOKING] }} initialRates={null} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'cancelled' } })

    await waitFor(() => expect(mockListParkingBookings).toHaveBeenCalledTimes(1))
    expect(mockListParkingBookings).toHaveBeenCalledWith({ status: 'cancelled', paymentStatus: undefined, search: undefined })
    expect(await screen.findByText('No bookings match these filters')).toBeInTheDocument()
  })

  it('waits for the search box to settle and then searches once', async () => {
    vi.useFakeTimers()
    mockListParkingBookings.mockResolvedValue({ data: [BOOKING] })
    render(<ParkingClient permissions={permissions} initialBookings={{ data: [BOOKING] }} initialRates={null} />)

    const box = screen.getByRole('textbox', { name: 'Search parking bookings' })
    for (const value of ['A', 'Ad', 'Ada']) {
      fireEvent.change(box, { target: { value } })
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }
    // 100 ms after the last keystroke: nothing has gone to the server yet.
    expect(mockListParkingBookings).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(PARKING_SEARCH_DEBOUNCE_MS)
    })
    expect(mockListParkingBookings).toHaveBeenCalledTimes(1)
    expect(mockListParkingBookings).toHaveBeenCalledWith({ status: undefined, paymentStatus: undefined, search: 'Ada' })
  })

  it('fills the rates form from the rate row the server sent, without reading it again', async () => {
    render(<ParkingClient permissions={managerPermissions} initialBookings={{ data: [] }} initialRates={{ data: RATE }} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Rates' }))

    expect(screen.getByDisplayValue('2.5')).toBeInTheDocument()
    expect(screen.getByDisplayValue('265')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Winter rates')).toBeInTheDocument()
    expect(getParkingRateConfig).not.toHaveBeenCalled()
    expect(getParkingRateSettings).not.toHaveBeenCalled()
  })

  it('shows a failed server load as a failure, not as an empty list, and recovers on Try Again', async () => {
    render(
      <ParkingClient permissions={permissions} initialBookings={{ error: 'Database unavailable' }} initialRates={null} />
    )

    expect(screen.getByText('Bookings could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
    // Neither the empty-list message nor figures of 0 stand in for the outage.
    expect(screen.queryByText('No bookings yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Bookings')).not.toBeInTheDocument()
    expect(screen.queryAllByText('0 bookings total')).toHaveLength(0)

    mockListParkingBookings.mockResolvedValueOnce({ data: [] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText('No bookings yet')).toBeInTheDocument()
    expect(screen.queryByText('Bookings could not be loaded')).not.toBeInTheDocument()
    expect(screen.getByText('Total Bookings')).toBeInTheDocument()
  })

  it('treats a refetch that throws as a failed load', async () => {
    mockListParkingBookings.mockRejectedValueOnce(new Error('fetch failed'))
    render(<ParkingClient permissions={permissions} initialBookings={{ data: [BOOKING] }} initialRates={null} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by payment' }), { target: { value: 'paid' } })

    await waitFor(() => expect(screen.getByText('Bookings could not be loaded')).toBeInTheDocument())
    expect(screen.queryByText('No bookings yet')).not.toBeInTheDocument()
  })
})
