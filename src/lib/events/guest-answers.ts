import type { BookingQuestion, StoredEventAttendee } from '@/lib/events/booking-questions'

/**
 * Each guest's answers to the event's questions, gathered for the people who use them on the
 * night (BK-015, customer bookings review of 24 October 2026; owner decision D6).
 *
 * Answers (for the 20 November tasting night, allergies) only appeared under each booking on the
 * event page. The door list, the kitchen and the event page summary now read them through here.
 * D6: answers and booking notes may be printed on kitchen and door sheets, marked confidential
 * and shredded after service. They never go on the table card the guest sees.
 */

export const CONFIDENTIAL_PRINT_NOTE = 'Confidential: guests\' answers. Shred after service.'

export type GuestAnswer = { label: string; value: string }

export type GuestAnswersBooking = {
  id: string
  reference: string
  bookerName: string
  attendees: unknown
  notes?: string | null
}

export type QuestionSummary = {
  questionId: string
  label: string
  required: boolean
  answered: Array<{ reference: string; guestName: string; value: string }>
  missingRequired: Array<{ reference: string; guestName: string }>
}

export type GuestAnswersSummary = {
  guests: number
  questions: QuestionSummary[]
  notes: Array<{ reference: string; bookerName: string; note: string; unconfirmedRequest: boolean }>
}

/** A short reference staff can read out, the same one the booking sheets fall back to. */
export function eventBookingReference(bookingId: string): string {
  return `ANC-${bookingId.slice(0, 8).toUpperCase()}`
}

export function storedAttendees(value: unknown): StoredEventAttendee[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is StoredEventAttendee => Boolean(entry) && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string')
}

/** The non-blank answers one guest gave, in the order the questions were asked. */
export function guestAnswers(attendee: StoredEventAttendee): GuestAnswer[] {
  return (Array.isArray(attendee.answers) ? attendee.answers : [])
    .filter((answer) => typeof answer?.value === 'string' && answer.value.trim() !== '')
    .map((answer) => ({ label: String(answer.label ?? ''), value: displayAnswer(answer.type, answer.value.trim()) }))
}

export function displayAnswer(type: string | undefined, value: string): string {
  if (type === 'yes_no') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value
  return value
}

/** True when any guest on the booking gave an answer, so the door knows to look. */
export function hasGuestAnswers(attendees: unknown): boolean {
  return storedAttendees(attendees).some((attendee) => guestAnswers(attendee).length > 0)
}

const UNCONFIRMED_REQUEST = /^UNCONFIRMED REQUEST/i

/**
 * Every question asked, with who answered what and whose required answer is blank, plus the
 * booking notes. Questions come from each booking's own snapshot, so a question since removed
 * still shows the answers given to it, and the event's current questions are listed even when
 * nobody has answered yet.
 */
export function summariseGuestAnswers(bookings: GuestAnswersBooking[], currentQuestions: BookingQuestion[] = []): GuestAnswersSummary {
  const byQuestion = new Map<string, QuestionSummary>()
  const questionFor = (questionId: string, label: string, required: boolean): QuestionSummary => {
    const existing = byQuestion.get(questionId)
    if (existing) return existing
    const created: QuestionSummary = { questionId, label, required, answered: [], missingRequired: [] }
    byQuestion.set(questionId, created)
    return created
  }
  for (const question of currentQuestions) questionFor(question.id, question.label, question.required)

  let guests = 0
  const notes: GuestAnswersSummary['notes'] = []
  for (const booking of bookings) {
    for (const attendee of storedAttendees(booking.attendees)) {
      guests += 1
      for (const answer of Array.isArray(attendee.answers) ? attendee.answers : []) {
        if (!answer?.question_id) continue
        const summary = questionFor(answer.question_id, String(answer.label ?? ''), Boolean(answer.required))
        const value = typeof answer.value === 'string' ? answer.value.trim() : ''
        if (value) summary.answered.push({ reference: booking.reference, guestName: attendee.name, value: displayAnswer(answer.type, value) })
        else if (answer.required && !attendee.details_removed_at) summary.missingRequired.push({ reference: booking.reference, guestName: attendee.name })
      }
    }
    const note = booking.notes?.trim()
    if (note) notes.push({ reference: booking.reference, bookerName: booking.bookerName, note, unconfirmedRequest: UNCONFIRMED_REQUEST.test(note) })
  }

  return { guests, questions: [...byQuestion.values()], notes }
}
