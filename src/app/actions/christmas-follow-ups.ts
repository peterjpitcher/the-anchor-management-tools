'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { recordChristmasLeadCalled } from '@/lib/table-bookings/christmas-follow-up-list'

/**
 * "Mark called" on the Christmas follow-ups tab (Christmas funnel spec, owner decision 7). Same
 * permission as ticking off a guest on the awaiting-confirmation call list: table_bookings edit.
 */

const MarkCalledSchema = z.object({
  leadId: z.string().uuid(),
  note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional(),
})

export async function markChristmasLeadCalled(
  input: { leadId: string; note?: string },
): Promise<{ success?: boolean; error?: string }> {
  if (!(await checkUserPermission('table_bookings', 'edit'))) {
    return { error: 'You do not have permission to update Christmas follow-ups.' }
  }

  const parsed = MarkCalledSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the details.' }

  const authSupabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await authSupabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized' }

  const note = parsed.data.note ? parsed.data.note : null

  try {
    const found = await recordChristmasLeadCalled(createAdminClient(), {
      leadId: parsed.data.leadId,
      userId: user.id,
      note,
    })
    if (!found) return { error: 'That follow-up no longer exists.' }
  } catch (error) {
    logger.error('Christmas follow-up could not be marked as called', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { leadId: parsed.data.leadId },
    })
    return { error: 'That was not saved. Try again.' }
  }

  // Ids only in the audit row: the note may name the guest.
  await logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'christmas_lead.called',
    resource_type: 'table_booking_lead',
    resource_id: parsed.data.leadId,
    operation_status: 'success',
    additional_info: { has_note: note !== null },
  })

  revalidatePath('/table-bookings/christmas-follow-ups')
  return { success: true }
}
