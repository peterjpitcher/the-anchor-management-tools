import { describe, it, expect } from 'vitest'
import { buildGuestListModel, type GuestListBookingInput } from '@/lib/events/guest-list-model'

const booking = (o: Partial<GuestListBookingInput>): GuestListBookingInput => ({
  seats: 1, attendeeNames: null, customerFirstName: null, customerLastName: null,
  isReminderOnly: false, ...o,
})

describe('buildGuestListModel', () => {
  it('lists the booker first, then each further named guest', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Jane', customerLastName: 'Smith',
        attendeeNames: ['Jane Smith', 'Tom Smith', 'Priya Patel'] }),
    ])
    expect(group.bookerName).toBe('Jane Smith')
    expect(group.lines.map(l => l.name)).toEqual(['Jane Smith', 'Tom Smith', 'Priya Patel'])
    expect(group.lines[0].isBooker).toBe(true)
    expect(group.lines[1].isBooker).toBe(false)
  })

  it('fills blank lines up to the seat count when names are missing', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Alan', customerLastName: 'Jones', attendeeNames: null }),
    ])
    expect(group.lines).toHaveLength(3)
    expect(group.lines[0].name).toBe('Alan Jones')
    expect(group.lines[1].name).toBe('')
    expect(group.lines[2].name).toBe('')
  })

  it('always renders at least one line for a single-seat booking', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 1, customerFirstName: 'Sol', customerLastName: 'Reed' }),
    ])
    expect(group.lines).toHaveLength(1)
    expect(group.lines[0].name).toBe('Sol Reed')
  })

  it('excludes reminder-only and zero-seat bookings', () => {
    const groups = buildGuestListModel([
      booking({ seats: 0, customerFirstName: 'No', customerLastName: 'Seat' }),
      booking({ seats: 2, isReminderOnly: true, customerFirstName: 'Rem', customerLastName: 'Only' }),
      booking({ seats: 1, customerFirstName: 'Real', customerLastName: 'Guest' }),
    ])
    expect(groups.map(g => g.bookerName)).toEqual(['Real Guest'])
  })

  it('sorts groups by booker surname then first name', () => {
    const groups = buildGuestListModel([
      booking({ customerFirstName: 'Zoe', customerLastName: 'Adams' }),
      booking({ customerFirstName: 'Amy', customerLastName: 'Adams' }),
      booking({ customerFirstName: 'Bob', customerLastName: 'Zephyr' }),
    ])
    expect(groups.map(g => g.bookerName)).toEqual(['Amy Adams', 'Zoe Adams', 'Bob Zephyr'])
  })
})
