import { describe, it, expect } from 'vitest'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { DATE_TBD_NOTE } from '@/services/private-bookings/types'

describe('isBookingDateTbd', () => {
  it('returns false when internal_notes is null', () => {
    expect(isBookingDateTbd({ internal_notes: null })).toBe(false)
  })

  it('returns false when internal_notes is empty', () => {
    expect(isBookingDateTbd({ internal_notes: '' })).toBe(false)
  })

  it('returns true when internal_notes contains the TBD note', () => {
    expect(
      isBookingDateTbd({ internal_notes: `${DATE_TBD_NOTE} customer to confirm` })
    ).toBe(true)
  })

  it('returns true when the TBD note is wrapped in other text', () => {
    expect(
      isBookingDateTbd({ internal_notes: `notes\n${DATE_TBD_NOTE}\nmore notes` })
    ).toBe(true)
  })

  it('returns false when other bracketed text is present', () => {
    expect(isBookingDateTbd({ internal_notes: '[TBD] not our marker' })).toBe(false)
  })

  it('handles undefined input gracefully', () => {
    expect(isBookingDateTbd({})).toBe(false)
  })
})
