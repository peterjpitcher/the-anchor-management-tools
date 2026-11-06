import { describe, expect, it } from 'vitest'

import {
  christmasNoticeDays,
  christmasRefusalMessage,
  classifyChristmasBlockedReason,
  classifyChristmasRuleError,
  isInsideChristmasNotice,
  noticeHoursFromRuleMessage,
} from './christmas-refusals'

const PHONE = '01753 682707'
const LONG_DASH = String.fromCharCode(0x2014)

describe('christmasRefusalMessage', () => {
  it("words the notice refusal in the owner's words, with the days from min_notice_hours", () => {
    expect(christmasNoticeDays(192)).toBe(8)
    expect(christmasNoticeDays(170)).toBe(8)
    expect(christmasRefusalMessage('CHRISTMAS_NOTICE', { minNoticeHours: 192 })).toBe(
      "We take Christmas bookings online up to 8 days ahead, so you've time to choose your food. For a sooner date, call us on 01753 682707 and we'll see what we can do."
    )
  })

  it('never prints a made-up number when a fact is missing', () => {
    expect(christmasNoticeDays(null)).toBeNull()
    expect(christmasNoticeDays(0)).toBeNull()
    for (const code of [
      'CHRISTMAS_NOTICE',
      'CHRISTMAS_PARTY_TOO_SMALL',
      'CHRISTMAS_PARTY_TOO_LARGE',
      'CHRISTMAS_NOT_AVAILABLE',
      'CHRISTMAS_EMAIL_REQUIRED',
    ] as const) {
      const message = christmasRefusalMessage(code, {})
      expect(message).toContain(PHONE)
      expect(message).not.toMatch(/undefined|null|NaN/)
      expect(message).not.toContain(LONG_DASH)
      expect(message).not.toMatch(/\d+ (days|guests)/)
    }
  })

  it('names the party limits when they are known', () => {
    expect(christmasRefusalMessage('CHRISTMAS_PARTY_TOO_SMALL', { minPartySize: 4 })).toBe(
      "Christmas bookings are for 4 guests or more. For a smaller table, call us on 01753 682707 and we'll see what we can do."
    )
    expect(christmasRefusalMessage('CHRISTMAS_PARTY_TOO_LARGE', { onlinePartyLimit: 20 })).toBe(
      "We take Christmas bookings online for up to 20 guests. For a bigger group, call us on 01753 682707 and we'll book it for you."
    )
  })
})

describe("classifyChristmasRuleError (the old payload's exceptions)", () => {
  const party = (partySize: number) => ({ partySize, minPartySize: 4 })

  it.each([
    ['Christmas bookings are for 4 guests or more.', 2, 'CHRISTMAS_PARTY_TOO_SMALL'],
    ['Christmas bookings for more than 20 guests are arranged as private hire. Please call us.', 24, 'CHRISTMAS_PARTY_TOO_LARGE'],
    ['Christmas bookings need at least 192 hours notice.', 6, 'CHRISTMAS_NOTICE'],
    [
      'Christmas bookings for two or three courses need a pre-order by noon 7 days before the booking. Please call us.',
      6,
      'CHRISTMAS_NOTICE',
    ],
    ['Christmas bookings are for 4 to 20 guests.', 3, 'CHRISTMAS_PARTY_TOO_SMALL'],
    ['Christmas bookings are for 4 to 20 guests.', 21, 'CHRISTMAS_PARTY_TOO_LARGE'],
    ['Christmas bookings are not open for that date.', 6, 'CHRISTMAS_NOT_AVAILABLE'],
  ])('%s (party of %i) is %s', (message, partySize, code) => {
    expect(classifyChristmasRuleError(message, party(partySize))).toBe(code)
  })

  it('leaves any other exception alone, so the route keeps its older answer', () => {
    expect(classifyChristmasRuleError('Invalid booking time', party(6))).toBeNull()
    expect(classifyChristmasRuleError('Christmas bookings something new', party(6))).toBeNull()
    expect(classifyChristmasRuleError(null, party(6))).toBeNull()
  })

  it('reads the hours back out of the notice exception', () => {
    expect(noticeHoursFromRuleMessage('Christmas bookings need at least 192 hours notice.')).toBe(192)
    expect(noticeHoursFromRuleMessage('Something else')).toBeNull()
  })
})

describe("classifyChristmasBlockedReason (the new payload's blocked results)", () => {
  // 6 November 2026, 10am London (GMT). The 192 hour notice runs to 14 November, 10am.
  const now = new Date('2026-11-06T10:00:00Z')
  const at = (bookingDate: string, bookingTime = '19:00') => ({ bookingDate, bookingTime, minNoticeHours: 192, now })

  it('maps the party reasons', () => {
    expect(classifyChristmasBlockedReason('period_party_too_small', at('2026-12-12'))).toBe('CHRISTMAS_PARTY_TOO_SMALL')
    expect(classifyChristmasBlockedReason('period_party_too_large', at('2026-12-12'))).toBe('CHRISTMAS_PARTY_TOO_LARGE')
    expect(classifyChristmasBlockedReason('too_large_party', at('2026-12-12'))).toBe('CHRISTMAS_PARTY_TOO_LARGE')
  })

  it('calls cut_off a notice refusal only inside the notice', () => {
    expect(isInsideChristmasNotice(at('2026-11-12'))).toBe(true)
    expect(classifyChristmasBlockedReason('cut_off', at('2026-11-12'))).toBe('CHRISTMAS_NOTICE')
    // Too near the kitchen closing, well outside the notice: the website's ordinary wording stands.
    expect(isInsideChristmasNotice(at('2026-12-12', '21:30'))).toBe(false)
    expect(classifyChristmasBlockedReason('cut_off', at('2026-12-12', '21:30'))).toBeNull()
  })

  it('maps a closed date or time to not available', () => {
    for (const reason of ['outside_hours', 'period_not_available', 'period_date_mismatch', 'hours_not_configured']) {
      expect(classifyChristmasBlockedReason(reason, at('2026-12-14'))).toBe('CHRISTMAS_NOT_AVAILABLE')
    }
  })

  it('leaves the ordinary answers to the website', () => {
    expect(classifyChristmasBlockedReason('slot_full', at('2026-12-12'))).toBeNull()
    expect(classifyChristmasBlockedReason('no_table', at('2026-12-12'))).toBeNull()
    expect(classifyChristmasBlockedReason(null, at('2026-12-12'))).toBeNull()
  })
})
