/**
 * The daily tidy-up of receipt storage (spec 10.1 item 2).
 *
 * An upload that is started and never finished leaves an open record and, usually, a stored
 * file nothing points at. Nothing swept these, so they stayed for good. This removes uploads
 * abandoned more than a day ago, and reports two things it will not touch:
 *
 *  - stored files that no payment and no open upload refers to;
 *  - payments marked completed with neither a file nor a reason.
 *
 * It never removes a stored file that a payment refers to. The database decides that, under the
 * same lock an upload takes (`release_receipt_upload_intent`).
 *
 * @requires Called by the cron route, which checks the cron secret.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { RECEIPT_BUCKET, type AdminClient } from './types'

const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000
const STORAGE_PAGE = 1000
const SAMPLE_LIMIT = 20
/** Folders in the bucket are years. Anything else at the top level is listed as it is. */
const MAX_FOLDERS = 50

export type ReceiptSweepResult = {
  /** Open uploads older than a day. */
  abandonedUploads: number
  /** Of those, how many were released and their stored file removed. */
  removed: number
  /** Released, but the stored file could not be removed. It is reported as unreferenced next time. */
  removeFailed: number
  /** The path is on a payment after all: left alone. */
  referenced: number
  /** Stored files that no payment and no open upload refers to. Reported, never removed. */
  unreferencedObjects: number
  unreferencedSample: string[]
  /** Payments marked completed with neither a file nor a reason. Reported, never changed. */
  completedWithoutReceipt: number
}

type IntentRow = { id: string; transaction_id: string; storage_path: string; issued_to: string; issued_at: string }

async function listStoredPaths(supabase: AdminClient, olderThan: Date): Promise<string[]> {
  const bucket = supabase.storage.from(RECEIPT_BUCKET)
  const paths: string[] = []

  const listAll = async (prefix: string) => {
    const entries: Array<{ name: string; id: string | null; created_at?: string | null }> = []
    for (let offset = 0; ; offset += STORAGE_PAGE) {
      const { data, error } = await bucket.list(prefix, { limit: STORAGE_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) {
        throw new Error(`Failed to list stored receipts under "${prefix}": ${error.message}`)
      }
      entries.push(...((data ?? []) as typeof entries))
      if (!data || data.length < STORAGE_PAGE) break
    }
    return entries
  }

  const top = await listAll('')
  const folders = top.filter((entry) => entry.id === null).slice(0, MAX_FOLDERS)
  const isOld = (entry: { created_at?: string | null }) => !entry.created_at || new Date(entry.created_at) < olderThan

  for (const entry of top) {
    if (entry.id !== null && isOld(entry)) paths.push(entry.name)
  }
  for (const folder of folders) {
    for (const entry of await listAll(folder.name)) {
      // A file just uploaded may not have its record yet. Only files older than a day count.
      if (entry.id !== null && isOld(entry)) paths.push(`${folder.name}/${entry.name}`)
    }
  }
  return paths
}

export async function performReceiptStorageSweep(now: Date = new Date()): Promise<ReceiptSweepResult> {
  const supabase = createAdminClient()
  const client = supabase as any
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS)

  const result: ReceiptSweepResult = {
    abandonedUploads: 0,
    removed: 0,
    removeFailed: 0,
    referenced: 0,
    unreferencedObjects: 0,
    unreferencedSample: [],
    completedWithoutReceipt: 0,
  }

  // ---- 1. Uploads abandoned more than a day ago ------------------------------------------------
  const abandoned = await fetchAllRows<IntentRow>(
    (from, to) =>
      client
        .from('receipt_upload_intents')
        .select('id, transaction_id, storage_path, issued_to, issued_at')
        .is('completed_at', null)
        .lt('issued_at', cutoff.toISOString())
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'abandoned receipt uploads' }
  )
  result.abandonedUploads = abandoned.length

  for (const intent of abandoned) {
    const { data: released, error: releaseError } = await client.rpc('release_receipt_upload_intent', {
      p_transaction_id: intent.transaction_id,
      p_storage_path: intent.storage_path,
      p_user_id: intent.issued_to,
    })
    if (releaseError) {
      throw new Error(`Failed to release an abandoned upload: ${releaseError.message}`)
    }
    if (released === 'referenced') {
      result.referenced += 1
      continue
    }
    if (released !== 'released') continue

    const { error: removeError } = await supabase.storage.from(RECEIPT_BUCKET).remove([intent.storage_path])
    if (removeError) {
      console.error('[receipts-sweep] released an abandoned upload but could not remove its file', {
        storagePath: intent.storage_path,
        removeError,
      })
      result.removeFailed += 1
    } else {
      result.removed += 1
    }
  }

  // ---- 2. Stored files nothing refers to: reported, never removed -------------------------------
  const [files, openIntents, stored] = await Promise.all([
    fetchAllRows<{ storage_path: string }>(
      (from, to) => client.from('receipt_files').select('storage_path').order('id', { ascending: true }).range(from, to),
      { label: 'receipt file paths' }
    ),
    fetchAllRows<{ storage_path: string }>(
      (from, to) =>
        client
          .from('receipt_upload_intents')
          .select('storage_path')
          .is('completed_at', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'open receipt uploads' }
    ),
    listStoredPaths(supabase, cutoff),
  ])

  const known = new Set<string>([...files.map((file) => file.storage_path), ...openIntents.map((intent) => intent.storage_path)])
  const unreferenced = stored.filter((path) => !known.has(path))
  result.unreferencedObjects = unreferenced.length
  result.unreferencedSample = unreferenced.slice(0, SAMPLE_LIMIT)

  // ---- 3. Completed with neither a file nor a reason: reported, never changed -------------------
  const { data: bare, error: bareError } = await client.rpc('count_receipts_completed_without_receipt')
  if (bareError) {
    throw new Error(`Failed to count completed payments without a receipt: ${bareError.message}`)
  }
  result.completedWithoutReceipt = Number(bare ?? 0)

  return result
}
