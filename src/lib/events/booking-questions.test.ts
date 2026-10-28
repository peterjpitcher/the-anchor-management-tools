import { describe, expect, it } from 'vitest'
import { bookingQuestionsSchema, normaliseAttendeePhones, prepareStaffEventAttendees, validateEventAttendees, type BookingQuestion } from './booking-questions'
const q = '11111111-1111-4111-8111-111111111111'
const person = '22222222-2222-4222-8222-222222222222'
const type = '33333333-3333-4333-8333-333333333333'
const questions: BookingQuestion[] = [{ id: q, label: 'Any allergies?', type: 'yes_no', required: true }]
const guest = { id: person, name: 'Guest One', ticket_type_id: type, answers: { [q]: 'no' } }
describe('paid event guest validation', () => {
  it('leaves free bookings without guest details unchanged', () => {
    expect(validateEventAttendees({ questions: [], seats: 4, required: false, attendees: undefined })).toBeNull()
  })
  it('requires a person for every paid ticket', () => {
    expect(validateEventAttendees({ questions, seats: 2, required: true, attendees: [guest] })).toContain('all 2')
  })
  it('accepts an explicit no from a guest separate from the purchaser', () => {
    expect(validateEventAttendees({ questions, seats: 1, required: true, attendees: [guest] })).toBeNull()
  })
  it('rejects omitted required answers', () => {
    expect(validateEventAttendees({ questions, seats: 1, required: true, attendees: [{ ...guest, answers: {} }] })).toContain('Guest 1')
  })
  it('rejects removed questions instead of losing answers silently', () => {
    expect(validateEventAttendees({ questions: [], seats: 1, required: true, attendees: [guest] })).toContain('changed')
  })
  it('rejects guests attached to the wrong ticket', () => {
    expect(validateEventAttendees({ questions, seats: 1, required: true, attendees: [guest], selections: [{ ticket_type_id: person, quantity: 1 }] })).toContain('selected ticket')
  })
  it('rejects duplicate guest identities', () => {
    expect(validateEventAttendees({ questions, seats: 2, required: true, attendees: [guest, guest] })).toContain('unique')
  })
  it('rejects a choice that is no longer offered', () => {
    expect(validateEventAttendees({ questions: [{ ...questions[0], type: 'choice', options: ['A', 'B'] }], seats: 1, required: true, attendees: [guest] })).toContain('available answer')
  })
  it('rejects duplicate question identifiers and empty choices', () => {
    expect(bookingQuestionsSchema.safeParse([questions[0], questions[0]]).success).toBe(false)
    expect(bookingQuestionsSchema.safeParse([{ ...questions[0], type: 'choice', options: [] }]).success).toBe(false)
  })
})

// BK-013: each guest's own mobile, optional.
describe('guest mobile numbers', () => {
  it('normalises each phone to E.164 and drops blank ones', () => {
    expect(normaliseAttendeePhones([{ ...guest, phone: '07700 900123' }, { ...guest, phone: ' ' }])).toEqual([{ ...guest, phone: '+447700900123' }, guest])
  })
  it('answers null when any phone cannot be a number', () => {
    expect(normaliseAttendeePhones([{ ...guest, phone: 'call me' }])).toBeNull()
  })
})

// BK-011, owner decision D5: staff channels save what they know, the rest follows.
describe('staff guest rows', () => {
  const blank = { id: person, name: '', answers: {} }
  it('sends nothing when every row is blank', () => {
    expect(prepareStaffEventAttendees({ attendees: [blank], questions, seats: 1 })).toEqual({ ok: true, attendees: undefined })
  })
  it('allows a blank name and a blank required answer to follow', () => {
    const second = { id: '44444444-4444-4444-8444-444444444444', name: 'Sam', answers: {} }
    const result = prepareStaffEventAttendees({ attendees: [{ ...blank, phone: '07700900123' }, second], questions, seats: 2 })
    expect(result).toEqual({ ok: true, attendees: [{ ...blank, phone: '+447700900123' }, second] })
  })
  it('still needs one row per ticket once any detail is given', () => {
    expect(prepareStaffEventAttendees({ attendees: [{ ...blank, name: 'Sam' }], questions, seats: 2 })).toEqual({ ok: false, error: expect.stringContaining('2 tickets') })
  })
  it('refuses an answer that is given but not valid', () => {
    expect(prepareStaffEventAttendees({ attendees: [{ ...blank, answers: { [q]: 'maybe' } }], questions, seats: 1 })).toEqual({ ok: false, error: 'Guest 1: please choose yes or no' })
  })
  it('refuses a phone that cannot be a number', () => {
    expect(prepareStaffEventAttendees({ attendees: [{ ...blank, name: 'Sam', phone: '12' }], questions, seats: 1 })).toEqual({ ok: false, error: 'Please check the guest mobile numbers' })
  })
})
