import { describe, expect, it } from 'vitest'
import { londonCalendarDaysUntil } from '@/lib/dateUtils'
import { getEventRefundPolicy } from '@/lib/events/manage-booking'

// BK-111: event ticket refund bands count whole London calendar days, as the ticket email and
// the website promise, never elapsed hours. Every instant below is written in UTC with its London
// wall clock alongside, so the suite means the same under TZ=Europe/London and TZ=UTC.

describe('londonCalendarDaysUntil', () => {
  it('counts London dates, not elapsed time', () => {
    // 20 Nov 2026 19:00 GMT, seen from 13 Nov 2026 20:00 GMT: under 7 x 24 hours, but 7 dates.
    expect(londonCalendarDaysUntil('2026-11-20T19:00:00Z', new Date('2026-11-13T20:00:00Z'))).toBe(7)
    expect(londonCalendarDaysUntil('2026-11-20T19:00:00Z', new Date('2026-11-20T09:00:00Z'))).toBe(0)
  })

  it('uses the London date just after midnight in summer time, not the UTC date', () => {
    // 00:30 BST on 23 Oct 2026 is 23:30 UTC on 22 Oct.
    expect(londonCalendarDaysUntil('2026-10-29T19:00:00Z', new Date('2026-10-22T23:30:00Z'))).toBe(6)
  })

  it('returns null for something that is not a time', () => {
    expect(londonCalendarDaysUntil('not a date')).toBeNull()
  })
})

describe('getEventRefundPolicy', () => {
  const event = '2026-11-20T19:00:00Z' // Friday 20 November 2026, 19:00 London (GMT)

  it('refunds in full on the evening a week before, although fewer than 168 hours remain', () => {
    expect(getEventRefundPolicy(event, new Date('2026-11-13T20:00:00Z'))).toEqual({ refundRate: 1, policyBand: 'full' })
  })

  it('refunds half from 6 days before', () => {
    expect(getEventRefundPolicy(event, new Date('2026-11-14T00:30:00Z'))).toEqual({ refundRate: 0.5, policyBand: 'partial' })
  })

  it('still refunds half at 23:59 three days before, and nothing a minute later', () => {
    expect(getEventRefundPolicy(event, new Date('2026-11-17T23:59:00Z')).policyBand).toBe('partial')
    expect(getEventRefundPolicy(event, new Date('2026-11-18T00:01:00Z')).policyBand).toBe('none')
  })

  it('does not move the band across the clocks going back', () => {
    // Event Thursday 29 Oct 2026 19:00 GMT. The clocks went back on Sunday 25 October.
    const afterChange = '2026-10-29T19:00:00Z'
    // 23:30 BST on 22 October (22:30 UTC): 6 days 20.5 hours away, but 7 London dates.
    expect(getEventRefundPolicy(afterChange, new Date('2026-10-22T22:30:00Z')).policyBand).toBe('full')
    // 00:30 BST on 23 October (23:30 UTC on the 22nd): 6 London dates, whatever UTC says.
    expect(getEventRefundPolicy(afterChange, new Date('2026-10-22T23:30:00Z')).policyBand).toBe('partial')
  })

  it('gives nothing for a start time it cannot read', () => {
    expect(getEventRefundPolicy('', new Date('2026-11-01T12:00:00Z'))).toEqual({ refundRate: 0, policyBand: 'none' })
  })
})
