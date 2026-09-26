// The opening-hours schedule picker, split by the London date, in both test zones.
//
// The strip sorted schedules into current, future and past with toISOString(), the UTC date,
// and set the earliest first day of a new schedule to 24 hours from now in UTC. From 00:00 to
// 00:59 BST that is a day behind London: a schedule starting today, which the server already
// marks as current, also counted as future and showed twice, and the date picker offered today
// instead of tomorrow.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on Friday 2 October in London.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HoursVersionStrip } from '@/app/(authenticated)/settings/business-hours/HoursVersionStrip'
import type { HoursVersionSummary } from '@/app/actions/business-hours'

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/app/actions/business-hours', () => ({
  createScheduledHoursVersion: vi.fn(),
  publishHoursVersion: vi.fn(),
  withdrawHoursVersion: vi.fn(),
}))

const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'

function version(overrides: Partial<HoursVersionSummary> & Pick<HoursVersionSummary, 'id' | 'effectiveFrom'>): HoursVersionSummary {
  return {
    status: 'published',
    label: null,
    isBaseline: false,
    isActive: false,
    publishedAt: '2026-09-01T09:00:00Z',
    ...overrides,
  }
}

// The server resolves isActive from the London date, so at 00:30 BST on 2 October the
// schedule starting that day is the one in force.
const versions = [
  version({ id: 'autumn', effectiveFrom: '2026-10-02', isActive: true }),
  version({ id: 'summer', effectiveFrom: '2026-04-01' }),
]

function renderStrip() {
  render(
    <HoursVersionStrip
      versions={versions}
      selectedId="autumn"
      onSelect={vi.fn()}
      canManage
      onChanged={vi.fn()}
    />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('hours version strip London today', () => {
  it('shows a schedule starting today in London once, as the current hours', () => {
    renderStrip()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Current hours'])
    expect(screen.getByRole('button', { name: 'Show 1 past schedule' })).toBeInTheDocument()
  })

  it('offers London tomorrow as the earliest first day of a new schedule', async () => {
    renderStrip()

    fireEvent.click(screen.getByRole('button', { name: 'Schedule a change' }))
    await screen.findByText('First day these hours apply')

    const dateInput = document.querySelector('input[type="date"]')
    expect(dateInput).toHaveAttribute('min', '2026-10-03')
  })
})
