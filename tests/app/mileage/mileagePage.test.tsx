import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTripsMock = vi.hoisted(() => vi.fn())
const getTripStatsMock = vi.hoisted(() => vi.fn())
const getDestinationsMock = vi.hoisted(() => vi.fn())
const getMileageDriversMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mileage',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/mileage', () => ({
  getTrips: getTripsMock,
  getTripStats: getTripStatsMock,
  getDestinations: getDestinationsMock,
}))
vi.mock('@/app/actions/mileage-drivers', () => ({
  getMileageDrivers: getMileageDriversMock,
}))
// The trip list has its own tests; here it only needs to show whether it rendered.
vi.mock('@/app/(authenticated)/mileage/_components/MileageClient', () => ({
  MileageClient: ({ initialTrips, drivers }: { initialTrips: unknown[]; drivers: Array<{ displayName: string }> }) => (
    <>
      <p>{initialTrips.length === 0 ? 'No trips recorded' : `${initialTrips.length} trips`}</p>
      <p>Drivers: {drivers.map((driver) => driver.displayName).join(', ')}</p>
    </>
  ),
}))

import MileagePage from '@/app/(authenticated)/mileage/page'

const STATS = {
  quarterTotalMiles: 0,
  quarterAmountDue: 0,
  calendarYear: 2026,
  calendarYearTotalMiles: 0,
  calendarYearAmountDue: 0,
  taxYearTotalMiles: 0,
  taxYearAmountDue: 0,
  milesToThreshold: 10000,
}

describe('MileagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTripsMock.mockResolvedValue({ success: true, data: [], pageInfo: { trips: [], total: 0, page: 1, pageSize: 25 } })
    getTripStatsMock.mockResolvedValue({ success: true, data: STATS })
    getDestinationsMock.mockResolvedValue({ success: true, data: [] })
    getMileageDriversMock.mockResolvedValue({
      success: true,
      data: [{ id: 'driver-1', displayName: 'Driver A', drivesOjProjects: true }],
    })
  })

  it('shows an error when drivers fail to load, because trips cannot be saved without one', async () => {
    getMileageDriversMock.mockResolvedValue({ error: 'Failed to load drivers' })

    render(await MileagePage())

    expect(screen.getByText("Couldn't load mileage")).toBeInTheDocument()
    expect(screen.getByText('Failed to load drivers')).toBeInTheDocument()
    expect(screen.queryByText('No trips recorded')).not.toBeInTheDocument()
  })

  it('shows an error instead of an empty trip list when trips fail to load', async () => {
    getTripsMock.mockResolvedValue({ error: 'Failed to fetch trips' })

    render(await MileagePage())

    expect(screen.getByText("Couldn't load mileage")).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch trips')).toBeInTheDocument()
    expect(screen.queryByText('No trips recorded')).not.toBeInTheDocument()
  })

  it('shows an error when the totals fail to load', async () => {
    getTripStatsMock.mockResolvedValue({ error: 'Failed to fetch trip stats' })

    render(await MileagePage())

    expect(screen.getByText("Couldn't load mileage")).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch trip stats')).toBeInTheDocument()
    expect(screen.queryByText('No trips recorded')).not.toBeInTheDocument()
  })

  it('shows an error when destinations fail to load', async () => {
    getDestinationsMock.mockResolvedValue({ error: 'mileage trip legs failed: timeout' })

    render(await MileagePage())

    expect(screen.getByText("Couldn't load mileage")).toBeInTheDocument()
    expect(screen.getByText('mileage trip legs failed: timeout')).toBeInTheDocument()
  })

  it('shows the trip list when everything loads', async () => {
    render(await MileagePage())

    expect(screen.getByText('No trips recorded')).toBeInTheDocument()
    expect(screen.getByText('Drivers: Driver A')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load mileage")).not.toBeInTheDocument()
  })
})
