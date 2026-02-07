import { describe, expect, it } from 'vitest'
import { resolveStatusFilters } from '@/lib/events/status-filters'

describe('resolveStatusFilters', () => {
  it('keeps status filters unchanged when available_only is false', () => {
    const result = resolveStatusFilters('scheduled,sold_out', false)
    expect(result).toEqual({
      statuses: ['scheduled', 'sold_out'],
      applyAvailabilityFilter: false,
      emptyResult: false,
    })
  })

  it('applies availability filter when available_only is true without explicit statuses', () => {
    const result = resolveStatusFilters(null, true)
    expect(result).toEqual({
      statuses: null,
      applyAvailabilityFilter: true,
      emptyResult: false,
    })
  })

  it('removes unavailable statuses when available_only is true with explicit statuses', () => {
    const result = resolveStatusFilters('scheduled,sold_out,draft', true)
    expect(result).toEqual({
      statuses: ['scheduled'],
      applyAvailabilityFilter: false,
      emptyResult: false,
    })
  })

  it('returns an empty result when explicit statuses are all unavailable', () => {
    const result = resolveStatusFilters('sold_out,cancelled,draft', true)
    expect(result).toEqual({
      statuses: null,
      applyAvailabilityFilter: false,
      emptyResult: true,
    })
  })
})
