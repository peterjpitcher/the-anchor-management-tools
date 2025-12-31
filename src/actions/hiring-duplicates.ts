'use server'

import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getDuplicateReviewQueue } from '@/lib/hiring/duplicates'

const ResolveSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(['resolved', 'ignored']),
  note: z.string().max(500).optional(),
})

export async function fetchDuplicateReviewQueueAction() {
  const allowed = await checkUserPermission('hiring', 'view')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const items = await getDuplicateReviewQueue()
    return { success: true, data: items }
  } catch (error: any) {
    console.error('Failed to fetch duplicate queue:', error)
    return { success: false, error: error.message || 'Failed to fetch duplicate queue' }
  }
}

export async function resolveDuplicateReviewAction(input: { eventId: string; status: 'resolved' | 'ignored'; note?: string }) {
  const allowed = await checkUserPermission('hiring', 'edit')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = ResolveSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: existing, error } = await admin
      .from('hiring_candidate_events')
      .select('metadata')
      .eq('id', parse.data.eventId)
      .single()

    if (error || !existing) {
      return { success: false, error: 'Duplicate review item not found' }
    }

    const metadata = {
      ...(existing.metadata || {}),
      review_status: parse.data.status,
      review_note: parse.data.note?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id || null,
    }

    const { error: updateError } = await admin
      .from('hiring_candidate_events')
      .update({ metadata })
      .eq('id', parse.data.eventId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Failed to resolve duplicate review:', error)
    return { success: false, error: error.message || 'Failed to update duplicate review' }
  }
}
