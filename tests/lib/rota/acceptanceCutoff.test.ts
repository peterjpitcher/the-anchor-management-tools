import { formatInTimeZone } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import {
  LATE_PUBLISH_GRACE_HOURS,
  LATE_PUBLISH_GRACE_MS,
  SHIFT_ACCEPTANCE_CUTOFF_DAYS,
  SHIFT_ACCEPTANCE_CUTOFF_MS,
  acceptanceDeadlineInstant,
  isInsideAcceptanceCutoff,
  isInsideLatePublishGrace,
  latePublishGraceEnd,
  shiftStartInstant,
} from '@/lib/rota/acceptance-cutoff'

const LONDON = 'Europe/London'

function londonLabel(date: Date): string {
  return formatInTimeZone(date, LONDON, 'yyyy-MM-dd HH:mm')
}

describe('the cutoff constants', () => {
  it('is 14 days, expressed as a fixed 336 hours', () => {
    expect(SHIFT_ACCEPTANCE_CUTOFF_DAYS).toBe(14)
    expect(SHIFT_ACCEPTANCE_CUTOFF_MS).toBe(336 * 60 * 60 * 1000)
  })
})

describe('shiftStartInstant', () => {
  it('reads the stored date and time as London wall-clock', () => {
    // British Summer Time, so 18:00 London is 17:00 UTC.
    expect(shiftStartInstant('2026-08-18', '18:00:00').toISOString()).toBe('2026-08-18T17:00:00.000Z')
    // Greenwich Mean Time, so 18:00 London is 18:00 UTC.
    expect(shiftStartInstant('2026-12-18', '18:00:00').toISOString()).toBe('2026-12-18T18:00:00.000Z')
  })

  it('accepts HH:mm as well as HH:mm:ss', () => {
    expect(shiftStartInstant('2026-08-18', '18:00').toISOString()).toBe('2026-08-18T17:00:00.000Z')
  })
})

describe('acceptanceDeadlineInstant', () => {
  it('is exactly 336 hours before the shift start', () => {
    const start = shiftStartInstant('2026-08-18', '18:00:00')
    const deadline = acceptanceDeadlineInstant('2026-08-18', '18:00:00')

    expect(start.getTime() - deadline.getTime()).toBe(336 * 60 * 60 * 1000)
    expect(deadline.toISOString()).toBe('2026-08-04T17:00:00.000Z')
  })

  it('lands an hour earlier in London across the spring clock change', () => {
    // British Summer Time began on 29 March 2026. A 5 April shift at 18:00 BST
    // is 336 hours after 17:00 GMT on 22 March, so the honest deadline label is
    // 17:00, not the 18:00 that a calendar-date subtraction would print.
    const deadline = acceptanceDeadlineInstant('2026-04-05', '18:00:00')

    expect(deadline.toISOString()).toBe('2026-03-22T17:00:00.000Z')
    expect(londonLabel(deadline)).toBe('2026-03-22 17:00')
  })

  it('lands an hour later in London across the autumn clock change', () => {
    // British Summer Time ended on 25 October 2026. A 1 November shift at 18:00
    // GMT is 336 hours after 19:00 BST on 18 October, so the honest deadline
    // label is 19:00, not 18:00.
    const deadline = acceptanceDeadlineInstant('2026-11-01', '18:00:00')

    expect(deadline.toISOString()).toBe('2026-10-18T18:00:00.000Z')
    expect(londonLabel(deadline)).toBe('2026-10-18 19:00')
  })

  it('keeps the same London label when no clock change intervenes', () => {
    const deadline = acceptanceDeadlineInstant('2026-08-18', '18:00:00')

    expect(londonLabel(deadline)).toBe('2026-08-04 18:00')
  })
})

describe('isInsideAcceptanceCutoff', () => {
  const shiftDate = '2026-08-18'
  const startTime = '18:00:00'
  const deadline = acceptanceDeadlineInstant(shiftDate, startTime)

  it('counts the exact boundary as inside, matching the auto-accept cron', () => {
    expect(isInsideAcceptanceCutoff(shiftDate, startTime, new Date(deadline.getTime()))).toBe(true)
  })

  it('is outside one second before the deadline', () => {
    expect(isInsideAcceptanceCutoff(shiftDate, startTime, new Date(deadline.getTime() - 1000))).toBe(false)
  })

  it('is inside one second after the deadline', () => {
    expect(isInsideAcceptanceCutoff(shiftDate, startTime, new Date(deadline.getTime() + 1000))).toBe(true)
  })

  it('is outside well ahead of the shift and inside on the day', () => {
    expect(isInsideAcceptanceCutoff(shiftDate, startTime, new Date('2026-07-01T09:00:00.000Z'))).toBe(false)
    expect(isInsideAcceptanceCutoff(shiftDate, startTime, new Date('2026-08-18T09:00:00.000Z'))).toBe(true)
  })

  it('holds at the boundary across the spring clock change', () => {
    const springDeadline = acceptanceDeadlineInstant('2026-04-05', '18:00:00')

    expect(isInsideAcceptanceCutoff('2026-04-05', '18:00:00', new Date(springDeadline.getTime() - 1000))).toBe(false)
    expect(isInsideAcceptanceCutoff('2026-04-05', '18:00:00', springDeadline)).toBe(true)
    // 18:00 London on 22 March is an hour past the deadline, so a label built by
    // calendar subtraction would tell staff they still had time when they did not.
    expect(isInsideAcceptanceCutoff('2026-04-05', '18:00:00', new Date('2026-03-22T18:00:00.000Z'))).toBe(true)
  })

  it('holds at the boundary across the autumn clock change', () => {
    const autumnDeadline = acceptanceDeadlineInstant('2026-11-01', '18:00:00')

    expect(isInsideAcceptanceCutoff('2026-11-01', '18:00:00', new Date(autumnDeadline.getTime() - 1000))).toBe(false)
    expect(isInsideAcceptanceCutoff('2026-11-01', '18:00:00', autumnDeadline)).toBe(true)
    // 18:00 London on 18 October is 17:00 UTC, an hour short of the deadline, so
    // the shift is still open for rejection.
    expect(isInsideAcceptanceCutoff('2026-11-01', '18:00:00', new Date('2026-10-18T17:00:00.000Z'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The late-publish grace window (decision D13)
//
// This rule used to be written out three times, in the staff portal, the server
// actions and the acceptance cron, with three different conditions. The server
// action's copy granted the window to shifts published in good time, so a shift
// the portal showed as auto-accepted could still be rejected; the cron's copy
// never clamped to the shift start, so a late-published shift stayed pending
// through the shift and auto-accepted the next day. These cases pin the one rule
// all three now share.
// ---------------------------------------------------------------------------

describe('the grace constants', () => {
  it('is 48 hours, expressed both ways', () => {
    expect(LATE_PUBLISH_GRACE_HOURS).toBe(48)
    expect(LATE_PUBLISH_GRACE_MS).toBe(48 * 60 * 60 * 1000)
  })
})

describe('latePublishGraceEnd', () => {
  // 18:00 London on 14 September 2026 is 17:00Z, so the deadline is 2026-08-31T17:00Z.
  const SHIFT = { shift_date: '2026-09-14', start_time: '18:00:00' }

  it('gives no window to a shift that was never published', () => {
    expect(latePublishGraceEnd({ ...SHIFT, first_published_at: null })).toBeNull()
    expect(latePublishGraceEnd({ ...SHIFT, first_published_at: undefined })).toBeNull()
  })

  it('gives no window for an unparseable timestamp', () => {
    expect(latePublishGraceEnd({ ...SHIFT, first_published_at: 'not a date' })).toBeNull()
  })

  it('gives no window to a shift published in good time', () => {
    // The precondition the server action was missing: published a day before the
    // deadline, so the employee had their full two weeks and earns nothing.
    expect(latePublishGraceEnd({ ...SHIFT, first_published_at: '2026-08-30T10:00:00Z' })).toBeNull()
  })

  it('gives no window one second before the deadline', () => {
    const deadline = acceptanceDeadlineInstant(SHIFT.shift_date, SHIFT.start_time)
    const justBefore = new Date(deadline.getTime() - 1000).toISOString()
    expect(latePublishGraceEnd({ ...SHIFT, first_published_at: justBefore })).toBeNull()
  })

  it('gives a window to a publish exactly at the deadline', () => {
    // The boundary matches isInsideAcceptanceCutoff, which treats the deadline
    // instant itself as inside the cutoff.
    const deadline = acceptanceDeadlineInstant(SHIFT.shift_date, SHIFT.start_time)
    const graceEnd = latePublishGraceEnd({ ...SHIFT, first_published_at: deadline.toISOString() })
    expect(graceEnd?.toISOString()).toBe(new Date(deadline.getTime() + LATE_PUBLISH_GRACE_MS).toISOString())
  })

  it('clamps the window to the shift start', () => {
    // Published on the Saturday for a Sunday shift: 48 hours from publish would
    // run to the Monday, which is a day after the shift was worked.
    const graceEnd = latePublishGraceEnd({
      shift_date: '2026-09-13',
      start_time: '12:00:00',
      first_published_at: '2026-09-12T09:00:00Z',
    })
    expect(graceEnd?.toISOString()).toBe('2026-09-13T11:00:00.000Z')
    expect(londonLabel(graceEnd!)).toBe('2026-09-13 12:00')
  })

  it('holds across the spring clock change', () => {
    // 18:00 London on 5 April 2026 is 17:00Z; the deadline is 2026-03-22T17:00Z.
    const shift = { shift_date: '2026-04-05', start_time: '18:00:00' }
    expect(latePublishGraceEnd({ ...shift, first_published_at: '2026-03-22T16:59:59Z' })).toBeNull()
    const graceEnd = latePublishGraceEnd({ ...shift, first_published_at: '2026-03-22T18:00:00Z' })
    expect(graceEnd?.toISOString()).toBe('2026-03-24T18:00:00.000Z')
  })

  it('holds across the autumn clock change', () => {
    // 18:00 London on 1 November 2026 is 18:00Z; the deadline is 2026-10-18T18:00Z.
    const shift = { shift_date: '2026-11-01', start_time: '18:00:00' }
    expect(latePublishGraceEnd({ ...shift, first_published_at: '2026-10-18T17:59:59Z' })).toBeNull()
    const graceEnd = latePublishGraceEnd({ ...shift, first_published_at: '2026-10-18T19:00:00Z' })
    expect(graceEnd?.toISOString()).toBe('2026-10-20T19:00:00.000Z')
  })
})

describe('isInsideLatePublishGrace', () => {
  const LATE = {
    shift_date: '2026-09-14',
    start_time: '18:00:00',
    first_published_at: '2026-09-01T09:00:00Z',
  }

  it('is open up to, but not including, the closing instant', () => {
    const graceEnd = latePublishGraceEnd(LATE)!
    expect(isInsideLatePublishGrace(LATE, new Date(graceEnd.getTime() - 1000))).toBe(true)
    expect(isInsideLatePublishGrace(LATE, graceEnd)).toBe(false)
    expect(isInsideLatePublishGrace(LATE, new Date(graceEnd.getTime() + 1000))).toBe(false)
  })

  it('is never open for a shift published in good time', () => {
    const onTime = { ...LATE, first_published_at: '2026-08-30T10:00:00Z' }
    expect(isInsideLatePublishGrace(onTime, new Date('2026-08-31T18:00:00Z'))).toBe(false)
  })
})
