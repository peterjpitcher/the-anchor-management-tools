import { z } from 'zod'

export const bookingQuestionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(240),
  type: z.enum(['text', 'yes_no', 'choice']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
}).superRefine((question, context) => {
  if (question.type === 'choice' && (!question.options || question.options.length < 2)) {
    context.addIssue({ code: 'custom', message: 'Choice questions need at least two options', path: ['options'] })
  }
  if (question.options && new Set(question.options).size !== question.options.length) {
    context.addIssue({ code: 'custom', message: 'Each choice must be different', path: ['options'] })
  }
})

export const bookingQuestionsSchema = z.array(bookingQuestionSchema).max(20).superRefine((questions, context) => {
  if (new Set(questions.map(question => question.id)).size !== questions.length) {
    context.addIssue({ code: 'custom', message: 'Each question must have a unique identifier' })
  }
})
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>

export const eventAttendeeInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Each ticket needs a guest name').max(120),
  ticket_type_id: z.string().uuid().nullable().optional(),
  answers: z.record(z.string().uuid(), z.string().trim().max(2000)),
})
export const eventAttendeesInputSchema = z.array(eventAttendeeInputSchema).max(20).superRefine((attendees, context) => {
  if (new Set(attendees.map(attendee => attendee.id)).size !== attendees.length) {
    context.addIssue({ code: 'custom', message: 'Each guest must have a unique identifier' })
  }
})
export type EventAttendeeInput = z.infer<typeof eventAttendeeInputSchema>
export interface StoredEventAttendee {
  id: string
  name: string
  ticket_type_id: string | null
  answers: Array<{ question_id: string; label: string; type: BookingQuestion['type']; value: string; required?: boolean; options?: string[] }>
}

/** Validate against the current event, never against question wording supplied by a buyer. */
export function validateEventAttendees(input: {
  attendees: EventAttendeeInput[] | undefined
  questions: BookingQuestion[]
  seats: number
  required: boolean
  selections?: Array<{ ticket_type_id: string; quantity: number }>
}): string | null {
  const { attendees, questions, seats, required, selections } = input
  if (!attendees?.length && !required) return null
  if (!attendees || attendees.length !== seats) return `Please enter details for all ${seats} guests`
  const parsed = eventAttendeesInputSchema.safeParse(attendees)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Please check the guest details'
  const ids = new Set(questions.map(question => question.id))
  for (const [index, attendee] of attendees.entries()) {
    if (Object.keys(attendee.answers).some(id => !ids.has(id))) return 'The event questions have changed. Refresh the event and check your answers.'
    for (const question of questions) {
      const value = attendee.answers[question.id]?.trim() ?? ''
      if (!value && question.required) return `Guest ${index + 1}: please answer ${question.label}`
      if (value && question.type === 'yes_no' && value !== 'yes' && value !== 'no') return `Guest ${index + 1}: please choose yes or no`
      if (value && question.type === 'choice' && !question.options?.includes(value)) return `Guest ${index + 1}: please choose an available answer`
    }
  }
  if (selections?.length) {
    const counts = new Map<string, number>()
    for (const selection of selections) {
      if (counts.has(selection.ticket_type_id)) return 'Select each ticket type only once'
      counts.set(selection.ticket_type_id, selection.quantity)
    }
    for (const attendee of attendees) {
      if (!attendee.ticket_type_id || !counts.has(attendee.ticket_type_id)) return 'Each guest must match a selected ticket'
      counts.set(attendee.ticket_type_id, counts.get(attendee.ticket_type_id)! - 1)
    }
    if ([...counts.values()].some(count => count !== 0)) return 'Guest details must match the ticket quantities'
  }
  return null
}
