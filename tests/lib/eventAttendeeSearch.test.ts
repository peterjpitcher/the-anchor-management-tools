import { describe, expect, it } from 'vitest'
import { filterEventBookings } from '@/lib/events/attendee-search'

const bookings = [
  { id: 'aaaa1111', customer: { first_name: 'Ada', last_name: 'Lovelace', mobile_number: '+447700900123' }, attendee_names: ['Charles Babbage'] },
  { id: 'bbbb2222', customer: { first_name: 'Grace', last_name: 'Hopper', mobile_number: '+447700900999' }, attendee_names: null },
]

describe('event attendee search (BK-180)', () => {
  it('returns everyone for an empty search', () => {
    expect(filterEventBookings(bookings, '  ')).toHaveLength(2)
  })

  it('finds by booker or named guest', () => {
    expect(filterEventBookings(bookings, 'hopper').map((b) => b.id)).toEqual(['bbbb2222'])
    expect(filterEventBookings(bookings, 'babbage').map((b) => b.id)).toEqual(['aaaa1111'])
    expect(filterEventBookings(bookings, 'ada lovelace').map((b) => b.id)).toEqual(['aaaa1111'])
  })

  it('finds by an 07 number against the stored +44 one', () => {
    expect(filterEventBookings(bookings, '07700 900999').map((b) => b.id)).toEqual(['bbbb2222'])
  })
})
