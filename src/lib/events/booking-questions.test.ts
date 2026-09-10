import { describe, expect, it } from 'vitest'
import { bookingQuestionsSchema, validateEventAttendees, type BookingQuestion } from './booking-questions'
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
