import { describe, expect, it } from 'vitest'
import { daysAhead, FUNNEL_CODE_PATTERN, FUNNEL_PAGE_PATTERN, summariseAvailability } from '@/lib/booking-funnel/events'

describe('booking funnel helpers (BK-101)', () => {
  it('summarises an availability answer as its state, times offered and public reason', () => {
    expect(
      summariseAvailability({
        calculation_state: 'complete',
        slots: [{ state: 'available' }, { state: 'unavailable' }, { state: 'available' }, null],
      }),
    ).toEqual({ calculationState: 'complete', slotsOffered: 2, publicReason: null })
    expect(summariseAvailability({ calculation_state: 'complete', slots: [], public_reason: 'too_large' })).toEqual({
      calculationState: 'complete',
      slotsOffered: 0,
      publicReason: 'too_large',
    })
    // Anything unreadable is "could not check", never a count of times.
    expect(summariseAvailability(null)).toEqual({ calculationState: 'unknown', slotsOffered: 0, publicReason: null })
    expect(summariseAvailability({ calculation_state: 'unknown', slots: [{ state: 'available' }] }).slotsOffered).toBe(0)
    expect(summariseAvailability({ calculation_state: 'complete', slots: [], public_reason: 'call 07700 900123' }).publicReason).toBeNull()
  })

  it('counts days ahead on the calendar, across the clocks going back', () => {
    expect(daysAhead('2026-10-26', '2026-10-25')).toBe(1)
    expect(daysAhead('2026-10-25', '2026-10-25')).toBe(0)
    expect(daysAhead('2026-10-24', '2026-10-25')).toBe(-1)
    expect(daysAhead('2026-10-20', '2026-10-25')).toBeNull()
    expect(daysAhead('2028-01-01', '2026-10-25')).toBeNull()
    expect(daysAhead('not-a-date', '2026-10-25')).toBeNull()
  })

  it('accepts codes and stripped paths, and nothing shaped like a guest detail', () => {
    for (const ok of ['OUTSIDE_HOURS', 'no_security_token', 'slot_full', 'IDEMPOTENCY_KEY_CONFLICT']) {
      expect(FUNNEL_CODE_PATTERN.test(ok)).toBe(true)
    }
    for (const bad of ['07700 900123', 'a@b.com', 'Alice Booker', '', '1ABC']) {
      expect(FUNNEL_CODE_PATTERN.test(bad)).toBe(false)
    }
    for (const ok of ['/book-table', '/events/quiz-night-2026-09-16', '/g/:id/table-manage', '/']) {
      expect(FUNNEL_PAGE_PATTERN.test(ok)).toBe(true)
    }
    for (const bad of ['book-table', '/book-table?phone=07700900123', '/events/Alice Booker', '/a#frag']) {
      expect(FUNNEL_PAGE_PATTERN.test(bad)).toBe(false)
    }
  })
})
