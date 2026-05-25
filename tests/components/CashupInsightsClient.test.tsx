import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/cashing-up', () => ({
  getInsightsDataAction: vi.fn(),
}))

import { InsightsClient } from '@/app/(authenticated)/cashing-up/insights/_components/InsightsClient'
import type { CashupInsightsData } from '@/types/cashing-up'

const insightData: CashupInsightsData = {
  dayOfWeek: [
    { dayName: 'Monday', avgTakings: 100, avgVariance: 0 },
    { dayName: 'Tuesday', avgTakings: 120, avgVariance: 0 },
    { dayName: 'Wednesday', avgTakings: 90, avgVariance: 0 },
    { dayName: 'Thursday', avgTakings: 110, avgVariance: 0 },
    { dayName: 'Friday', avgTakings: 160, avgVariance: 0 },
    { dayName: 'Saturday', avgTakings: 180, avgVariance: 0 },
    { dayName: 'Sunday', avgTakings: 130, avgVariance: 0 },
  ],
  paymentMix: [
    { label: 'Card', value: 300, percentage: 100, color: '#3B82F6' },
  ],
  salesMix: [
    { label: 'Drinks', value: 150, percentage: 50, color: '#2563EB' },
    { label: 'Food', value: 100, percentage: 33.333, color: '#16A34A' },
    { label: 'Other', value: 50, percentage: 16.667, color: '#F59E0B' },
  ],
  salesMixMonthly: [
    {
      monthStart: '2026-01-01',
      monthLabel: 'Jan 26',
      drinksSales: 150,
      foodSales: 100,
      otherSales: 50,
      totalSales: 300,
      drinksPercentage: 50,
      foodPercentage: 33.333,
      otherPercentage: 16.667,
    },
  ],
  monthlyGrowth: [
    { monthLabel: 'Jan 26', totalTakings: 300, targetTakings: 250 },
  ],
}

describe('InsightsClient', () => {
  it('renders the monthly drinks, food, and other sales mix chart', () => {
    render(<InsightsClient initialData={insightData} />)

    expect(screen.getByRole('heading', { name: 'Sales Mix' })).toBeInTheDocument()
    expect(screen.getByText('Monthly drinks, food, and other sales with split percentage')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('33.3%')).toBeInTheDocument()
    expect(screen.getByText('16.7%')).toBeInTheDocument()
    expect(screen.getByText('£150')).toBeInTheDocument()
    expect(screen.getAllByText('£100').length).toBeGreaterThan(0)
    expect(screen.getByText('£50')).toBeInTheDocument()
  })
})
