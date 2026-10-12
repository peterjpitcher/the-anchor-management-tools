import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getSigningPartyById, type SigningPartyContext } from './service'
import type { SigningDocumentRow, SigningPartyRow } from './types'

/**
 * Signing in the staff portal. A signed-in worker sees the documents addressed to their own
 * employee record and no one else's; being signed in is the identity check, so there is no
 * date of birth question here.
 */

export interface PortalWorker {
  userId: string
  employeeId: string
}

/** The signed-in user's own employee record. New starters count: they sign their agreement here. */
export async function getPortalWorker(): Promise<PortalWorker | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('employee_id')
    .eq('auth_user_id', user.id)
    .in('status', ['Onboarding', 'Active', 'Started Separation'])
    .maybeSingle()
  if (error) throw new Error(`Could not read your employee record: ${error.message}`)
  if (!data) return null
  return { userId: user.id, employeeId: data.employee_id as string }
}

export interface PortalSigningItem {
  party: Pick<SigningPartyRow, 'id' | 'status' | 'signed_at' | 'declined_at'>
  document: Pick<SigningDocumentRow, 'id' | 'title' | 'mode' | 'status' | 'sent_at' | 'expires_at' | 'completed_at'>
}

/** Everything addressed to this worker, newest first. */
export async function listPortalSigningItems(employeeId: string): Promise<PortalSigningItem[]> {
  const admin = createAdminClient()
  const { data: parties, error } = await admin
    .from('signing_parties')
    .select('id, document_id, status, signed_at, declined_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Could not read your documents: ${error.message}`)
  const rows = (parties ?? []) as Array<PortalSigningItem['party'] & { document_id: string }>
  if (rows.length === 0) return []

  const { data: documents, error: documentsError } = await admin
    .from('signing_documents')
    .select('id, title, mode, status, sent_at, expires_at, completed_at')
    .in('id', rows.map((row) => row.document_id))
  if (documentsError) throw new Error(`Could not read your documents: ${documentsError.message}`)
  const byId = new Map(((documents ?? []) as PortalSigningItem['document'][]).map((document) => [document.id, document]))

  return rows.flatMap((row) => {
    const document = byId.get(row.document_id)
    return document ? [{ party: { id: row.id, status: row.status, signed_at: row.signed_at, declined_at: row.declined_at }, document }] : []
  })
}

/**
 * A party this worker may act on, or null. Another worker's document, a guardian's or a
 * customer's all come back null, exactly as an unknown id does.
 */
export async function getPortalPartyContext(worker: PortalWorker, partyId: string): Promise<SigningPartyContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(partyId)) return null
  const context = await getSigningPartyById(partyId)
  if (!context || context.party.employee_id !== worker.employeeId || context.party.role !== 'worker') return null
  return context
}
