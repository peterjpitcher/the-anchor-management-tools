// Cash variance has one colour rule on every Cashing Up screen: short is danger, over is warning
// (surplus cash is still a discrepancy, never good news), balanced is neutral. The weekly page
// and the dashboard's Total Variance used to show an overage in green.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  CASH_VARIANCE_UI,
  cashVarianceAlertTone,
  cashVarianceKind,
  cashVarianceTextClass,
  cashVarianceTone,
} from '@/app/(authenticated)/cashing-up/_shared/status-ui'
import { WeeklyClient } from '@/app/(authenticated)/cashing-up/weekly/_components/WeeklyClient'
import { DashboardClient } from '@/app/(authenticated)/cashing-up/dashboard/_components/DashboardClient'

vi.mock('@/app/actions/cashing-up', () => ({ getWeeklyDataAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/cashing-up/weekly',
}))

describe('CASH_VARIANCE_UI', () => {
  it('reads short, over and balanced to the penny', () => {
    expect(cashVarianceKind(-0.01)).toBe('shortfall')
    expect(cashVarianceKind(0.01)).toBe('overage')
    expect(cashVarianceKind(0.004)).toBe('balanced')
  })

  it('colours short as danger, over as warning and balanced as neutral, in every form', () => {
    expect(CASH_VARIANCE_UI.shortfall).toEqual({ text: 'text-danger-fg', stat: 'danger', alert: 'danger' })
    expect(CASH_VARIANCE_UI.overage).toEqual({ text: 'text-warning-fg', stat: 'warning', alert: 'warning' })
    expect(cashVarianceTextClass(0)).toBe('text-text-muted')
    expect(cashVarianceTone(0)).toBe('default')
    expect(cashVarianceTone(25)).toBe('warning')
    expect(cashVarianceAlertTone(-5)).toBe('danger')
    expect(cashVarianceAlertTone(0)).toBe('success')
  })
})

describe('cash variance on the weekly page', () => {
  it('shows an overage in amber in the rows, the total and the figure, not in green', () => {
    render(
      <WeeklyClient
        siteId="site-1"
        weekStart="2026-05-18"
        initialData={[
          {
            session_date: '2026-05-23',
            status: 'submitted',
            target_amount: 100,
            total_expected_amount: 100,
            total_counted_amount: 110,
          },
        ]}
      />,
    )

    const dayRow = within(screen.getByText('2026-05-23').closest('tr') as HTMLTableRowElement)
    const totalRow = within(screen.getByText('Total').closest('tr') as HTMLTableRowElement)
    // The cash variance cells (the target variance is the same £10 and keeps more-is-better).
    const [dayCash, dayTarget] = dayRow.getAllByText('£10.00')
    expect(dayCash).toHaveClass('text-warning-fg')
    expect(dayTarget).toHaveClass('text-success-fg')
    expect(totalRow.getAllByText('£10.00')[0]).toHaveClass('text-warning-fg')

    const figure = screen.getAllByText('Cash variance').at(-1)?.closest('div') as HTMLElement
    expect(within(figure).getByText('£10.00')).toHaveClass('text-warning-fg')
    expect(within(figure).getByText('£10.00')).not.toHaveClass('text-success-fg')
  })
})

describe('cash variance on the dashboard', () => {
  it('shows a year that is over on cash in amber, as its rows are', () => {
    render(
      <DashboardClient
        dashboardData={{
          kpis: {
            totalTakings: 1000,
            totalTarget: 1200,
            totalVariance: 12,
            averageDailyTakings: 100,
            daysWithSubmittedSessions: 10,
          },
          tables: { variance: [] },
        }}
        comparisonData={null}
        weeklyProgress={null}
        selectedYear={2026}
      />,
    )

    expect(screen.getByText('£12.00')).toHaveClass('text-warning-fg')
    expect(screen.getByText('£12.00')).not.toHaveClass('text-success-fg')
  })
})
