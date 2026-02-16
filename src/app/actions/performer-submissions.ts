'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { PerformerSubmissionStatus } from '@/types/database'

type ManageContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      user: SupabaseUser
    }

const statusSchema = z.enum([
  'new',
  'shortlisted',
  'contacted',
  'booked',
  'not_a_fit',
  'do_not_contact',
])

const updateSchema = z.object({
  status: statusSchema.optional(),
  internal_notes: z.string().max(5000).nullable().optional(),
})

async function requirePerformerEditContext(): Promise<ManageContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Unauthorized' }
  }

  const canEdit = await checkUserPermission('performers', 'edit', user.id)
  if (!canEdit) {
    return { error: 'Insufficient permissions' }
  }

  return { supabase, user }
}

export async function updatePerformerSubmission(
  id: string,
  updates: unknown,
): Promise<{ success?: true; error?: string }> {
  try {
    const context = await requirePerformerEditContext()
    if ('error' in context) {
      return { error: context.error }
    }

    const parsed = updateSchema.safeParse(updates)
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Invalid update' }
    }

    const { supabase, user } = context
    const updatePayload: Record<string, unknown> = {}

    if (parsed.data.status !== undefined) {
      updatePayload.status = parsed.data.status as PerformerSubmissionStatus
    }

    if (parsed.data.internal_notes !== undefined) {
      updatePayload.internal_notes = parsed.data.internal_notes
    }

    if (Object.keys(updatePayload).length === 0) {
      return { success: true }
    }

    const { data: existing, error: existingError } = await supabase
      .from('performer_submissions')
      .select('id, status, internal_notes')
      .eq('id', id)
      .maybeSingle()

    if (existingError) {
      console.error('Failed to load performer submission before update:', existingError)
      return { error: 'Failed to update submission' }
    }

    const { data: updatedSubmission, error } = await supabase
      .from('performer_submissions')
      .update(updatePayload)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Failed to update performer submission:', error)
      return { error: 'Failed to update submission' }
    }

    if (!updatedSubmission) {
      return { error: 'Submission not found' }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'performer_submission',
      resource_id: id,
      operation_status: 'success',
      old_values: existing
        ? {
            status: existing.status,
            internal_notes: existing.internal_notes,
          }
        : undefined,
      new_values: updatePayload as Record<string, any>,
    })

    revalidatePath('/performers')
    revalidatePath(`/performers/${id}`)

    return { success: true }
  } catch (error) {
    console.error('Unexpected error updating performer submission:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}
