import { describe, expect, it } from 'vitest'
import {
  buildConfirmReminderMessage,
  decideConfirmReminder,
  isTomorrow,
  type ConfirmCandidate,
} from './confirm-reminder'

/**
 * The harm this file guards against is a text to the wrong guest, so almost every test
 * here asserts that a message is NOT sent. The one that asserts it is sent is the easy
 * case; the rest are the ones that cost the pub a customer if they regress.
 */

const TODAY = "2026-08-09"
const TOMORROW = "2026-08-10"

function candidate(overrides: Partial<ConfirmCandidate> = {}): ConfirmCandidate {
  return {
    id: 'tb-1',
    bookingReference: 'TB-0001',
    status: 'confirmed',
    bookingDate: TOMORROW,
    guestConfirmedAt: null,
    reminderAlreadySent: false,
    customer: { id: 'cust-1', firstName: 'Jane', phone: '+447700900000', smsActive: true },
    ...overrides,
  }
}

describe('decideConfirmReminder', () => {
  it('texts a confirmed booking a day out that has not answered', () => {
    expect(decideConfirmReminder(candidate(), TODAY)).toEqual({ send: true })
  })

  it('never texts a booking that is still waiting on its deposit', () => {
    // The deposit chase is the right conversation with this guest. Asking them to
    // confirm a table whose hold can still expire invites them to plan an evening they
    // have not secured, and spends an SMS on a booking that may never exist.
    expect(decideConfirmReminder(candidate({ status: 'pending_payment' }), TODAY)).toEqual({
      send: false,
      reason: 'status_not_confirmable',
    })
  })

  it.each(['cancelled', 'no_show', 'completed', 'review_clicked', 'visited_waiting_for_review'])(
    'never texts a %s booking',
    (status) => {
      expect(decideConfirmReminder(candidate({ status }), TODAY).send).toBe(false)
    },
  )

  it('does not ask a guest who has already answered', () => {
    expect(
      decideConfirmReminder(candidate({ guestConfirmedAt: '2026-08-09T10:00:00Z' }), TODAY),
    ).toEqual({ send: false, reason: 'already_answered' })
  })

  it('sends exactly one reminder per booking, ever', () => {
    expect(decideConfirmReminder(candidate({ reminderAlreadySent: true }), TODAY)).toEqual({
      send: false,
      reason: 'already_reminded',
    })
  })

  it('stays quiet when the booking has no customer attached', () => {
    expect(decideConfirmReminder(candidate({ customer: null }), TODAY)).toEqual({
      send: false,
      reason: 'no_customer',
    })
  })

  it('stays quiet when there is no mobile number to text', () => {
    expect(
      decideConfirmReminder(
        candidate({ customer: { id: 'c', firstName: 'Jane', phone: null, smsActive: true } }),
        TODAY,
      ),
    ).toEqual({ send: false, reason: 'no_mobile' })
  })

  it('respects an SMS opt-out rather than treating it as a delivery problem', () => {
    // Opting out is an answer. These guests get a phone call from the pub instead.
    expect(
      decideConfirmReminder(
        candidate({
          customer: { id: 'c', firstName: 'Jane', phone: '+447700900000', smsActive: false },
        }),
        TODAY,
      ),
    ).toEqual({ send: false, reason: 'sms_not_active' })
  })

  it('checks status before anything else, so a cancelled booking is never reasoned about further', () => {
    const result = decideConfirmReminder(
      candidate({ status: 'cancelled', customer: null, reminderAlreadySent: true }),
      TODAY,
    )
    expect(result).toEqual({ send: false, reason: 'status_not_confirmable' })
  })
})

describe('isTomorrow', () => {
  it('accepts the day after the sweep', () => {
    expect(isTomorrow('2026-08-10', '2026-08-09')).toBe(true)
  })

  it('rejects today, because a guest sitting down in three hours needs a phone call', () => {
    expect(isTomorrow('2026-08-09', '2026-08-09')).toBe(false)
  })

  it('rejects a booking two days out, which waits for its own sweep', () => {
    expect(isTomorrow('2026-08-11', '2026-08-09')).toBe(false)
  })

  it('rejects a date that has already passed', () => {
    expect(isTomorrow('2026-08-08', '2026-08-09')).toBe(false)
  })

  it('rolls over a month end', () => {
    expect(isTomorrow('2026-09-01', '2026-08-31')).toBe(true)
    expect(isTomorrow('2026-03-01', '2026-02-28')).toBe(true)
  })

  it('rolls over a year end', () => {
    expect(isTomorrow('2027-01-01', '2026-12-31')).toBe(true)
  })

  it('survives both British Summer Time boundaries', () => {
    // The bug this pins: building the next day from a local midnight puts 29 March at
    // 23:00 on the 28th, or 25 October at 01:00 on the 26th, and a whole day of bookings
    // is silently never asked. Both transitions are checked because they shift opposite ways.
    expect(isTomorrow('2026-03-29', '2026-03-28')).toBe(true)
    expect(isTomorrow('2026-03-30', '2026-03-29')).toBe(true)
    expect(isTomorrow('2026-10-25', '2026-10-24')).toBe(true)
    expect(isTomorrow('2026-10-26', '2026-10-25')).toBe(true)
  })

  it('handles a leap day', () => {
    expect(isTomorrow('2028-02-29', '2028-02-28')).toBe(true)
    expect(isTomorrow('2028-03-01', '2028-02-29')).toBe(true)
  })
})

describe('buildConfirmReminderMessage', () => {
  const base = {
    firstName: 'Jane',
    bookingMoment: 'tomorrow at 7pm',
    partySize: 4,
    confirmUrl: 'https://management.orangejelly.co.uk/g/abc123/confirm-booking',
  }

  it('reads like a person wrote it and offers both answers', () => {
    const message = buildConfirmReminderMessage(base)
    expect(message).toContain('Jane')
    expect(message).toContain('tomorrow at 7pm')
    expect(message).toContain('for 4')
    expect(message).toContain('Still coming?')
    // Offering the cancel in the same breath is the point. A guest who cannot come and
    // is only offered "confirm" simply ignores the text, and becomes a no-show.
    expect(message).toContain('cancel')
    expect(message).toContain(base.confirmUrl)
  })

  it('stays on GSM-7, because one character outside it costs every send double', () => {
    // GSM-7 gives 160 characters a segment; a single character outside it drops the
    // whole message to 70. Curly quotes, long dashes and the ellipsis are the usual
    // culprits, matched here by code point so this file does not contain them either.
    const nonGsm = new RegExp('[\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2026]')
    expect(buildConfirmReminderMessage(base)).not.toMatch(nonGsm)
  })

  it('fits a single segment for a typical booking', () => {
    // The URL is rewritten to a short link at send time by shortenUrlsInSmsBody, so the
    // real body is shorter than this. Measuring with the long URL is the pessimistic case.
    const message = buildConfirmReminderMessage({
      ...base,
      confirmUrl: 'https://l.the-anchor.pub/abcdef',
    })
    expect(message.length).toBeLessThanOrEqual(160)
  })

  it('drops the greeting rather than saying "null," when the name is missing', () => {
    const message = buildConfirmReminderMessage({ ...base, firstName: null })
    expect(message).not.toContain('null')
    expect(message).not.toContain('undefined')
    expect(message).toContain('your table')
  })

  it('omits the party size rather than printing "for 0"', () => {
    expect(buildConfirmReminderMessage({ ...base, partySize: null })).not.toContain('for ')
    expect(buildConfirmReminderMessage({ ...base, partySize: 0 })).not.toContain('for 0')
  })
})
