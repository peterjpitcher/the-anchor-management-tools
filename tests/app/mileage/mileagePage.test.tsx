import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  listMileageTrips: vi.fn(),
  getTripStats: vi.fn(),
  getDestinations: vi.fn(),
  getTripDateRange: vi.fn(),
  getMileageDrivers: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mileage',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: () => '2026-09-15',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/app/actions/mileage', () => ({
  listMileageTrips: mocks.listMileageTrips,
  getTripStats: mocks.getTripStats,
  getDestinations: mocks.getDestinations,
  getTripDateRange: mocks.getTripDateRange,
  getTripForEdit: vi.fn(),
  deleteTrip: vi.fn(),
  exportMileageListCsv: vi.fn(),
}))
vi.mock('@/app/actions/mileage-drivers', () => ({
  getMileageDrivers: mocks.getMileageDrivers,
}))
// The trip form has its own tests and loads rate previews when opened.
vi.mock('@/app/(authenticated)/mileage/_components/TripForm', () => ({ TripForm: () => null }))

import MileagePage from '@/app/(authenticated)/mileage/page'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildDatasetJson } from '../../fixtures/mileage/reportDataset'

const STATS = {
  quarter: { from: '2026-07-01', to: '2026-09-30', trips: 0, milesTenths: 0, amountPence: 0 },
  financialYear: { from: '2026-01-01', to: '2026-12-31', trips: 3, milesTenths: 570, amountPence: 3101 },
  taxYear: { from: '2026-04-06', to: '2027-04-05', trips: 2, milesTenths: 536, amountPence: 2948 },
  drivers: [],
}

function page(params: Record<string, string> = {}) {
  return MileagePage({ searchParams: Promise.resolve(params) })
}

function pageResult(rows: unknown[], totalCount: number, totals = { trips: totalCount, milesTenths: 0, amountPence: 0 }) {
  return { success: true, data: { rows, totalCount, totals } }
}

function expectLoadError(message: string): void {
  expect(screen.getByText("Couldn't load mileage")).toBeInTheDocument()
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(screen.queryByText('No trips recorded')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Period')).not.toBeInTheDocument()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTripStats.mockResolvedValue({ success: true, data: STATS })
  mocks.getDestinations.mockResolvedValue({ success: true, data: [] })
  mocks.getTripDateRange.mockResolvedValue({ success: true, data: { first: '2024-01-05', last: '2026-09-14' } })
  mocks.getMileageDrivers.mockResolvedValue({ success: true, data: [] })
  mocks.listMileageTrips.mockResolvedValue(
    pageResult(parseMileageReportDataset(buildDatasetJson()).trips, 3, { trips: 3, milesTenths: 570, amountPence: 3101 })
  )
})

describe('MileagePage', () => {
  it('shows an error instead of an empty trip list when trips fail to load', async () => {
    mocks.listMileageTrips.mockResolvedValue({ error: "Couldn't load trips. Try again." })

    render(await page())

    expectLoadError("Couldn't load trips. Try again.")
  })

  it('shows an error when the totals fail to load', async () => {
    mocks.getTripStats.mockResolvedValue({ error: 'Failed to fetch trip stats' })
    render(await page())
    expectLoadError('Failed to fetch trip stats')
  })

  it('shows an error rather than made-up zeros when the totals come back empty', async () => {
    mocks.getTripStats.mockResolvedValue({ success: true, data: undefined })
    render(await page())
    expectLoadError('Mileage totals are unavailable')
  })

  it('shows an error when drivers fail to load, because trips cannot be saved without one', async () => {
    mocks.getMileageDrivers.mockResolvedValue({ error: 'Failed to load drivers' })
    render(await page())
    expectLoadError('Failed to load drivers')
  })

  it('shows an error when destinations fail to load', async () => {
    mocks.getDestinations.mockResolvedValue({ error: 'mileage trip legs failed: timeout' })
    render(await page())
    expectLoadError('mileage trip legs failed: timeout')
  })

  it('shows an error when the trip dates for the period list fail to load', async () => {
    mocks.getTripDateRange.mockResolvedValue({ error: 'Failed to load trip dates' })
    render(await page())
    expectLoadError('Failed to load trip dates')
  })

  it('loads the trips the address asks for and shows the results line', async () => {
    render(await page({ from: '2026-04-01', to: '2026-06-30', q: 'shop', sort: 'amount' }))

    expect(mocks.listMileageTrips).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-04-01', to: '2026-06-30', q: 'shop', sort: 'amount', page: 1 })
    )
    expect(screen.getByText('3 trips, 57.0 miles, £31.01')).toBeInTheDocument()
    expect(screen.getByLabelText('Period')).toHaveValue('2026-Q2')
  })

  it('keeps the headline cards, which never follow the filters, and the export and report buttons', async () => {
    render(await page({ q: 'shop' }))

    for (const label of ['This quarter', 'This financial year', 'This tax year', 'Miles left before 25p']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('This financial year').parentElement).toHaveTextContent('57.0 mi')
    expect(screen.getByText('This tax year').parentElement).toHaveTextContent('£29.48')
    expect(screen.getByText('Miles left before 25p').parentElement).toHaveTextContent('No drivers set up')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download report' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Trip' })).toBeInTheDocument()
  })

  it('warns and shows all dates when the dates in the address are invalid', async () => {
    render(await page({ from: '2026-06-30', to: '2026-04-01' }))

    expect(screen.getByText("Those dates weren't valid, so all dates are shown.")).toBeInTheDocument()
    expect(mocks.listMileageTrips).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: null }))
  })

  it('sends a page past the end to the last page', async () => {
    mocks.listMileageTrips.mockResolvedValue(pageResult([], 30))
    await page({ q: 'shop', page: '9' })
    expect(mocks.redirect).toHaveBeenCalledWith('/mileage?q=shop&page=2')
  })

  it('says when no trips match the filters', async () => {
    mocks.listMileageTrips.mockResolvedValue(pageResult([], 0))
    render(await page({ q: 'nowhere' }))
    expect(screen.getByText('No trips match these filters')).toBeInTheDocument()
    expect(screen.getByText('0 trips, 0.0 miles, £0.00')).toBeInTheDocument()
  })

  it('says when there are no trips at all', async () => {
    mocks.listMileageTrips.mockResolvedValue(pageResult([], 0))
    render(await page())
    expect(screen.getByText('No trips recorded')).toBeInTheDocument()
  })
})
