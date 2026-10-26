// BK-097 (customer bookings review of 24 October 2026): website table bookings halved in October
// and nothing showed whether that was fewer visitors, "no tables" answers or a broken step. The
// reports page now shows the weekly website funnel: date checks, searches, empty answers,
// could-not-check answers, refusals, failures and bookings.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TableBookingReportsSnapshot } from '@/lib/analytics/table-booking-reports'
import type { UserPermission } from '@/types/rbac'
import type { WebsiteFunnelResult } from '@/lib/analytics/website-booking-funnel'

const { loadWebsiteBookingFunnel } = vi.hoisted(() => ({ loadWebsiteBookingFunnel: vi.fn() }))
vi.mock('@/lib/analytics/website-booking-funnel', () => ({ loadWebsiteBookingFunnel }))

const managerPermissions: UserPermission[] = [
  { module_name: 'reports', action: 'view' },
  { module_name: 'table_bookings', action: 'view' },
  { module_name: 'table_bookings', action: 'manage' },
]

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/table-bookings/reports',
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => true),
  getUserPermissions: vi.fn(async () => ({ success: true, data: managerPermissions })),
}))
vi.mock('@/lib/analytics/table-booking-reports', () => ({
  loadTableBookingReportsSnapshot: vi.fn(async (): Promise<TableBookingReportsSnapshot> => snapshot),
  resolveTableBookingReportsWindow: () => 'week',
}))
// The canvas chart is not under test and needs a browser.
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))

import TableBookingReportsPage from '@/app/(authenticated)/table-bookings/reports/page'

const bookingCounts = { event: 0, table: 0, private: 0, total: 0 }
const reviewCounts = { sent: 0, clicked: 0, click_rate_percent: 0 }

const snapshot: TableBookingReportsSnapshot = {
  generated_at: '2026-10-01T23:30:00.000Z',
  selected_window: {
    key: 'week',
    label: 'Last 7 days',
    days: 7,
    since_iso: '2026-09-24T23:30:00.000Z',
  },
  lookback_days: { thirty: 30, ninety: 90, year: 365 },
  new_vs_returning: {
    active_guests_last_30: 0,
    new_guests_last_30: 0,
    returning_guests_last_30: 0,
    active_guests_selected_window: 0,
    new_guests_selected_window: 0,
    returning_guests_selected_window: 0,
  },
  bookings_by_type: {
    all_time: bookingCounts,
    last_30_days: bookingCounts,
    selected_window: bookingCounts,
  },
  event_conversion_and_waitlist: {
    bookings_created: 0,
    bookings_confirmed: 0,
    bookings_cancelled: 0,
    waitlist_joined: 0,
    waitlist_offers_sent: 0,
    waitlist_offers_accepted: 0,
    waitlist_offers_expired: 0,
    waitlist_acceptance_rate_percent: 0,
  },
  top_engaged_guests: [],
  event_type_interest_segments: [],
  review_sms_vs_clicks: {
    event: reviewCounts,
    table: reviewCounts,
    total: reviewCounts,
  },
  covers_trend: {
    granularity: 'day',
    buckets: [],
    total_covers: 0,
  },
}

const FUNNEL: WebsiteFunnelResult = {
  weeks: [
    { weekStart: '2026-10-26', dateChecks: 40, searches: 31, noTables: 4, couldNotCheck: 2, refused: 3, failed: 1, bookings: 6 },
    { weekStart: '2026-10-19', dateChecks: 120, searches: 57, noTables: 9, couldNotCheck: 0, refused: 0, failed: 0, bookings: 3 },
  ],
  error: null,
}

describe('TableBookingReportsPage, website booking funnel', () => {
  it('shows each week of the funnel, newest first, with its counts', async () => {
    loadWebsiteBookingFunnel.mockResolvedValue(FUNNEL)
    render(await TableBookingReportsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('Website Booking Funnel')).toBeInTheDocument()
    expect(loadWebsiteBookingFunnel).toHaveBeenCalledWith(8)
    const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '')
    expect(rows).toContain('26 Oct 2026403142316')
    expect(rows).toContain('19 Oct 20261205790003')
  })

  it('says so when the funnel cannot be loaded, rather than showing zeros', async () => {
    loadWebsiteBookingFunnel.mockResolvedValue({ weeks: [], error: 'The website funnel could not be loaded.' })
    render(await TableBookingReportsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('The website funnel could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByText('Date checks')).not.toBeInTheDocument()
  })
})
