import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WeeklyClient } from '@/app/(authenticated)/cashing-up/weekly/_components/WeeklyClient'

const getWeeklyDataActionMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/cashing-up', () => ({
  getWeeklyDataAction: getWeeklyDataActionMock,
}))

describe('WeeklyClient', () => {
  it('renders the weekly PDF download link for weeks with data', () => {
    render(
      <WeeklyClient
        siteId="site-1"
        weekStart="2026-05-18"
        initialData={[
          {
            session_date: '2026-05-23',
            status: 'submitted',
            target_amount: 1400,
            total_expected_amount: 1842.33,
            total_counted_amount: 1828.43,
          },
        ]}
      />
    )

    const link = screen.getByRole('link', { name: /download pdf/i })
    expect(link).toHaveAttribute(
      'href',
      '/api/cashup/weekly/print?siteId=site-1&weekStartDate=2026-05-18'
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('derives weekly totals and variances from numeric expected, counted, and target values', () => {
    render(
      <WeeklyClient
        siteId="site-1"
        weekStart="2026-05-18"
        initialData={[
          {
            session_date: '2026-05-23',
            status: 'submitted',
            target_amount: '1400',
            total_expected_amount: '1842.33',
            total_counted_amount: '1828.43',
            total_variance_amount: '999',
          },
          {
            session_date: '2026-05-24',
            status: 'submitted',
            target_amount: '800',
            total_expected_amount: '110',
            total_counted_amount: '100',
            total_variance_amount: '999',
          },
        ]}
      />
    )

    const totalRow = within(screen.getByText('Total').closest('tr') as HTMLTableRowElement)

    expect(totalRow.getByText('£2,200.00')).toBeInTheDocument()
    expect(totalRow.getByText('£1,952.33')).toBeInTheDocument()
    expect(totalRow.getByText('£1,928.43')).toBeInTheDocument()
    expect(totalRow.getByText('£-23.90')).toBeInTheDocument()
    expect(totalRow.getByText('£-271.57')).toBeInTheDocument()

    expect(screen.getAllByText('Cash variance').at(-1)?.closest('div')).toHaveTextContent('£-23.90')
    expect(screen.getAllByText('Vs target').at(-1)?.closest('div')).toHaveTextContent('£-271.57')
  })
})
