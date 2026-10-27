import { describe, it, expect } from 'vitest'
import { buildGuestListModel, type GuestListBookingInput } from '@/lib/events/guest-list-model'

const booking = (o: Partial<GuestListBookingInput>): GuestListBookingInput => ({
  seats: 1, attendeeNames: null, customerFirstName: null, customerLastName: null,
  isReminderOnly: false, ...o,
})

describe('buildGuestListModel', () => {
  // BK-031: every named ticket is a line from ticket 1, and the booker is named in the heading.
  it('lists every named ticket from ticket 1, with the booker in the heading', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Jane', customerLastName: 'Smith',
        attendeeNames: ['Jane Smith', 'Tom Smith', 'Priya Patel'] }),
    ])
    expect(group.bookerName).toBe('Jane Smith')
    expect(group.bookedBy).toBe('Jane Smith')
    expect(group.lines.map(l => l.name)).toEqual(['Jane Smith', 'Tom Smith', 'Priya Patel'])
    expect(group.lines.every(l => !l.isBooker)).toBe(true)
  })

  it('lists ticket 1 when the booker bought tickets for others and is not coming', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 2, customerFirstName: 'Pat', customerLastName: 'Booker',
        attendeeNames: ['Ann Guest', 'Bo Guest'] }),
    ])
    expect(group.lines.map(l => l.name)).toEqual(['Ann Guest', 'Bo Guest'])
    expect(group.lines.map(l => l.name)).not.toContain('Pat Booker')
    expect(group.bookedBy).toBe('Pat Booker')
  })

  it('lists the booker once when they are ticket 3', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 3, customerFirstName: 'Cat', customerLastName: 'Third',
        attendeeNames: ['Ann Guest', 'Bo Guest', 'Cat Third'] }),
    ])
    expect(group.lines.map(l => l.name)).toEqual(['Ann Guest', 'Bo Guest', 'Cat Third'])
    expect(group.lines.filter(l => l.name === 'Cat Third')).toHaveLength(1)
  })

  // BK-015: each guest's answers go on the door list under their name.
  it('takes names and answers from the stored guest details, keeping only answers given', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 2, customerFirstName: 'Pat', customerLastName: 'Booker', attendeeNames: ['stale', 'names'],
        attendees: [
          { id: 'a', name: 'Ann Guest', ticket_type_id: null, answers: [
            { question_id: 'q1', label: 'Any allergies?', type: 'text', value: 'Peanuts' },
            { question_id: 'q2', label: 'Step-free access?', type: 'yes_no', value: 'yes' },
          ] },
          { id: 'b', name: 'Bo Guest', ticket_type_id: null, answers: [
            { question_id: 'q1', label: 'Any allergies?', type: 'text', value: '' },
          ] },
        ] }),
    ])
    expect(group.lines.map(l => l.name)).toEqual(['Ann Guest', 'Bo Guest'])
    expect(group.lines[0].answers).toEqual([
      { label: 'Any allergies?', value: 'Peanuts' },
      { label: 'Step-free access?', value: 'Yes' },
    ])
    expect(group.lines[1].answers).toEqual([])
  })

  // BK-013: the guest's own mobile goes on the confidential door list under their name.
  it('prints a guest mobile under the guest, after their answers', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 1, customerFirstName: 'Pat', customerLastName: 'Booker',
        attendees: [{ id: 'a', name: 'Ann Guest', ticket_type_id: null, phone: '+447700900123', answers: [
          { question_id: 'q1', label: 'Any allergies?', type: 'text', value: 'Peanuts' },
        ] }] }),
    ])
    expect(group.lines[0].answers).toEqual([
      { label: 'Any allergies?', value: 'Peanuts' },
      { label: 'Mobile', value: '+447700900123' },
    ])
  })

  it('carries what the door still has to take', () => {
    const [group] = buildGuestListModel([
      booking({ seats: 1, customerFirstName: 'Sol', customerLastName: 'Reed', paymentNote: 'Not paid yet: £45.00 due' }),
    ])
    expect(group.paymentNote).toBe('Not paid yet: £45.00 due')
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
