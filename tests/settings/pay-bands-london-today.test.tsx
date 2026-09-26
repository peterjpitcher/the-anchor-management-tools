// Which pay band rate is current, decided by the London date, in both test zones.
//
// The band card and its rate history picked "today" with toISOString(), the UTC date. From 00:00
// to 00:59 BST on the day a new rate starts, that is still yesterday, so the server render showed
// the old rate as current and the new one as upcoming (and editable).
//
// Instants are written in UTC: 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PayBandsManager from '@/app/(authenticated)/settings/pay-bands/PayBandsManager'
import type { PayAgeBand, PayBandRate } from '@/app/actions/pay-bands'

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/app/actions/pay-bands', () => ({
  createPayAgeBand: vi.fn(),
  addPayBandRate: vi.fn(),
  updatePayAgeBand: vi.fn(),
  updatePayBandRate: vi.fn(),
}))

// 00:30 BST on Friday 2 October 2026 in London; still Thursday 1 October in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'
// 23:30 BST on Thursday 1 October 2026: the same day in London and in UTC.
const JUST_BEFORE_MIDNIGHT_BST = '2026-10-01T22:30:00Z'

const band: PayAgeBand = {
  id: 'band-1',
  label: 'Adult',
  min_age: 21,
  max_age: null,
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function rate(id: string, hourlyRate: number, effectiveFrom: string): PayBandRate {
  return { id, band_id: band.id, hourly_rate: hourlyRate, effective_from: effectiveFrom, created_at: '2026-09-01T00:00:00Z' }
}

// Newest first, as the page loads them.
const rates = [rate('rate-new', 13, '2026-10-02'), rate('rate-old', 12, '2026-10-01')]

function renderAt(isoInstant: string) {
  vi.setSystemTime(new Date(isoInstant))
  render(<PayBandsManager canManage={false} initialBands={[band]} initialRates={{ [band.id]: rates }} />)
  fireEvent.click(screen.getByRole('button', { name: /Adult/ }))
}

function statusOf(hourlyRate: string): string | null | undefined {
  const cells = screen.getAllByText(hourlyRate)
  const row = cells.map(cell => cell.closest('tr')).find(Boolean)
  return row?.querySelectorAll('td')[2]?.textContent
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('pay band current rate', () => {
  it('treats a rate starting today in London as current in the first hour of the day', () => {
    renderAt(JUST_AFTER_MIDNIGHT_BST)

    // The band header shows the current rate.
    expect(screen.getAllByText('£13.00/hr')).toHaveLength(2)
    expect(screen.getAllByText('£12.00/hr')).toHaveLength(1)
    expect(statusOf('£13.00/hr')).toBe('Current')
    expect(statusOf('£12.00/hr')).toBe('Historical')
    expect(screen.queryByText('Upcoming')).not.toBeInTheDocument()
  })

  it('keeps tomorrow\'s rate upcoming until London midnight', () => {
    renderAt(JUST_BEFORE_MIDNIGHT_BST)

    expect(screen.getAllByText('£12.00/hr')).toHaveLength(2)
    expect(statusOf('£13.00/hr')).toBe('Upcoming')
    expect(statusOf('£12.00/hr')).toBe('Current')
  })
})
