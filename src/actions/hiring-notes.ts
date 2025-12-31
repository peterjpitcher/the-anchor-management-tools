'use server'

import { z } from 'zod'
import type { HiringNoteWithAuthor } from '@/lib/hiring/notes'

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const NoteSchema = z.object({
  entityType: z.enum(['candidate', 'application']),
  entityId: z.string().uuid(),
  content: z.string().min(1, 'Note is required').max(2000, 'Notes are limited to 2000 characters'),
})

export async function addHiringNoteAction(input: { entityType: 'candidate' | 'application'; entityId: string; content: string }) {
  const allowed = await checkUserPermission('hiring', 'edit')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = NoteSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const { data: inserted, error } = await admin
      .from('hiring_notes')
      .insert({
        entity_type: parse.data.entityType,
        entity_id: parse.data.entityId,
        content: parse.data.content.trim(),
        author_id: user.id,
        is_private: true,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      return { success: false, error: error?.message || 'Failed to save note' }
    }

    const { data: note, error: noteError } = await admin
      .from('hiring_notes')
      .select('*, author:profiles(first_name, last_name, email)')
      .eq('id', inserted.id)
      .single()

    if (noteError || !note) {
      return { success: false, error: noteError?.message || 'Failed to load note' }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'note_added',
      resource_type: `hiring_${parse.data.entityType}`,
      resource_id: parse.data.entityId,
      operation_status: 'success',
      additional_info: { note_id: inserted.id },
    })

    return { success: true, data: note as unknown as HiringNoteWithAuthor }
  } catch (error: any) {
    console.error('Failed to add hiring note:', error)
    return { success: false, error: error.message || 'Failed to save note' }
  }
}
