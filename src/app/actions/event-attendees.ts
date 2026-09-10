'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StoredEventAttendee } from '@/lib/events/booking-questions'

const editSchema = z.object({
  bookingId: z.string().uuid(),
  attendees: z.array(z.object({
    id: z.string().uuid(), name: z.string().trim().min(1).max(120),
    answers: z.record(z.string().uuid(), z.string().trim().max(2000)),
  })).min(1).max(20),
})

export async function updateEventAttendees(input: z.input<typeof editSchema>): Promise<{ success?: boolean; error?: string }> {
  const parsed = editSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Please check the guest details' }
  const session = await createClient()
  const [{ data: { user } }, canManage] = await Promise.all([
    session.auth.getUser(), checkUserPermission('events', 'manage'),
  ])
  if (!user || !canManage) return { error: 'You do not have permission to edit guest details' }
  const db = createAdminClient()
  const { data: booking, error } = await db.from('bookings').select('id,event_id,seats,attendees,updated_at').eq('id', parsed.data.bookingId).maybeSingle()
  if (error || !booking) return { error: 'Guest details could not be loaded' }
  const current = (booking.attendees ?? []) as StoredEventAttendee[]
  const edits = new Map(parsed.data.attendees.map(guest => [guest.id, guest]))
  if (current.length !== booking.seats || edits.size !== current.length || parsed.data.attendees.length !== current.length || current.some(guest => !edits.has(guest.id))) {
    return { error: 'The guest list has changed. Refresh this booking before editing.' }
  }
  // Only names and answer values are editable. Never trust client question
  // wording or ticket ownership, and preserve the original question snapshots.
  const attendees = current.map(guest => {
    const edit = edits.get(guest.id)!
    return { ...guest, name: edit.name, answers: guest.answers.map(answer => ({ ...answer, value: edit.answers[answer.question_id] ?? answer.value })) }
  })
  if (attendees.some(guest => guest.answers.some(answer => answer.required && !answer.value.trim()))) {
    return { error: 'Please answer every required guest question' }
  }
  if (attendees.some(guest => guest.answers.some(answer => answer.type === 'choice' && answer.value && answer.options && !answer.options.includes(answer.value)))) {
    return { error: 'Please choose an available answer' }
  }
  if (attendees.some(guest => guest.answers.some(answer => answer.type === 'yes_no' && answer.value !== '' && answer.value !== 'yes' && answer.value !== 'no'))) {
    return { error: 'Please choose yes or no for the yes/no questions' }
  }
  let update = db.from('bookings').update({ attendees, updated_at: new Date().toISOString() }).eq('id', booking.id)
  if (booking.updated_at) update = update.eq('updated_at', booking.updated_at)
  const { data: saved, error: saveError } = await update.select('id').maybeSingle()
  if (saveError) return { error: 'Guest details could not be saved. Please try again.' }
  if (!saved) return { error: 'Someone else changed this booking. Refresh before saving.' }
  await logAuditEvent({ user_id: user.id, operation_type: 'update', resource_type: 'event_booking', resource_id: booking.id, operation_status: 'success', additional_info: { field: 'guest_details', guest_count: attendees.length } })
  revalidatePath(`/events/${booking.event_id}`)
  return { success: true }
}
