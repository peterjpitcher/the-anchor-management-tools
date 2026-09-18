import { render, screen, within } from '@testing-library/react'
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

function buildSnapshot(kpis: {
  new_customers: number
  previous_new_customers: number
  new_customer_growth_percent: number
}): CustomerInsightsSnapshot {
  return {
    generated_at: '2026-09-18T09:00:00.000Z',
    selected_window: {
      key: '30d',
      label: '30 days',
      days: 30,
      since_iso: '2026-08-19T09:00:00.000Z',
      previous_since_iso: '2026-07-20T09:00:00.000Z',
    },
    kpis: {
      total_customers: 1200,
      active_customers: 300,
      repeat_active_customers: 90,
      repeat_rate_percent: 30,
      dormant_customers_90d: 400,
      dormant_high_value_customers_90d: 12,
      ...kpis,
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
    win_back_candidates: [],
    strategic_signals: [],
    data_warnings: [],
  }
}

async function renderNewCustomersTile(kpis: Parameters<typeof buildSnapshot>[0]): Promise<HTMLElement> {
  loadSnapshotMock.mockResolvedValue(buildSnapshot(kpis))
  render(await CustomersInsightsPage({ searchParams: Promise.resolve({}) }))

  const tile = screen.getByText('New Customers').closest('div')
  if (!tile) throw new Error('New Customers tile did not render')
  return tile
}

describe('CustomersInsightsPage, New Customers stat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows growth on the previous period as an upward percentage', async () => {
    const tile = await renderNewCustomersTile({
      new_customers: 45,
      previous_new_customers: 40,
      new_customer_growth_percent: 12.5,
    })

    expect(within(tile).getByText('45')).toBeInTheDocument()
    expect(within(tile).getByText('12.5%')).toHaveClass('text-success-fg')
  })

  it('shows a fall as a downward percentage', async () => {
    const tile = await renderNewCustomersTile({
      new_customers: 44,
      previous_new_customers: 48,
      new_customer_growth_percent: -8.3,
    })

    expect(within(tile).getByText('8.3%')).toHaveClass('text-danger-fg')
  })

  it('shows no change as flat, not as growth', async () => {
    const tile = await renderNewCustomersTile({
      new_customers: 40,
      previous_new_customers: 40,
      new_customer_growth_percent: 0,
    })

    expect(within(tile).getByText('0%')).toHaveClass('text-text-muted')
  })
})
