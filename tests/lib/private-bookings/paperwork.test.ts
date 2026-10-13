import { describe, expect, it } from 'vitest'
import {
  PAPERWORK_WARNING_DAYS,
  daysUntilEventInWindow,
  eventTimingSentence,
  outstandingPaperwork,
  paperworkSentences,
  paperworkWarning,
  type PaperworkBooking,
} from '@/lib/private-bookings/paperwork'

/**
 * The one rule behind the "Paperwork outstanding" warning on the booking and in the Friday
 * report. Today is passed in as a London calendar date, so nothing here depends on the clock or
 * on the zone the tests run in (the suite runs under Europe/London and again under UTC).
 */

const TODAY = '2026-10-13'

/** A confirmed booking five days out with nothing sent and no outside food. */
function booking(overrides: PaperworkBooking = {}): PaperworkBooking {
  return {
    status: 'confirmed',
    event_date: '2026-10-18',
    date_tbd: false,
    contract_version: 0,
    contract_sent_at: null,
    contract_accepted_at: null,
    outside_food: false,
    waiver_status: 'not_required',
    ...overrides,
  }
}

const CONTRACT_NOT_SENT = { document: 'contract', state: 'not_sent' } as const
const CONTRACT_NOT_SIGNED = { document: 'contract', state: 'sent_not_signed' } as const
const FOOD_NOT_SENT = { document: 'food_agreement', state: 'not_sent' } as const
const FOOD_NOT_SIGNED = { document: 'food_agreement', state: 'sent_not_signed' } as const

describe('outstandingPaperwork', () => {
  it('starts 14 days before the event, when the balance and final details are due', () => {
    expect(PAPERWORK_WARNING_DAYS).toBe(14)
  })

  describe('which bookings it covers', () => {
    it.each([
      ['draft', [CONTRACT_NOT_SENT]],
      ['confirmed', [CONTRACT_NOT_SENT]],
      ['completed', []],
      ['cancelled', []],
      ['something_new', []],
    ])('status %s', (status, expected) => {
      expect(outstandingPaperwork(booking({ status }), TODAY)).toEqual(expected)
    })

    it('leaves a booking with no status alone', () => {
      expect(outstandingPaperwork(booking({ status: null }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ status: undefined }), TODAY)).toEqual([])
    })

    it('leaves a booking whose date is not yet known alone', () => {
      expect(outstandingPaperwork(booking({ date_tbd: true }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ event_date: null }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ event_date: undefined }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ event_date: '' }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ event_date: 'not a date' }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ event_date: '2026-02-30' }), TODAY)).toEqual([])
    })

    it('treats a missing date_tbd as a known date', () => {
      expect(outstandingPaperwork(booking({ date_tbd: null }), TODAY)).toEqual([CONTRACT_NOT_SENT])
      expect(outstandingPaperwork(booking({ date_tbd: undefined }), TODAY)).toEqual([CONTRACT_NOT_SENT])
    })

    it('returns nothing when today is not a real date, rather than guessing', () => {
      expect(outstandingPaperwork(booking(), 'today')).toEqual([])
    })
  })

  describe('the 14 day window', () => {
    it.each([
      ['yesterday', '2026-10-12', false],
      ['today', '2026-10-13', true],
      ['tomorrow', '2026-10-14', true],
      ['day 13', '2026-10-26', true],
      ['day 14', '2026-10-27', true],
      ['day 15', '2026-10-28', false],
      ['next year', '2027-10-13', false],
    ])('%s (%s)', (_label, eventDate, flagged) => {
      expect(outstandingPaperwork(booking({ event_date: eventDate }), TODAY).length > 0).toBe(flagged)
    })

    it('reads the date part of a stored timestamp', () => {
      expect(outstandingPaperwork(booking({ event_date: '2026-10-27T00:00:00+00:00' }), TODAY)).toEqual([CONTRACT_NOT_SENT])
    })
  })

  describe('counting days across a clock change', () => {
    // Clocks go back on Sunday 25 October 2026: that London day is 25 hours long.
    it.each([
      ['2026-10-24', '2026-10-24', 0],
      ['2026-10-24', '2026-10-25', 1],
      ['2026-10-24', '2026-10-26', 2],
      ['2026-10-25', '2026-10-25', 0],
      ['2026-10-25', '2026-10-26', 1],
      ['2026-10-26', '2026-10-26', 0],
      ['2026-10-11', '2026-10-25', 14],
      ['2026-10-11', '2026-10-26', null],
      ['2026-10-12', '2026-10-26', 14],
      ['2026-10-24', '2026-11-07', 14],
      ['2026-10-24', '2026-11-08', null],
      ['2026-10-25', '2026-11-08', 14],
      ['2026-10-25', '2026-10-24', null],
      ['2026-10-26', '2026-10-25', null],
    ])('October 2026: from %s to %s is %s', (today, eventDate, days) => {
      expect(daysUntilEventInWindow(eventDate, today)).toBe(days)
    })

    // Clocks go forward on Sunday 28 March 2027: that London day is 23 hours long.
    it.each([
      ['2027-03-27', '2027-03-27', 0],
      ['2027-03-27', '2027-03-28', 1],
      ['2027-03-27', '2027-03-29', 2],
      ['2027-03-28', '2027-03-28', 0],
      ['2027-03-28', '2027-03-29', 1],
      ['2027-03-29', '2027-03-29', 0],
      ['2027-03-14', '2027-03-28', 14],
      ['2027-03-14', '2027-03-29', null],
      ['2027-03-15', '2027-03-29', 14],
      ['2027-03-27', '2027-04-10', 14],
      ['2027-03-27', '2027-04-11', null],
      ['2027-03-28', '2027-04-11', 14],
      ['2027-03-28', '2027-03-27', null],
      ['2027-03-29', '2027-03-28', null],
    ])('March 2027: from %s to %s is %s', (today, eventDate, days) => {
      expect(daysUntilEventInWindow(eventDate, today)).toBe(days)
    })

    it('flags a booking on each day around both clock changes', () => {
      for (const day of ['2026-10-24', '2026-10-25', '2026-10-26', '2027-03-27', '2027-03-28', '2027-03-29']) {
        expect(outstandingPaperwork(booking({ event_date: day }), day)).toEqual([CONTRACT_NOT_SENT])
      }
    })

    it('counts across a month end and a year end', () => {
      expect(daysUntilEventInWindow('2026-11-01', '2026-10-31')).toBe(1)
      expect(daysUntilEventInWindow('2027-01-01', '2026-12-31')).toBe(1)
      expect(daysUntilEventInWindow('2027-03-01', '2027-02-28')).toBe(1)
    })
  })

  describe('the contract', () => {
    it('is not sent when nothing has been issued or emailed', () => {
      expect(outstandingPaperwork(booking(), TODAY)).toEqual([CONTRACT_NOT_SENT])
      expect(outstandingPaperwork(booking({ contract_version: null, contract_sent_at: undefined }), TODAY)).toEqual([CONTRACT_NOT_SENT])
    })

    it('is sent but not signed once it has been emailed', () => {
      expect(outstandingPaperwork(booking({ contract_sent_at: '2026-10-01T09:00:00Z' }), TODAY)).toEqual([CONTRACT_NOT_SIGNED])
    })

    it('is sent but not signed once it has been issued, even with no email recorded', () => {
      expect(outstandingPaperwork(booking({ contract_version: 2 }), TODAY)).toEqual([CONTRACT_NOT_SIGNED])
    })

    it('is settled once it has been accepted', () => {
      expect(outstandingPaperwork(booking({ contract_version: 1, contract_sent_at: '2026-10-01T09:00:00Z', contract_accepted_at: '2026-10-02T09:00:00Z' }), TODAY)).toEqual([])
      // Accepted on paper with nothing sent from the app.
      expect(outstandingPaperwork(booking({ contract_accepted_at: '2026-10-02T09:00:00Z' }), TODAY)).toEqual([])
    })
  })

  describe('the food agreement', () => {
    const signedContract = { contract_accepted_at: '2026-10-02T09:00:00Z' }

    it.each([
      ['not_required', false, []],
      ['required', false, [FOOD_NOT_SENT]],
      ['sent', false, [FOOD_NOT_SIGNED]],
      ['overdue', false, [FOOD_NOT_SIGNED]],
      ['signed', false, []],
      // The "Outside food" tick with a stored "not required" is out of date and reads as required.
      ['not_required', true, [FOOD_NOT_SENT]],
      ['required', true, [FOOD_NOT_SENT]],
      ['sent', true, [FOOD_NOT_SIGNED]],
      ['overdue', true, [FOOD_NOT_SIGNED]],
      ['signed', true, []],
    ])('stored status %s with the outside food tick %s', (waiverStatus, outsideFood, expected) => {
      expect(outstandingPaperwork(booking({ ...signedContract, waiver_status: waiverStatus, outside_food: outsideFood }), TODAY)).toEqual(expected)
    })

    it('reads a missing or unknown stored status as not required, unless outside food is ticked', () => {
      expect(outstandingPaperwork(booking({ ...signedContract, waiver_status: null }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ ...signedContract, waiver_status: 'mystery' }), TODAY)).toEqual([])
      expect(outstandingPaperwork(booking({ ...signedContract, waiver_status: null, outside_food: true }), TODAY)).toEqual([FOOD_NOT_SENT])
    })
  })

  describe('every combination of contract and food agreement', () => {
    const contracts: Array<[string, PaperworkBooking, ReadonlyArray<unknown>]> = [
      ['not sent', {}, [CONTRACT_NOT_SENT]],
      ['sent, not signed', { contract_version: 1, contract_sent_at: '2026-10-01T09:00:00Z' }, [CONTRACT_NOT_SIGNED]],
      ['signed', { contract_version: 1, contract_accepted_at: '2026-10-02T09:00:00Z' }, []],
    ]
    const agreements: Array<[string, PaperworkBooking, ReadonlyArray<unknown>]> = [
      ['not needed', { waiver_status: 'not_required', outside_food: false }, []],
      ['not sent', { waiver_status: 'required' }, [FOOD_NOT_SENT]],
      ['ticked with a stored not required', { waiver_status: 'not_required', outside_food: true }, [FOOD_NOT_SENT]],
      ['sent, not signed', { waiver_status: 'sent', outside_food: true }, [FOOD_NOT_SIGNED]],
      ['overdue', { waiver_status: 'overdue', outside_food: true }, [FOOD_NOT_SIGNED]],
      ['signed', { waiver_status: 'signed', outside_food: true }, []],
    ]
    for (const [contractLabel, contractFields, contractItems] of contracts) {
      for (const [agreementLabel, agreementFields, agreementItems] of agreements) {
        it(`contract ${contractLabel}, food agreement ${agreementLabel}`, () => {
          // The contract always comes first.
          expect(outstandingPaperwork(booking({ ...contractFields, ...agreementFields }), TODAY))
            .toEqual([...contractItems, ...agreementItems])
        })
      }
    }
  })
})

describe('the words shown to staff', () => {
  it('has one plain sentence for each state', () => {
    expect(paperworkSentences([CONTRACT_NOT_SENT, CONTRACT_NOT_SIGNED, FOOD_NOT_SENT, FOOD_NOT_SIGNED])).toEqual([
      'The contract has not been sent.',
      'The contract has been sent but not signed.',
      'The food agreement has not been sent.',
      'The food agreement has been sent but not signed.',
    ])
    expect(paperworkSentences([])).toEqual([])
  })

  it('says how close the event is', () => {
    expect(eventTimingSentence(0)).toBe('The event is today.')
    expect(eventTimingSentence(1)).toBe('The event is tomorrow.')
    expect(eventTimingSentence(2)).toBe('The event is in 2 days.')
    expect(eventTimingSentence(14)).toBe('The event is in 14 days.')
  })

  it('puts the rule and the words together for the page and the report', () => {
    expect(paperworkWarning(booking({ contract_version: 1, outside_food: true }), TODAY)).toEqual({
      daysUntilEvent: 5,
      items: [CONTRACT_NOT_SIGNED, FOOD_NOT_SENT],
      timing: 'The event is in 5 days.',
      sentences: ['The contract has been sent but not signed.', 'The food agreement has not been sent.'],
    })
    expect(paperworkWarning(booking({ event_date: TODAY }), TODAY)?.timing).toBe('The event is today.')
    expect(paperworkWarning(booking({ event_date: '2026-10-14' }), TODAY)?.timing).toBe('The event is tomorrow.')
  })

  it('returns null when nothing is outstanding', () => {
    expect(paperworkWarning(booking({ contract_accepted_at: '2026-10-02T09:00:00Z' }), TODAY)).toBeNull()
    expect(paperworkWarning(booking({ status: 'cancelled' }), TODAY)).toBeNull()
    expect(paperworkWarning(booking({ event_date: '2026-10-28' }), TODAY)).toBeNull()
  })

  it('never prints a broken value', () => {
    const text = JSON.stringify(paperworkWarning(booking({ contract_version: 1, waiver_status: 'overdue' }), TODAY))
    expect(text).not.toMatch(/undefined|NaN|Invalid Date/)
  })
})
