import { describe, expect, it } from 'vitest'
import {
  bookerCanEditGuestDetails,
  guestDetailsForEditing,
  mergeGuestDetailsEdit,
  ticketsMissingDetails,
} from '@/lib/events/guest-details-edit'
import type { BookingQuestion, StoredEventAttendee } from '@/lib/events/booking-questions'

/*
 * BK-016, customer bookings review of 24 October 2026: staff and the booker can add guest
 * details after booking, including answers to a question added later.
 */

const ALLERGY: BookingQuestion = { id: '11111111-1111-4111-8111-111111111111', label: 'Any allergies?', type: 'text', required: true }
const MEAL: BookingQuestion = { id: '22222222-2222-4222-8222-222222222222', label: 'Meal', type: 'choice', required: false, options: ['Beef', 'Veg'] }
const GUEST_A = '33333333-3333-4333-8333-333333333331'
const GUEST_B = '33333333-3333-4333-8333-333333333332'
const TICKET = '44444444-4444-4444-8444-444444444444'

const stored = (id: string, name: string, allergy: string): StoredEventAttendee => ({
  id, name, ticket_type_id: TICKET,
  answers: [{ question_id: ALLERGY.id, label: ALLERGY.label, type: 'text', required: true, value: allergy }],
})

describe('mergeGuestDetailsEdit', () => {
  it('creates one guest per ticket on a booking that has none, with the event\'s current questions and ticket types', () => {
    const result = mergeGuestDetailsEdit({
      current: [],
      edits: [
        { id: GUEST_A, name: 'Ann', answers: { [ALLERGY.id]: 'Peanuts', [MEAL.id]: 'Veg' } },
        { id: GUEST_B, name: 'Bo', answers: {} },
      ],
      questions: [ALLERGY, MEAL],
      seats: 2,
      ticketSlots: [TICKET, TICKET],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toBe(true)
    expect(result.attendees.map((guest) => [guest.name, guest.ticket_type_id])).toEqual([['Ann', TICKET], ['Bo', TICKET]])
    expect(result.attendees[0].answers).toEqual([
      { question_id: ALLERGY.id, label: ALLERGY.label, type: 'text', required: true, options: [], value: 'Peanuts' },
      { question_id: MEAL.id, label: 'Meal', type: 'choice', required: false, options: ['Beef', 'Veg'], value: 'Veg' },
    ])
    // A required answer nobody has given yet may stay blank; the kitchen summary lists it.
    expect(result.attendees[1].answers[0].value).toBe('')
  })

  it('needs a guest for every ticket when it creates them', () => {
    const result = mergeGuestDetailsEdit({ current: [], edits: [{ id: GUEST_A, name: 'Ann', answers: {} }], questions: [ALLERGY], seats: 2, ticketSlots: [] })
    expect(result).toEqual({ ok: false, error: 'Please enter details for all 2 guests.' })
  })

  it('asks an existing guest a question added after they booked, and keeps the wording they were asked', () => {
    const result = mergeGuestDetailsEdit({
      current: [stored(GUEST_A, 'Ann', 'Peanuts')],
      edits: [{ id: GUEST_A, name: 'Ann', answers: { [ALLERGY.id]: 'Peanuts', [MEAL.id]: 'Beef' } }],
      questions: [{ ...ALLERGY, label: 'Reworded allergy question' }, MEAL],
      seats: 1,
      ticketSlots: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questionsAdded).toBe(1)
    expect(result.attendees[0].answers.map((answer) => [answer.label, answer.value])).toEqual([['Any allergies?', 'Peanuts'], ['Meal', 'Beef']])
  })

  it('cannot erase a required answer the guest gave', () => {
    const result = mergeGuestDetailsEdit({
      current: [stored(GUEST_A, 'Ann', 'Peanuts')],
      edits: [{ id: GUEST_A, name: 'Ann', answers: { [ALLERGY.id]: '' } }],
      questions: [ALLERGY], seats: 1, ticketSlots: [],
    })
    expect(result).toEqual({ ok: false, error: 'Please answer every required guest question' })
  })

  it('refuses a choice that is not offered', () => {
    const result = mergeGuestDetailsEdit({
      current: [], edits: [{ id: GUEST_A, name: 'Ann', answers: { [MEAL.id]: 'Fish' } }],
      questions: [MEAL], seats: 1, ticketSlots: [null],
    })
    expect(result).toEqual({ ok: false, error: 'Please choose an available answer' })
  })

  it('refuses an edit made against an out-of-date guest list', () => {
    const result = mergeGuestDetailsEdit({
      current: [stored(GUEST_A, 'Ann', 'Peanuts')],
      edits: [{ id: GUEST_B, name: 'Bo', answers: {} }],
      questions: [ALLERGY], seats: 1, ticketSlots: [],
    })
    expect(result).toEqual({ ok: false, error: 'The guest list has changed. Refresh this booking before editing.' })
  })
})

describe('guestDetailsForEditing', () => {
  it('starts a booking with none on one blank guest per ticket', () => {
    let n = 0
    const rows = guestDetailsForEditing({ current: [], questions: [ALLERGY], seats: 3, newId: () => `new-${++n}` })
    expect(rows.map((row) => row.id)).toEqual(['new-1', 'new-2', 'new-3'])
    expect(rows.every((row) => row.name === '' && row.answers.length === 1)).toBe(true)
  })
})

describe('ticketsMissingDetails', () => {
  it('counts tickets with no guest row, no name or a blank required answer', () => {
    expect(ticketsMissingDetails([
      { seats: 3, attendees: [] },
      { seats: 2, attendees: [stored(GUEST_A, 'Ann', 'Peanuts'), stored(GUEST_B, 'Bo', '')] },
      { seats: 1, attendees: [stored(GUEST_A, 'Cat', 'None')] },
    ], [ALLERGY])).toBe(4)
  })

  it('does not count answers the 90-day retention removed', () => {
    expect(ticketsMissingDetails([{ seats: 1, attendees: [{ ...stored(GUEST_A, 'Ann', ''), details_removed_at: '2027-02-18T03:30:00Z' }] }], [ALLERGY])).toBe(0)
  })
})

describe('bookerCanEditGuestDetails', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  it('stays open until online sales close', () => {
    expect(bookerCanEditGuestDetails({ status: 'confirmed', eventStart: '2026-11-20T19:00:00Z', salesCutoff: '2026-11-19T12:00:00Z', now })).toBe(true)
    expect(bookerCanEditGuestDetails({ status: 'confirmed', eventStart: '2026-11-20T19:00:00Z', salesCutoff: '2026-11-09T12:00:00Z', now })).toBe(false)
    expect(bookerCanEditGuestDetails({ status: 'confirmed', eventStart: '2026-11-09T19:00:00Z', salesCutoff: null, now })).toBe(false)
  })
  it('is closed for a booking that is not live', () => {
    expect(bookerCanEditGuestDetails({ status: 'cancelled', eventStart: '2026-11-20T19:00:00Z', salesCutoff: null, now })).toBe(false)
    expect(bookerCanEditGuestDetails({ status: 'expired', eventStart: '2026-11-20T19:00:00Z', salesCutoff: null, now })).toBe(false)
  })
})
