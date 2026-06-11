import { describe, expect, it } from 'vitest'
import {
  isCommunalBookingModeTransition,
  normalizeEventBookingMode,
} from '@/services/events'

describe('event booking mode transitions', () => {
  it('does not treat blank legacy mode to table as a communal transition', () => {
    expect(isCommunalBookingModeTransition(null, 'table')).toBe(false)
    expect(isCommunalBookingModeTransition(undefined, 'table')).toBe(false)
  })

  it('only flags changes into or out of communal seating', () => {
    expect(isCommunalBookingModeTransition('table', 'general')).toBe(false)
    expect(isCommunalBookingModeTransition('table', 'communal')).toBe(true)
    expect(isCommunalBookingModeTransition('communal', 'table')).toBe(true)
    expect(isCommunalBookingModeTransition('communal', 'communal')).toBe(false)
  })

  it('normalizes unknown values to table bookings', () => {
    expect(normalizeEventBookingMode('')).toBe('table')
    expect(normalizeEventBookingMode('custom')).toBe('table')
  })
})
