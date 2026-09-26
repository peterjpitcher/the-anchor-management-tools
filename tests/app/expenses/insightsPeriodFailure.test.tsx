import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/expenses/insights',
}))
vi.mock('@/app/actions/expenses', () => ({ getExpenseInsights: vi.fn() }))
// The chart draws nothing this test needs, so it is kept out of jsdom.
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))

import { getExpenseInsights } from '@/app/actions/expenses'
import { ExpensesInsightsClient } from '@/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient'

describe('ExpensesInsightsClient period switch', () => {
  it('shows a period that fails to load as a failure, not as the previous figures', async () => {
    vi.mocked(getExpenseInsights).mockResolvedValue({ success: false, error: 'Database unavailable' })
    render(
      <ExpensesInsightsClient
        initialData={{
          bars: [],
          totals: { totalAmount: 520, totalVat: 86.67, count: 4 },
          byCompany: [{ companyRef: 'Booker', totalAmount: 520, totalVat: 86.67, count: 4 }],
        }}
      />,
    )
    expect(screen.getByText('Booker')).toBeInTheDocument()

    // The period switch is a header action, rendered in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('radio', { name: 'Quarterly' })[0])

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(screen.getByText("Couldn't load this period")).toBeInTheDocument()
    expect(getExpenseInsights).toHaveBeenCalledWith('quarterly')
    expect(screen.queryByText('Booker')).not.toBeInTheDocument()
  })
})
