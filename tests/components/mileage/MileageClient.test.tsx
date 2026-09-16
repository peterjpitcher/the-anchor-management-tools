import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MileageTrip } from '@/app/actions/mileage'
import type { MileageHeadlineStats } from '@/lib/mileage/stats'

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

const STATS: MileageHeadlineStats = {
  quarter: { from: '2026-04-01', to: '2026-06-30', trips: 4, milesTenths: 988, amountPence: 4446 },
  financialYear: { from: '2026-01-01', to: '2026-12-31', trips: 1600, milesTenths: 51360, amountPence: 2311207 },
  taxYear: { from: '2026-04-06', to: '2027-04-05', trips: 3, milesTenths: 954, amountPence: 4293 },
  drivers: [
    { driverId: 'driver-1', displayName: 'Driver A', taxYearMilesTenths: 954, standardMilesLeftTenths: 99046 },
    { driverId: 'driver-2', displayName: 'Driver B', taxYearMilesTenths: 100005, standardMilesLeftTenths: 0 },
  ],
}

function renderClient(overrides: Partial<React.ComponentProps<typeof MileageClient>> = {}): void {
  render(
    <MileageClient
      initialTrips={[]}
      initialTotal={0}
      initialPage={1}
      initialPageSize={25}
      initialStats={STATS}
      destinations={[]}
      drivers={[{ id: 'driver-1', displayName: 'Driver A', drivesOjProjects: true }]}
      canManage
      {...overrides}
    />
  )
}

function card(label: string): HTMLElement {
  const element = screen.getByText(label).parentElement
  if (!element) throw new Error(`No card labelled ${label}`)
  return element
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

  it('shows the quarter, financial year and tax year totals, and each driver\'s miles left before 25p', () => {
    renderClient()

    expect(card('This quarter')).toHaveTextContent('98.8 mi')
    expect(card('This quarter')).toHaveTextContent('£44.46')
    expect(card('This financial year')).toHaveTextContent('5,136.0 mi')
    expect(card('This financial year')).toHaveTextContent('£23,112.07')
    expect(card('This tax year')).toHaveTextContent('95.4 mi')
    expect(card('This tax year')).toHaveTextContent('£42.93')
    expect(card('Miles left before 25p')).toHaveTextContent('Driver A: 9,904.6 mi, Driver B: 0.0 mi')
    expect(card('Miles left before 25p')).toHaveTextContent('Per person, this tax year')
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('shows zero totals as zero, and says when no drivers are set up', () => {
    const zero = { trips: 0, milesTenths: 0, amountPence: 0 }
    renderClient({
      initialStats: {
        quarter: { from: '2026-07-01', to: '2026-09-30', ...zero },
        financialYear: { from: '2026-01-01', to: '2026-12-31', ...zero },
        taxYear: { from: '2026-04-06', to: '2027-04-05', ...zero },
        drivers: [],
      },
    })

    expect(card('This quarter')).toHaveTextContent('0.0 mi')
    expect(card('This quarter')).toHaveTextContent('£0.00')
    expect(card('Miles left before 25p')).toHaveTextContent('No drivers set up')
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('shows each trip amount in pounds and pence', () => {
    renderClient({
      initialTrips: [trip({ id: 'small' }), trip({ id: 'large', tripDate: '2026-04-02', amountDue: 1234.5 })],
      initialTotal: 2,
    })

    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('£1.53')).toBeInTheDocument()
    expect(within(rows[1]).getByText('£1,234.50')).toBeInTheDocument()
  })
})
