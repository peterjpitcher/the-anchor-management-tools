import { describe, expect, it } from 'vitest'
import {
  contractOutOfDate,
  contractTermsChanges,
  contractTermsOf,
  describeContractTermsChanges,
  readContractTerms,
} from '@/lib/private-bookings/contract-terms'
import { outstandingPaperwork, paperworkSentences } from '@/lib/private-bookings/paperwork'

// BK-154, D25: a contract fixes the date, times, guests, rooms and price.
const BOOKING = {
  status: 'confirmed',
  event_date: '2026-12-05',
  date_tbd: false,
  start_time: '18:00:00',
  end_time: '23:30:00',
  end_time_next_day: false,
  guest_count: 40,
  discount_type: null,
  discount_amount: 0,
  contract_version: 2,
  contract_sent_at: '2026-10-20T10:00:00.000Z',
  contract_accepted_at: '2026-10-21T10:00:00.000Z',
}
const ITEMS = [
  { space_id: 'room-b', quantity: 1, unit_price: 200, line_total: 200, vat_rate: 20 },
  { space_id: 'room-a', quantity: 1, unit_price: 100, line_total: 100, vat_rate: 20 },
  { space_id: null, quantity: 40, unit_price: 10, line_total: 400, vat_rate: 20 },
]

describe('contract terms', () => {
  it('reads the date, times, guests, rooms (sorted, once each) and the VAT-inclusive total', () => {
    expect(contractTermsOf(BOOKING, [...ITEMS, { space_id: 'room-a', quantity: 0, unit_price: 0, line_total: 0 }])).toEqual({
      v: 1,
      event_date: '2026-12-05',
      start_time: '18:00',
      end_time: '23:30',
      end_time_next_day: false,
      guest_count: 40,
      space_ids: ['room-a', 'room-b'],
      total: 840,
    })
  })

  it('has no date while the date is to be confirmed', () => {
    expect(contractTermsOf({ ...BOOKING, date_tbd: true }, ITEMS).event_date).toBeNull()
  })

  it('takes the booking discount off the price', () => {
    expect(contractTermsOf({ ...BOOKING, discount_type: 'percent', discount_amount: 10 }, ITEMS).total).toBe(756)
  })

  it('names each kind of change, in reading order', () => {
    const sent = contractTermsOf(BOOKING, ITEMS)
    const now = contractTermsOf(
      { ...BOOKING, event_date: '2026-12-06', end_time: '00:30', end_time_next_day: true, guest_count: 45 },
      ITEMS.slice(1),
    )
    expect(contractTermsChanges(sent, now)).toEqual(['date', 'times', 'guest numbers', 'rooms', 'price'])
    expect(describeContractTermsChanges(['date', 'times', 'price'])).toBe('the date, the times and the price')
    expect(describeContractTermsChanges(['price'])).toBe('the price')
  })

  it('sees no change when a time is stored with or without seconds', () => {
    const sent = contractTermsOf({ ...BOOKING, start_time: '18:00' }, ITEMS)
    expect(contractTermsChanges(sent, contractTermsOf(BOOKING, ITEMS))).toEqual([])
  })

  it('cannot compare a contract sent before the terms were kept, so never flags it', () => {
    expect(readContractTerms(null)).toBeNull()
    expect(readContractTerms({ v: 99 })).toBeNull()
    expect(contractTermsChanges(null, contractTermsOf(BOOKING, ITEMS))).toEqual([])
    expect(contractOutOfDate({ ...BOOKING, contract_terms: null, guest_count: 99 }, ITEMS)).toBeNull()
  })

  it('flags an accepted contract once the booking changes, and names the next version', () => {
    const contract_terms = contractTermsOf(BOOKING, ITEMS)
    expect(contractOutOfDate({ ...BOOKING, contract_terms }, ITEMS)).toBeNull()
    expect(contractOutOfDate({ ...BOOKING, contract_terms, guest_count: 50 }, ITEMS)).toEqual({
      changes: ['guest numbers'],
      currentVersion: 2,
      nextVersion: 3,
      accepted: true,
    })
  })

  it('leaves cancelled and completed bookings, and bookings with no contract sent, alone', () => {
    const contract_terms = contractTermsOf(BOOKING, ITEMS)
    for (const status of ['cancelled', 'completed']) {
      expect(contractOutOfDate({ ...BOOKING, status, contract_terms, guest_count: 50 }, ITEMS)).toBeNull()
    }
    expect(
      contractOutOfDate({ ...BOOKING, contract_terms, contract_sent_at: null, contract_accepted_at: null, guest_count: 50 }, ITEMS),
    ).toBeNull()
  })

  it('makes the paperwork warning say the contract is out of date, even when accepted', () => {
    const items = outstandingPaperwork(
      { status: 'confirmed', event_date: '2026-10-30', contract_version: 2, contract_accepted_at: '2026-10-01T09:00:00Z', contract_out_of_date: true },
      '2026-10-28',
    )
    expect(items).toEqual([{ document: 'contract', state: 'out_of_date' }])
    expect(paperworkSentences(items)).toEqual(['The booking has changed since the contract was sent. Send the new version.'])
  })
})
