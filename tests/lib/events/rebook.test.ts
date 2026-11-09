import { describe, expect, it } from 'vitest'
import {
  carryGuestsToRebook,
  describeRebookBlock,
  rebookDoorCharge,
  rebookGuestSummaries,
  rebookRefusal,
} from '@/lib/events/rebook'
import type { BookingQuestion } from '@/lib/events/booking-questions'

/*
 * Rebook a booking whose payment hold ran out (owner request, 9 November 2026). Fixtures follow
 * the tasting night that day: Helen's website hold for two lapsed, Leo needed one ticket not two,
 * Rupi was paying cash at the bar.
 */

const ALLERGY: BookingQuestion = { id: '11111111-1111-4111-8111-111111111111', label: 'Allergies?', type: 'text', required: true }
const WINE: BookingQuestion = { id: '22222222-2222-4222-8222-222222222222', label: 'Wine?', type: 'choice', required: false, options: ['Red', 'White'] }
const DRIVING: BookingQuestion = { id: '33333333-3333-4333-8333-333333333333', label: 'Driving?', type: 'yes_no', required: false }

const helenGuests = [
  {
    id: 'g-helen',
    name: 'Helen Bhoobun',
    phone: '+447700900001',
    ticket_type_id: 't1',
    details_confirmed_at: '2026-11-09T14:10:16Z',
    answers: [
      { question_id: ALLERGY.id, label: ALLERGY.label, type: 'text', value: 'Allergy to coconut' },
      { question_id: WINE.id, label: WINE.label, type: 'choice', value: 'Rose' },
      { question_id: DRIVING.id, label: DRIVING.label, type: 'yes_no', value: 'no' },
      { question_id: 'retired-question', label: 'Old', type: 'text', value: 'Gone' },
    ],
  },
  {
    id: 'g-amar',
    name: 'Amar Bhoobun',
    ticket_type_id: 't1',
    answers: [{ question_id: ALLERGY.id, label: ALLERGY.label, type: 'text', value: 'None' }],
  },
]

let counter = 0
const newId = () => `new-${++counter}`

describe('carryGuestsToRebook', () => {
  it('carries every guest, with their mobile and the answers the event still accepts', () => {
    counter = 0
    const result = carryGuestsToRebook({ storedAttendees: helenGuests, seats: 2, questions: [ALLERGY, WINE, DRIVING], newId })
    expect(result).toEqual({
      ok: true,
      attendees: [
        {
          id: 'new-1',
          name: 'Helen Bhoobun',
          phone: '+447700900001',
          details_confirmed: true,
          // "Rose" is not a choice any more and the retired question is gone, so neither can refuse the booking.
          answers: { [ALLERGY.id]: 'Allergy to coconut', [DRIVING.id]: 'no' },
        },
        { id: 'new-2', name: 'Amar Bhoobun', answers: { [ALLERGY.id]: 'None' } },
      ],
    })
  })

  it('keeps only the guests staff chose when there are fewer tickets', () => {
    counter = 0
    const result = carryGuestsToRebook({ storedAttendees: helenGuests, keepGuestIds: ['g-amar'], seats: 1, questions: [ALLERGY], newId })
    expect(result.ok && result.attendees?.map((guest) => guest.name)).toEqual(['Amar Bhoobun'])
  })

  it('asks staff to choose rather than dropping a guest at random', () => {
    expect(carryGuestsToRebook({ storedAttendees: helenGuests, seats: 1, questions: [ALLERGY] }))
      .toEqual({ ok: false, error: 'Choose which guests are coming: there is 1 ticket and 2 guests.' })
    expect(carryGuestsToRebook({ storedAttendees: helenGuests, keepGuestIds: ['g-helen', 'g-amar'], seats: 1, questions: [ALLERGY] }).ok).toBe(false)
  })

  it('refuses a choice naming a guest the booking no longer has', () => {
    expect(carryGuestsToRebook({ storedAttendees: helenGuests, keepGuestIds: ['g-someone-else'], seats: 1, questions: [ALLERGY] }))
      .toEqual({ ok: false, error: 'The guests on this booking have changed. Close this and try again.' })
  })

  it('adds blank rows for extra tickets, to follow as on any staff booking', () => {
    counter = 0
    const result = carryGuestsToRebook({ storedAttendees: helenGuests.slice(0, 1), seats: 3, questions: [ALLERGY], newId })
    expect(result.ok && result.attendees?.slice(1)).toEqual([
      { id: 'new-2', name: '', answers: {} },
      { id: 'new-3', name: '', answers: {} },
    ])
  })

  it('sends no guest rows for a phone booking that had none (Leo, Rupi)', () => {
    expect(carryGuestsToRebook({ storedAttendees: [], seats: 1, questions: [ALLERGY] })).toEqual({ ok: true, attendees: undefined })
    expect(carryGuestsToRebook({ storedAttendees: null, seats: 4, questions: [ALLERGY] })).toEqual({ ok: true, attendees: undefined })
  })

  it('does not bring back answers the retention job removed', () => {
    counter = 0
    const removed = [{ ...helenGuests[1], details_removed_at: '2026-11-01T00:00:00Z' }]
    const result = carryGuestsToRebook({ storedAttendees: removed, seats: 1, questions: [ALLERGY], newId })
    expect(result.ok && result.attendees?.[0].answers).toEqual({})
  })
})

describe('rebookGuestSummaries', () => {
  it('lists the guests to choose between, naming unnamed ones by position', () => {
    expect(rebookGuestSummaries([{ id: 'a', name: 'Sam' }, { id: 'b', name: ' ' }, { name: 'No id' }])).toEqual([
      { id: 'a', name: 'Sam' },
      { id: 'b', name: 'Guest 2' },
    ])
    expect(rebookGuestSummaries(undefined)).toEqual([])
  })
})

describe('rebookDoorCharge', () => {
  it('charges the door price, not the online price (EV-02)', () => {
    // Tasting night: £45 ticket, £40 online. Rupi's four at the bar is £180.
    expect(rebookDoorCharge({ seats: 4, ticketBasePrice: 45, eventFullUnitPrice: 45 })).toBe(180)
    expect(rebookDoorCharge({ seats: 1, ticketBasePrice: '30.00', eventFullUnitPrice: 45 })).toBe(30)
    expect(rebookDoorCharge({ seats: 2, ticketBasePrice: null, eventFullUnitPrice: 45 })).toBe(90)
  })
})

describe('rebookRefusal', () => {
  it('allows a lapsed booking with one ticket type and no other booking', () => {
    expect(rebookRefusal({ status: 'expired', ticketTypeCount: 1 })).toBeNull()
    expect(rebookRefusal({ status: 'expired', ticketTypeCount: 0 })).toBeNull()
  })

  it('refuses anything else, saying what to do instead', () => {
    expect(rebookRefusal({ status: 'cancelled', ticketTypeCount: 1 })).toBe('Only a booking whose payment hold ran out can be rebooked.')
    expect(rebookRefusal({ status: 'expired', isReminderOnly: true, ticketTypeCount: 0 })).toMatch(/reminder/)
    expect(rebookRefusal({ status: 'expired', otherActiveBooking: { status: 'pending_payment' }, ticketTypeCount: 1 })).toMatch(/waiting for payment/)
    expect(rebookRefusal({ status: 'expired', otherActiveBooking: { status: 'confirmed' }, ticketTypeCount: 1 })).toMatch(/confirmed booking/)
    expect(rebookRefusal({ status: 'expired', ticketTypeCount: 2 })).toMatch(/Add Booking/)
  })
})

describe('describeRebookBlock', () => {
  it('says how many places are left on a full event', () => {
    expect(describeRebookBlock('insufficient_capacity', 1)).toBe('Only 1 place is left. Nothing was booked.')
    expect(describeRebookBlock('insufficient_capacity', 0)).toBe('The event is full. Nothing was booked.')
    expect(describeRebookBlock('customer_conflict')).toBe('This guest already has an active booking for this event.')
    expect(describeRebookBlock('event_started')).toBe('The event has started, so it can no longer be booked.')
    expect(describeRebookBlock(null)).toBe('The booking could not be made. Nothing was booked.')
  })
})
