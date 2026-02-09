import { describe, expect, it } from 'vitest'
import { mapTableBookingBlockedReason } from '@/lib/table-bookings/bookings'

describe('mapTableBookingBlockedReason', () => {
  it('maps direct reasons', () => {
    expect(mapTableBookingBlockedReason('too_large_party')).toBe('too_large_party')
    expect(mapTableBookingBlockedReason('no_table')).toBe('no_table')
    expect(mapTableBookingBlockedReason('cut_off')).toBe('cut_off')
  })

  it('maps hours-related reasons', () => {
    expect(mapTableBookingBlockedReason('outside_hours')).toBe('outside_hours')
    expect(mapTableBookingBlockedReason('hours_not_configured')).toBe('outside_hours')
    expect(mapTableBookingBlockedReason('sunday_lunch_requires_sunday')).toBe('outside_hours')
  })

  it('falls back for unknown reasons', () => {
    expect(mapTableBookingBlockedReason('unexpected_reason')).toBe('blocked')
    expect(mapTableBookingBlockedReason()).toBe('blocked')
  })
})
