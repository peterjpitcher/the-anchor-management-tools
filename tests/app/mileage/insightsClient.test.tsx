import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mileage/insights',
}))
vi.mock('@/app/actions/mileage', () => ({ getMileageInsights: vi.fn() }))
// The chart draws nothing this test needs, so it is kept out of jsdom.
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))

import { MileageInsightsClient } from '@/app/(authenticated)/mileage/insights/_components/MileageInsightsClient'

describe('MileageInsightsClient', () => {
  it('names the yearly tab as the financial year', () => {
    render(
      <MileageInsightsClient
        initialData={{
          bars: [],
          totals: { totalMiles: 0, totalAmountDue: 0, tripCount: 0 },
          byDestination: [],
        }}
      />
    )

    // The tab bar can render the same labels twice (pills and a narrow-screen picker).
    expect(screen.getAllByText('Financial year').length).toBeGreaterThan(0)
    expect(screen.queryByText('Annually')).not.toBeInTheDocument()
  })

  it('gives the destination table one sortable column header per column', () => {
    render(
      <MileageInsightsClient
        initialData={{
          bars: [],
          totals: { totalMiles: 118, totalAmountDue: 53.1, tripCount: 5 },
          byDestination: [{ destinationName: 'Costco Watford', totalMiles: 118, amountDue: 53.1, tripCount: 5 }],
        }}
      />
    )

    const destination = screen.getByRole('columnheader', { name: 'Destination' })
    expect(Array.from(destination.closest('tr')?.children ?? []).map((cell) => cell.tagName)).toEqual(
      ['TH', 'TH', 'TH', 'TH']
    )
    expect(screen.getByRole('columnheader', { name: 'Miles' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Amount Due' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Trips' })).toBeInTheDocument()
  })
})
