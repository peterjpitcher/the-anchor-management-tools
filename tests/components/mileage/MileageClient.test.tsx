import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MileageHeadlineStats } from '@/lib/mileage/stats'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  getTripForEdit: vi.fn(),
  deleteTrip: vi.fn(),
  exportMileageListCsv: vi.fn(),
  downloadBlob: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => '/mileage',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/mileage', () => ({
  getTripForEdit: mocks.getTripForEdit,
  deleteTrip: mocks.deleteTrip,
  exportMileageListCsv: mocks.exportMileageListCsv,
}))
vi.mock('@/lib/download-file', () => ({ downloadBlob: mocks.downloadBlob }))
vi.mock('@/ds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ds')>()),
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))
// The form has its own tests; here it only shows whether it is open, for which trip, and for which drivers.
vi.mock('@/app/(authenticated)/mileage/_components/TripForm', () => ({
  TripForm: ({
    open,
    editingTrip,
    drivers,
  }: {
    open: boolean
    editingTrip: { id: string } | null
    drivers: Array<{ displayName: string }>
  }) => (
    <p>
      Form {open ? 'open' : 'closed'} for {editingTrip?.id ?? 'a new trip'} with drivers{' '}
      {drivers.map((driver) => driver.displayName).join(', ')}
    </p>
  ),
}))

import { MileageClient } from '@/app/(authenticated)/mileage/_components/MileageClient'
import { DEFAULT_MILEAGE_LIST_QUERY } from '@/lib/mileage/list-query'
import { buildPeriodPresets } from '@/lib/mileage/period-presets'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildDatasetJson } from '../../fixtures/mileage/reportDataset'

const STATS: MileageHeadlineStats = {
  quarter: { from: '2026-04-01', to: '2026-06-30', trips: 4, milesTenths: 988, amountPence: 4446 },
  financialYear: { from: '2026-01-01', to: '2026-12-31', trips: 1600, milesTenths: 51360, amountPence: 2311207 },
  taxYear: { from: '2026-04-06', to: '2027-04-05', trips: 3, milesTenths: 954, amountPence: 4293 },
  drivers: [
    { driverId: 'driver-1', displayName: 'Driver A', taxYearMilesTenths: 954, standardMilesLeftTenths: 99046 },
    { driverId: 'driver-2', displayName: 'Driver B', taxYearMilesTenths: 100005, standardMilesLeftTenths: 0 },
  ],
}

const ROWS = parseMileageReportDataset(buildDatasetJson()).trips
const [LOGGED] = ROWS
const DRIVERS = [{ id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Driver A', drivesOjProjects: true }]

type ClientProps = React.ComponentProps<typeof MileageClient>

function renderClient(overrides: Partial<ClientProps> = {}): ClientProps {
  const props: ClientProps = {
    query: DEFAULT_MILEAGE_LIST_QUERY,
    warnings: [],
    trips: { rows: ROWS, totalCount: 60, totals: { trips: 60, milesTenths: 12345, amountPence: 678901 } },
    stats: STATS,
    destinations: [],
    drivers: DRIVERS,
    presets: buildPeriodPresets({ today: '2026-09-15', firstTripDate: '2024-01-05', lastTripDate: '2026-09-14' }),
    today: '2026-09-15',
    canManage: true,
    ...overrides,
  }
  render(<MileageClient {...props} />)
  return props
}

function card(label: string): HTMLElement {
  const element = screen.getByText(label).parentElement
  if (!element) throw new Error(`No card labelled ${label}`)
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MileageClient', () => {
  it("shows the quarter, financial year and tax year totals, and each driver's miles left before 25p", () => {
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
      stats: {
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

  it('shows the totals of every filtered trip, not just this page, and passes the drivers to the form', () => {
    renderClient()
    expect(screen.getByText('60 trips, 1,234.5 miles, £6,789.01')).toBeInTheDocument()
    expect(screen.getByText('Showing 1-25 of 60')).toBeInTheDocument()
    expect(screen.getByText(/Form closed for a new trip with drivers Driver A/)).toBeInTheDocument()
  })

  it('puts a sort change in the address and returns to page 1', () => {
    renderClient({ query: { ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', page: 2 } })

    fireEvent.click(screen.getByRole('button', { name: 'Miles' }))

    expect(mocks.replace).toHaveBeenCalledWith('/mileage?q=shop&sort=miles', { scroll: false })
  })

  it('puts a filter change in the address and returns to page 1', () => {
    renderClient({ query: { ...DEFAULT_MILEAGE_LIST_QUERY, page: 2 } })

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'oj_projects' } })

    expect(mocks.replace).toHaveBeenCalledWith('/mileage?source=oj', { scroll: false })
  })

  it('puts the page in the address', () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: '2' }))

    expect(mocks.replace).toHaveBeenCalledWith('/mileage?page=2', { scroll: false })
  })

  it('shows each address warning', () => {
    renderClient({ warnings: ["Those dates weren't valid, so all dates are shown."] })
    expect(screen.getByRole('alert')).toHaveTextContent("Those dates weren't valid, so all dates are shown.")
  })

  it('loads a trip fresh before editing it', async () => {
    mocks.getTripForEdit.mockResolvedValue({ success: true, data: { id: LOGGED.id } })
    renderClient()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit trip on 4 April 2026' })[0])

    expect(await screen.findByText(`Form open for ${LOGGED.id} with drivers Driver A`)).toBeInTheDocument()
    expect(mocks.getTripForEdit).toHaveBeenCalledWith(LOGGED.id)
  })

  it('says so and opens no form when the trip cannot be loaded for editing', async () => {
    mocks.getTripForEdit.mockResolvedValue({ error: 'Trip not found.' })
    renderClient()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit trip on 4 April 2026' })[0])

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Trip not found.'))
    expect(screen.getByText(/Form closed/)).toBeInTheDocument()
  })

  it('offers no edit or delete for OJ Projects trips', () => {
    renderClient()
    expect(screen.queryAllByRole('button', { name: 'Edit trip on 1 May 2026' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Delete trip on 1 May 2026' })).toHaveLength(0)
  })

  it('keeps the delete dialog open and shows the reason when a delete fails', async () => {
    mocks.deleteTrip.mockResolvedValue({ error: 'Trips from OJ Projects cannot be deleted here.' })
    renderClient()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete trip on 4 April 2026' })[0])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(await screen.findByText('Trips from OJ Projects cannot be deleted here.')).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to delete the trip on 4 April 2026/)).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('exports the filtered trips and downloads the file', async () => {
    mocks.exportMileageListCsv.mockResolvedValue({ data: '﻿Date', filename: 'Mileage_Trips_2026-09-15.csv' })
    const query = { ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', driverId: DRIVERS[0].id }
    renderClient({ query })

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Mileage_Trips_2026-09-15.csv'))
    expect(mocks.exportMileageListCsv).toHaveBeenCalledWith(query)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Mileage CSV downloaded.')
  })

  it('shows the export error and downloads nothing', async () => {
    mocks.exportMileageListCsv.mockResolvedValue({ error: 'Too many trips to export at once. Narrow the dates and try again.' })
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Too many trips to export at once. Narrow the dates and try again.')
    )
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('shows an error and downloads nothing when the export request itself fails', async () => {
    mocks.exportMileageListCsv.mockRejectedValue(new TypeError('Failed to fetch'))
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Couldn't export the trips. Nothing was downloaded. Try again.")
    )
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })
})
