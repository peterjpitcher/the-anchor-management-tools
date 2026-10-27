'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guestDetailsEditSchema } from '@/lib/events/guest-details-edit'
import { saveBookingGuestDetails } from '@/lib/events/guest-details-server'

const editSchema = z.object({
  bookingId: z.string().uuid(),
  attendees: guestDetailsEditSchema,
})

/**
 * Staff add or correct each ticket's name and answers (BK-016). A booking taken by phone, at the
 * bar or at the kiosk has no guest rows: this now creates one per ticket, with the event's
 * current questions. A booking made before a question was added gains it, unanswered. Answers
 * never reach the audit row.
 */
export async function updateEventAttendees(input: z.input<typeof editSchema>): Promise<{ success?: boolean; error?: string }> {
  const parsed = editSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Please check the guest details' }
  const session = await createClient()
  const [{ data: { user } }, canManage] = await Promise.all([
    session.auth.getUser(), checkUserPermission('events', 'manage'),
  ])
  if (!user || !canManage) return { error: 'You do not have permission to edit guest details' }

  let result
  try {
    result = await saveBookingGuestDetails(createAdminClient(), parsed.data.bookingId, parsed.data.attendees)
  } catch {
    return { error: 'Guest details could not be loaded' }
  }
  if (!result.ok) return { error: result.error }

  await logAuditEvent({
    user_id: user.id,
    operation_type: 'update',
    resource_type: 'event_booking',
    resource_id: parsed.data.bookingId,
    operation_status: 'success',
    additional_info: {
      field: 'guest_details',
      guest_count: result.guestCount,
      ...(result.created ? { created: true } : {}),
      ...(result.questionsAdded ? { questions_added: result.questionsAdded } : {}),
    },
  })
  revalidatePath(`/events/${result.eventId}`)
  return { success: true }
}
