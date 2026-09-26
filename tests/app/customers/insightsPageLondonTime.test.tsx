// The customer insights page is a server component, so it renders on a UTC host. Its
// "Generated" stamp read the host's zone, so during British Summer Time it showed the time an
// hour early, and the day before when the snapshot was built just after midnight.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerInsightsSnapshot } from '@/lib/analytics/customer-insights'

const loadSnapshotMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/customers/insights',
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async (_module: string, action: string) => action === 'view'),
}))
vi.mock('@/lib/analytics/customer-insights', () => ({
  loadCustomerInsightsSnapshot: loadSnapshotMock,
  resolveCustomerInsightsWindow: () => '30d',
}))
// The canvas chart and the campaign form are not under test and need a browser or server actions.
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))
vi.mock('@/components/features/customers/WinBackCampaign', () => ({ WinBackCampaign: () => null }))

import CustomersInsightsPage from '@/app/(authenticated)/customers/insights/page'

const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00.000Z'

function buildSnapshot(): CustomerInsightsSnapshot {
  return {
    generated_at: JUST_AFTER_MIDNIGHT_BST,
    selected_window: {
      key: '30d',
      label: '30 days',
      days: 30,
      since_iso: '2026-09-01T23:30:00.000Z',
      previous_since_iso: '2026-08-02T23:30:00.000Z',
    },
    kpis: {
      total_customers: 1200,
      new_customers: 40,
      previous_new_customers: 40,
      new_customer_growth_percent: 0,
      active_customers: 300,
      repeat_active_customers: 90,
      repeat_rate_percent: 30,
      dormant_customers_90d: 400,
      dormant_high_value_customers_90d: 12,
    },
    booking_mix: {
      total_bookings: 0,
      by_type: { event: 0, table: 0, private: 0, parking: 0 },
      shares_percent: { event: 0, table: 0, private: 0, parking: 0 },
    },
    top_interest_categories: [],
    sms_health: {
      available: true,
      opted_in_customers: 0,
      sms_opt_in_rate_percent: 0,
      sms_at_risk_count: 0,
      sms_at_risk_rate_percent: 0,
      top_failure_reasons: [],
    },
    win_back_candidates: [
      {
        customer_id: 'customer-1',
        name: 'Jane Regular',
        mobile: null,
        total_score: 80,
        // customer_scores.last_booking_date is a Postgres date column.
        last_booking_date: '2026-10-02',
        days_since_last_booking: 120,
        bookings_last_90: 0,
        bookings_last_365: 6,
      },
    ],
    strategic_signals: [],
    data_warnings: [],
  }
}

describe('CustomersInsightsPage, London clock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadSnapshotMock.mockResolvedValue(buildSnapshot())
  })

  it('shows the Generated time on the London clock', async () => {
    render(await CustomersInsightsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('2 Oct 2026, 00:30')).toBeInTheDocument()
  })

  it('shows a last booking date from a date column as that calendar day', async () => {
    render(await CustomersInsightsPage({ searchParams: Promise.resolve({}) }))

    // Rendered twice: the desktop table and the phone cards.
    expect(screen.getAllByText('2 Oct 2026')).toHaveLength(2)
  })
})
