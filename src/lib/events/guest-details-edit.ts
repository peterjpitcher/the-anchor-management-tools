import { z } from 'zod'
import type { BookingQuestion, StoredEventAttendee } from '@/lib/events/booking-questions'

/**
 * Adding and correcting each ticket's guest details after the booking (BK-016, customer bookings
 * review of 24 October 2026).
 *
 * The staff editor could only edit guest rows that already existed and refused a booking with
 * none, and questions are copied onto each booking when it is made, so a question added later
 * never reached anyone already booked. Phone, bar and kiosk bookings stayed without answers for
 * good, and an allergy question added a week before the night silently missed everyone.
 *
 * This is the one rule for the staff editor and the booker's manage link:
 *   - a booking with no guest rows gets one per ticket, with the event's current questions
 *   - an existing guest keeps the questions they were asked, and gains any current question
 *     their booking was made before, unanswered
 *   - question wording and ticket types never come from the person editing
 *   - an answer the guest gave to a required question cannot be erased; a required answer that
 *     was never given may stay blank (the kitchen summary lists it as missing), so whoever is
 *     filling the gaps can save what they know
 */

export const guestDetailsEditSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Each guest needs a name').max(120),
  answers: z.record(z.string().uuid(), z.string().trim().max(2000)),
})).min(1).max(20)

export type GuestDetailsEdit = z.infer<typeof guestDetailsEditSchema>

type StoredAnswer = StoredEventAttendee['answers'][number]

function answerFromQuestion(question: BookingQuestion, value: string): StoredAnswer {
  return {
    question_id: question.id,
    label: question.label,
    type: question.type,
    required: question.required,
    options: question.options ?? [],
    value,
  }
}

/**
 * The guest rows a booking shows before anyone edits them: its stored rows with any current
 * question added, or one blank row per ticket. Ids for new rows come from `newId`.
 */
export function guestDetailsForEditing(input: {
  current: StoredEventAttendee[]
  questions: BookingQuestion[]
  seats: number
  newId: () => string
}): StoredEventAttendee[] {
  if (input.current.length === 0) {
    return Array.from({ length: Math.max(0, input.seats) }, () => ({
      id: input.newId(),
      name: '',
      ticket_type_id: null,
      answers: input.questions.map((question) => answerFromQuestion(question, '')),
    }))
  }
  return input.current.map((guest) => {
    const asked = new Set((guest.answers ?? []).map((answer) => answer.question_id))
    const added = input.questions.filter((question) => !asked.has(question.id)).map((question) => answerFromQuestion(question, ''))
    return { ...guest, answers: [...(guest.answers ?? []), ...added] }
  })
}

export type GuestDetailsMergeResult =
  | { ok: true; attendees: StoredEventAttendee[]; created: boolean; questionsAdded: number }
  | { ok: false; error: string }

/**
 * Applies an edit to a booking's stored guest rows. `ticketSlots` gives each new row its ticket
 * type, in order (from the booking's ticket lines, or the event's default type).
 */
export function mergeGuestDetailsEdit(input: {
  current: StoredEventAttendee[]
  edits: GuestDetailsEdit
  questions: BookingQuestion[]
  seats: number
  ticketSlots: Array<string | null>
}): GuestDetailsMergeResult {
  const { current, edits, questions, seats } = input
  if (new Set(edits.map((edit) => edit.id)).size !== edits.length) {
    return { ok: false, error: 'Each guest must be listed once. Refresh this booking before editing.' }
  }

  let attendees: StoredEventAttendee[]
  let created = false
  let questionsAdded = 0
  let erasedRequired = false
  if (current.length === 0) {
    if (edits.length !== seats) return { ok: false, error: `Please enter details for all ${seats} guests.` }
    created = true
    attendees = edits.map((edit, index) => ({
      id: edit.id,
      name: edit.name,
      ticket_type_id: input.ticketSlots[index] ?? null,
      answers: questions.map((question) => answerFromQuestion(question, edit.answers[question.id] ?? '')),
    }))
  } else {
    const byId = new Map(edits.map((edit) => [edit.id, edit]))
    if (current.length !== seats || edits.length !== current.length || current.some((guest) => !byId.has(guest.id))) {
      return { ok: false, error: 'The guest list has changed. Refresh this booking before editing.' }
    }
    attendees = current.map((guest) => {
      const edit = byId.get(guest.id)!
      const kept = (guest.answers ?? []).map((answer) => {
        const next = edit.answers[answer.question_id]
        if (next === undefined) return answer
        // A required answer the guest gave cannot be erased.
        if (answer.required && answer.value.trim() !== '' && next === '') erasedRequired = true
        return { ...answer, value: next }
      })
      const asked = new Set(kept.map((answer) => answer.question_id))
      const added = questions
        .filter((question) => !asked.has(question.id))
        .map((question) => answerFromQuestion(question, edit.answers[question.id] ?? ''))
      questionsAdded += added.length
      return { ...guest, name: edit.name, answers: [...kept, ...added] }
    })
  }

  if (erasedRequired) return { ok: false, error: 'Please answer every required guest question' }
  for (const guest of attendees) {
    for (const answer of guest.answers) {
      if (answer.type === 'choice' && answer.value && answer.options?.length && !answer.options.includes(answer.value)) {
        return { ok: false, error: 'Please choose an available answer' }
      }
      if (answer.type === 'yes_no' && answer.value !== '' && answer.value !== 'yes' && answer.value !== 'no') {
        return { ok: false, error: 'Please choose yes or no for the yes/no questions' }
      }
    }
  }

  return { ok: true, attendees, created, questionsAdded }
}

/** How many tickets still need a name or a required answer, for the event page header. */
export function ticketsMissingDetails(bookings: Array<{ seats: number | null; attendees?: unknown }>, questions: BookingQuestion[]): number {
  const required = questions.filter((question) => question.required).map((question) => question.id)
  let missing = 0
  for (const booking of bookings) {
    const guests = Array.isArray(booking.attendees) ? (booking.attendees as StoredEventAttendee[]) : []
    if (guests.length === 0) {
      missing += Math.max(0, Number(booking.seats ?? 0))
      continue
    }
    for (const guest of guests) {
      const answered = new Map((guest.answers ?? []).map((answer) => [answer.question_id, answer.value?.trim() ?? '']))
      const blankName = !guest.name?.trim()
      const blankRequired = !guest.details_removed_at && required.some((id) => !answered.get(id))
      if (blankName || blankRequired) missing += 1
    }
  }
  return missing
}

/**
 * Whether the booker can still change guest details from their manage link: the booking is
 * live and online sales have not closed (the cutoff, or the start when there is none).
 */
export function bookerCanEditGuestDetails(input: {
  status: string | null | undefined
  eventStart: string | null | undefined
  salesCutoff: string | null | undefined
  now?: number
}): boolean {
  if (input.status !== 'confirmed' && input.status !== 'pending_payment') return false
  const now = input.now ?? Date.now()
  const closes = [input.salesCutoff, input.eventStart]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value))
  if (closes.length === 0) return false
  return Math.min(...closes) > now
}
