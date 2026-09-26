import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PayBandsManager from '@/app/(authenticated)/settings/pay-bands/PayBandsManager'
import type { PayAgeBand } from '@/app/actions/pay-bands'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/pay-bands',
}))

vi.mock('@/app/actions/pay-bands', () => ({
  createPayAgeBand: vi.fn(),
  addPayBandRate: vi.fn(),
  updatePayAgeBand: vi.fn(),
  updatePayBandRate: vi.fn(),
}))

function band(id: string, label: string): PayAgeBand {
  return {
    id,
    label,
    min_age: 18,
    max_age: null,
    is_active: true,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// A band whose rates failed to load must not read as a band with no rate: payroll staff would
// add a rate that already exists.
describe('pay bands whose rates failed to load', () => {
  it('says the rates were not loaded, and only for the band that failed', () => {
    render(
      <PayBandsManager
        canManage
        initialBands={[band('b1', 'Under 18'), band('b2', '21+')]}
        initialRates={{ b1: [], b2: [] }}
        ratesLoadError="Database unavailable"
        ratesFailedBandIds={['b1']}
      />,
    )

    expect(screen.getByText('Some rates could not be loaded')).toBeInTheDocument()
    expect(screen.getAllByText('Rates not loaded')).toHaveLength(1)
    expect(screen.getAllByText('No rate set')).toHaveLength(1)
  })
})
