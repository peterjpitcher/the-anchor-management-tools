import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MileageFilters } from '@/app/(authenticated)/mileage/_components/MileageFilters'
import { DEFAULT_MILEAGE_LIST_QUERY, type MileageListQuery } from '@/lib/mileage/list-query'
import { buildPeriodPresets } from '@/lib/mileage/period-presets'

const PRESETS = buildPeriodPresets({ today: '2026-09-15', firstTripDate: '2024-01-05', lastTripDate: '2026-09-14' })
const PLACES = [{ id: '00000000-0000-4000-8000-000000000002', name: 'Shop One' }]
const DRIVERS = [{ id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Driver A', drivesOjProjects: true }]

function renderFilters(query: MileageListQuery = { ...DEFAULT_MILEAGE_LIST_QUERY, page: 3 }) {
  const onChange = vi.fn()
  render(<MileageFilters query={query} presets={PRESETS} places={PLACES} drivers={DRIVERS} onChange={onChange} />)
  return onChange
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MileageFilters', () => {
  it('labels every control', () => {
    renderFilters()
    for (const label of ['Period', 'Search', 'Place', 'Source', 'Driver']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('applies a preset period and returns to page 1', () => {
    const onChange = renderFilters()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026-Q2' } })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-01', to: '2026-06-30', page: 1 })
  })

  it('shows the matching preset for dates already in the address', () => {
    renderFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2025-01-01', to: '2025-12-31' })
    expect(screen.getByLabelText('Period')).toHaveValue('FY2025')
  })

  it('opens custom dates for dates that match no preset', () => {
    renderFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-03', to: '2026-04-20' })
    expect(screen.getByLabelText('Period')).toHaveValue('custom')
    expect(screen.getByLabelText('From')).toHaveValue('2026-04-03')
  })

  it('applies custom dates only when asked', () => {
    const onChange = renderFilters()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-03' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-20' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MILEAGE_LIST_QUERY, from: '2026-04-03', to: '2026-04-20', page: 1 })
  })

  it('waits for typing to stop before searching', () => {
    vi.useFakeTimers()
    const onChange = renderFilters()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'shop' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', page: 1 })
  })

  it('filters by place, source and driver', () => {
    const onChange = renderFilters()
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: PLACES[0].id } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'oj_projects' } })
    fireEvent.change(screen.getByLabelText('Driver'), { target: { value: DRIVERS[0].id } })
    expect(onChange.mock.calls.map(([next]) => [next.placeId, next.source, next.driverId, next.page])).toEqual([
      [PLACES[0].id, null, null, 1],
      [null, 'oj_projects', null, 1],
      [null, null, DRIVERS[0].id, 1],
    ])
  })

  it('clears every filter but keeps the sort', () => {
    const onChange = renderFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, q: 'shop', sort: 'miles', dir: 'asc' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_MILEAGE_LIST_QUERY, sort: 'miles', dir: 'asc' })
  })

  it('offers no clear button when nothing is filtered', () => {
    renderFilters({ ...DEFAULT_MILEAGE_LIST_QUERY, sort: 'miles' })
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })
})
