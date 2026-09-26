import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getMileageInsights } from '@/app/actions/mileage'

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

    // The period switch is a header action, which PageLayout renders in the desktop header and
    // the phone nav row, so each label appears twice.
    expect(screen.getAllByText('Financial Year').length).toBeGreaterThan(0)
    expect(screen.queryByText('Annually')).not.toBeInTheDocument()
  })

  it('gives the destination table one sortable column header per column', () => {
    render(
      <MileageInsightsClient
        initialData={{
          bars: [],
          totals: { totalMiles: 118, totalAmountDue: 53.1, tripCount: 5 },
          byDestination: [
            { destinationName: 'Booker Slough', totalMiles: 20, amountDue: 9, tripCount: 1 },
            { destinationName: 'Costco Watford', totalMiles: 118, amountDue: 53.1, tripCount: 5 },
          ],
        }}
      />
    )

    const destination = screen.getByRole('columnheader', { name: 'Destination' })
    expect(Array.from(destination.closest('tr')?.children ?? []).map((cell) => cell.tagName)).toEqual(
      ['TH', 'TH', 'TH', 'TH']
    )
    expect(screen.getByRole('columnheader', { name: 'Amount Due' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Trips' })).toBeInTheDocument()

    // The table opens longest distance first. It is the DS DataTable now, which has no notion of
    // an initial sort column, so no header claims the sort until one is clicked.
    const destinationCells = () =>
      screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(destinationCells()).toEqual(['Costco Watford', 'Booker Slough'])
    const miles = screen.getByRole('columnheader', { name: 'Miles' })
    expect(miles).toHaveAttribute('aria-sort', 'none')

    fireEvent.click(within(miles).getByRole('button'))
    expect(miles).toHaveAttribute('aria-sort', 'ascending')
    expect(destinationCells()).toEqual(['Booker Slough', 'Costco Watford'])
  })

  it('shows a period that fails to load as a failure, not as the previous figures', async () => {
    vi.mocked(getMileageInsights).mockResolvedValue({ success: false, error: 'Database unavailable' })
    render(
      <MileageInsightsClient
        initialData={{
          bars: [],
          totals: { totalMiles: 118, totalAmountDue: 53.1, tripCount: 5 },
          byDestination: [{ destinationName: 'Costco Watford', totalMiles: 118, amountDue: 53.1, tripCount: 5 }],
        }}
      />
    )
    expect(screen.getByText('Costco Watford')).toBeInTheDocument()

    // The period switch is a header action, rendered in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('radio', { name: 'Quarterly' })[0])

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(screen.getByText("Couldn't load this period")).toBeInTheDocument()
    expect(getMileageInsights).toHaveBeenCalledWith('quarterly')
    expect(screen.queryByText('Costco Watford')).not.toBeInTheDocument()
  })
})
