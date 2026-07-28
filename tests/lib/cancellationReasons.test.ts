import { describe, it, expect } from 'vitest'
import {
  CANCELLATION_REASONS,
  formatCancellationReason,
  parseCancellationReason,
  cancellationReasonLabel,
  isCancellationReasonCode,
} from '@/lib/table-bookings/cancellation-reasons'

describe('cancellation reasons', () => {
  it('offers the seven reasons the owner approved, in order', () => {
    expect(CANCELLATION_REASONS.map((r) => r.code)).toEqual([
      'plans_changed',
      'wrong_date_time',
      'party_size_changed',
      'unwell',
      'going_elsewhere',
      'booking_problem',
      'other',
    ])
  })

  it('marks only the two free-text reasons as wanting detail', () => {
    const wantsDetail = CANCELLATION_REASONS.filter((r) => r.wantsDetail).map((r) => r.code)
    expect(wantsDetail).toEqual(['booking_problem', 'other'])
  })

  it('keeps "something was not right" separate from "other", so it is visible in a report', () => {
    // The whole point of reason 6: it says something went wrong at our end, not theirs.
    expect(isCancellationReasonCode('booking_problem')).toBe(true)
    expect(isCancellationReasonCode('other')).toBe(true)
    expect(cancellationReasonLabel('booking_problem')).toBe("Something about the booking wasn't right")
  })

  describe('what gets stored', () => {
    it('stores the bare code when there is no free text', () => {
      expect(formatCancellationReason('plans_changed', '')).toBe('plans_changed')
      expect(formatCancellationReason('plans_changed', null)).toBe('plans_changed')
      expect(formatCancellationReason('plans_changed', '   ')).toBe('plans_changed')
    })

    it('stores code and detail together, so a report can group on the code', () => {
      expect(formatCancellationReason('other', 'car broke down')).toBe('other: car broke down')
    })

    it('stores NOTHING when no reason was given, rather than an empty string', () => {
      // A guest who will not answer must still be able to cancel. Null means "not asked or
      // not answered", which is a real outcome and should not look like missing data.
      expect(formatCancellationReason(undefined, undefined)).toBeNull()
      expect(formatCancellationReason(null, 'detail with no reason')).toBeNull()
    })

    it('ignores a reason code it does not recognise', () => {
      expect(formatCancellationReason('made_up_reason', 'x')).toBeNull()
      expect(formatCancellationReason(42, 'x')).toBeNull()
    })

    it('tidies and caps free text so one guest cannot write an essay into the column', () => {
      expect(formatCancellationReason('other', '  lots\n\n of   space  ')).toBe('other: lots of space')
      const long = formatCancellationReason('other', 'x'.repeat(500))
      expect(long!.length).toBeLessThanOrEqual('other: '.length + 300)
    })
  })

  describe('reading it back', () => {
    it('splits a stored value into code and detail', () => {
      expect(parseCancellationReason('other: car broke down')).toEqual({
        code: 'other',
        detail: 'car broke down',
      })
      expect(parseCancellationReason('plans_changed')).toEqual({
        code: 'plans_changed',
        detail: null,
      })
      expect(parseCancellationReason(null)).toEqual({ code: null, detail: null })
    })

    it('survives free text that itself contains a colon', () => {
      expect(parseCancellationReason('other: note: it was raining')).toEqual({
        code: 'other',
        detail: 'note: it was raining',
      })
    })

    it('gives a human label for staff screens, falling back to the raw code', () => {
      expect(cancellationReasonLabel('unwell')).toBe('Someone is unwell')
      expect(cancellationReasonLabel('other: anything')).toBe('Other')
      expect(cancellationReasonLabel('legacy_value_from_before')).toBe('legacy_value_from_before')
      expect(cancellationReasonLabel(null)).toBeNull()
    })
  })

  it('round-trips every reason', () => {
    for (const reason of CANCELLATION_REASONS) {
      const stored = formatCancellationReason(reason.code, 'some detail')
      expect(parseCancellationReason(stored).code).toBe(reason.code)
      expect(cancellationReasonLabel(stored)).toBe(reason.label)
    }
  })
})
