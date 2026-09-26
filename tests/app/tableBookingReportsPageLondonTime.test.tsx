// The table booking reports page is a server component, so it renders on a UTC host. Its
// "Generated" stamp read the host's zone, so during British Summer Time it showed the time an
// hour early, and the day before when the snapshot was built just after midnight.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TableBookingReportsSnapshot } from '@/lib/analytics/table-booking-reports'
import type { UserPermission } from '@/types/rbac'

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

describe('TableBookingReportsPage, London clock', () => {
  it('shows the Generated time on the London clock', async () => {
    render(await TableBookingReportsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('2 Oct 2026, 00:30')).toBeInTheDocument()
  })
})
