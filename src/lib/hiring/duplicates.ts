import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type DuplicateReviewItem = {
  id: string
  candidate_id: string
  application_id?: string | null
  job_id?: string | null
  metadata: any
  created_at: string
  candidate: {
    id: string
    first_name: string
    last_name: string
    email: string
    phone?: string | null
    location?: string | null
  } | null
}

export async function getDuplicateReviewQueue() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hiring_candidate_events')
    .select(`
      id,
      candidate_id,
      application_id,
      job_id,
      metadata,
      created_at,
      candidate:hiring_candidates(
        id,
        first_name,
        last_name,
        email,
        phone,
        location
      )
    `)
    .eq('event_type', 'possible_duplicate')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to load duplicate review queue:', error)
    throw new Error('Failed to fetch duplicate queue')
  }

  const items = (data || []).filter((event) => {
    const status = (event as any)?.metadata?.review_status
    return !status || status === 'open'
  })

  return items as unknown as DuplicateReviewItem[]
}
