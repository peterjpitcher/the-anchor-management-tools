import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MileageTrip } from '@/app/actions/mileage'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/mileage', () => ({
  getTrips: vi.fn(),
  getTripStats: vi.fn(),
  deleteTrip: vi.fn(),
  exportMileageTripsCsv: vi.fn(),
}))
// The form has its own tests; here it only needs to show which drivers it was given.
vi.mock('@/app/(authenticated)/mileage/_components/TripForm', () => ({
  TripForm: ({ drivers }: { drivers: Array<{ displayName: string }> }) => (
    <p>Form drivers: {drivers.map((driver) => driver.displayName).join(', ')}</p>
  ),
}))

import { MileageClient } from '@/app/(authenticated)/mileage/_components/MileageClient'

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

function trip(overrides: Partial<MileageTrip>): MileageTrip {
  return {
    id: 'trip',
    tripDate: '2026-04-04',
    description: 'Shop One',
    totalMiles: 3.4,
    milesAtStandardRate: 3.4,
    milesAtReducedRate: 0,
    amountDue: 1.53,
    source: 'manual',
    createdAt: '2026-04-04T10:00:00Z',
    routeSummary: 'The Anchor to Shop One and back',
    driverId: null,
    driverName: null,
    driverBasis: null,
    updatedAt: '2026-04-04T10:00:00Z',
    legs: [],
    ...overrides,
  }
}

describe('MileageClient', () => {
  it('shows who drove each trip, and says so when it is not recorded yet', () => {
    render(
      <MileageClient
        initialTrips={[
          trip({ id: 'with-driver', driverId: 'driver-1', driverName: 'Driver A', driverBasis: 'entered' }),
          trip({ id: 'without-driver', tripDate: '2026-04-03' }),
        ]}
        initialTotal={2}
        initialPage={1}
        initialPageSize={25}
        initialStats={STATS}
        destinations={[]}
        drivers={[{ id: 'driver-1', displayName: 'Driver A', drivesOjProjects: true }]}
        canManage
      />
    )

    expect(screen.getByRole('columnheader', { name: /Driver/ })).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('Driver A')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Not recorded')).toBeInTheDocument()
    expect(screen.getByText('Form drivers: Driver A')).toBeInTheDocument()
  })
})
