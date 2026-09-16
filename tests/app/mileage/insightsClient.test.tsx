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
})
