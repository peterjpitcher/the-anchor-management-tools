import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export type HiringNoteWithAuthor =
  Database['public']['Tables']['hiring_notes']['Row'] & {
    author?: {
      first_name?: string | null
      last_name?: string | null
      email?: string | null
    } | null
  }

export async function getHiringNotes(entityType: 'candidate' | 'application', entityId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('hiring_notes')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to load hiring notes:', error)
    throw new Error('Failed to fetch notes')
  }

  const notes = (data || []) as Database['public']['Tables']['hiring_notes']['Row'][]
  const authorIds = Array.from(
    new Set(
      notes
        .map((note) => note.author_id)
        .filter((authorId): authorId is string => Boolean(authorId))
    )
  )

  if (authorIds.length === 0) {
    return notes.map((note) => ({ ...note, author: null })) as HiringNoteWithAuthor[]
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, first_name, last_name, email')
    .in('id', authorIds)

  if (profilesError) {
    console.warn('Failed to load note authors:', profilesError)
    return notes.map((note) => ({ ...note, author: null })) as HiringNoteWithAuthor[]
  }

  const profileById = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  )

  return notes.map((note) => ({
    ...note,
    author: profileById.get(note.author_id) ?? null,
  })) as HiringNoteWithAuthor[]
}
