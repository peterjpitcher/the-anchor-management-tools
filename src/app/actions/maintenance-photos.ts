'use server'

/**
 * Maintenance photo pipeline: request a signed upload URL, the browser uploads
 * straight to storage, then confirm.
 *
 * The bytes never traverse a serverless function, deliberately. Vercel rejects
 * request bodies over about 4.49MB at the proxy, before the function is invoked,
 * so a server action that received file bytes would fail on an ordinary phone
 * photo and no amount of server-side resizing could rescue it. The same pattern
 * is already proven here by receipts, event image variants, employee attachments
 * and right-to-work documents.
 *
 * No code path here decodes HEIC. The browser normalises to JPEG before upload
 * (see src/lib/maintenance/photo-normalise.ts) and the magic-byte gate below
 * refuses anything that is not JPEG, PNG or WebP, so sharp is never handed HEIC.
 *
 * Access is super-admin only at every layer, matching the RLS in
 * 20260906080646_maintenance_tracker.sql.
 */

import { randomUUID } from 'crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'
import {
  MAINTENANCE_PHOTO_BUCKET,
  MAINTENANCE_PHOTO_MAX_BYTES,
  MAINTENANCE_PHOTO_MIME_TYPES,
  type MaintenancePhotoMimeType,
} from '@/lib/maintenance/photo-normalise'
import {
  isDisplayableMaintenancePhoto,
  mapMaintenancePhoto,
  type MaintenancePhoto,
  type MaintenancePhotoRow,
} from '@/types/maintenance'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** A ready photo plus a short-lived signed URL. The URL is never persisted. */
export type MaintenancePhotoView = MaintenancePhoto & {
  signedUrl: string
  /** ISO timestamp. The client refreshes before this, it is not stored anywhere. */
  signedUrlExpiresAt: string
}

export type RequestMaintenancePhotoUploadResult =
  | { error: string }
  | { photoId: string; path: string; token: string }

export type ConfirmMaintenancePhotoUploadResult =
  | { error: string }
  | { success: true; photo: MaintenancePhotoView }

export type ListMaintenancePhotosResult =
  | { error: string }
  | { photos: MaintenancePhotoView[] }

export type CleanupMaintenancePhotoUploadsResult =
  | { error: string }
  | {
      success: true
      correlationId: string
      examined: number
      cleaned: number
      orphanedObjects: number
    }

const SIGNED_URL_TTL_SECONDS = 60 * 60
const STALE_PENDING_HOURS = 24
const PHOTO_COLUMNS =
  'id, item_id, storage_path, file_name, mime_type, file_size_bytes, width, height, caption, taken_on, state, uploaded_by, uploaded_by_email, uploaded_at, redacted_at, redacted_by, redacted_by_email, redaction_reason'

const DENIED = 'You do not have permission to manage maintenance photos.'
const PREPARE_FAILED = 'The upload could not be prepared. Please try again.'
const CONFIRM_FAILED = 'The photo was uploaded but could not be saved. Please try again.'
const REJECTED_NOT_AN_IMAGE =
  'That file is not a JPEG, PNG or WebP image, so it has not been kept.'
const REJECTED_UNREADABLE =
  'That photo could not be read once uploaded, so it has not been kept. Please try a different photo.'
const REJECTED_TOO_LARGE = 'That photo is too large, so it has not been kept.'

// ---------------------------------------------------------------------------
// Access. Super-admin only, checked on every entry point including confirm, so a
// permission lost mid-upload is refused rather than completed.
// ---------------------------------------------------------------------------

type Actor = { userId: string; email: string }

async function currentSuperAdmin(): Promise<Actor | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) return null

    const admin = createAdminClient()
    const { data, error: rpcError } = await admin.rpc('is_super_admin', {
      check_user_id: user.id,
    })

    if (!rpcError && typeof data === 'boolean') {
      return data ? { userId: user.id, email: user.email ?? '' } : null
    }

    // Fallback for an environment where the RPC is unavailable. Same answer,
    // read straight from the role rows.
    const { data: roles, error: rolesError } = await admin
      .from('user_roles')
      .select('roles!inner(name)')
      .eq('user_id', user.id)

    if (rolesError || !roles) return null

    const isSuperAdmin = (roles as Array<{ roles?: { name?: string } | null }>).some(
      (row) => row.roles?.name === 'super_admin'
    )

    return isSuperAdmin ? { userId: user.id, email: user.email ?? '' } : null
  } catch (error) {
    console.error('[maintenance-photos] super-admin check failed:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Storage path. Built server-side and never taken from the client.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function extensionFor(mimeType: MaintenancePhotoMimeType): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

function buildStoragePath(itemId: string, mimeType: MaintenancePhotoMimeType): string {
  return `${itemId}/${randomUUID()}.${extensionFor(mimeType)}`
}

/**
 * A client-supplied path is never trusted. It must sit under this item's prefix
 * and look exactly like a path we would have minted, so a caller cannot reach an
 * object belonging to another item or anywhere else in the bucket.
 */
function isPathOwnedByItem(storagePath: string, itemId: string): boolean {
  if (typeof storagePath !== 'string' || storagePath.length === 0) return false
  if (storagePath.includes('..')) return false

  const segments = storagePath.split('/')
  if (segments.length !== 2) return false

  const [prefix, fileName] = segments
  if (prefix !== itemId) return false

  const match = /^([0-9a-fA-F-]{36})\.(jpg|png|webp)$/.exec(fileName)
  if (!match) return false

  return UUID_PATTERN.test(match[1])
}

// ---------------------------------------------------------------------------
// Magic bytes. The label the browser put on the upload is not evidence.
// ---------------------------------------------------------------------------

function sniffImageMimeType(bytes: Uint8Array): MaintenancePhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp'
  }

  return null
}

type VerifiedImage = {
  mimeType: MaintenancePhotoMimeType
  width: number
  height: number
  byteSize: number
}

/**
 * Verify the stored object: magic bytes first, then a real decode for the
 * dimensions. sharp only ever sees bytes the magic-byte gate has already proved
 * to be JPEG, PNG or WebP, so HEIC never reaches it.
 */
async function verifyStoredImage(buffer: Buffer): Promise<VerifiedImage | { rejection: string }> {
  if (buffer.length === 0) return { rejection: REJECTED_UNREADABLE }
  if (buffer.length > MAINTENANCE_PHOTO_MAX_BYTES) return { rejection: REJECTED_TOO_LARGE }

  const sniffed = sniffImageMimeType(buffer)
  if (!sniffed) return { rejection: REJECTED_NOT_AN_IMAGE }

  try {
    // Dynamic import: sharp is a native module and is only needed on this path.
    const sharp = (await import('sharp')).default
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata()

    const format = metadata.format === 'jpg' ? 'jpeg' : metadata.format
    if (`image/${format}` !== sniffed) {
      return { rejection: REJECTED_NOT_AN_IMAGE }
    }

    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (width <= 0 || height <= 0) {
      return { rejection: REJECTED_UNREADABLE }
    }

    // Force an actual decode, so a valid header wrapped round rubbish is caught
    // rather than trusted on its metadata alone.
    await sharp(buffer, { failOn: 'error' }).resize(8, 8, { fit: 'inside' }).raw().toBuffer()

    return { mimeType: sniffed, width, height, byteSize: buffer.length }
  } catch (error) {
    console.error('[maintenance-photos] stored object failed verification:', error)
    return { rejection: REJECTED_UNREADABLE }
  }
}

// ---------------------------------------------------------------------------
// Request an upload
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  itemId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(MAINTENANCE_PHOTO_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAINTENANCE_PHOTO_MAX_BYTES),
  width: z.number().int().positive().max(100000),
  height: z.number().int().positive().max(100000),
  caption: z.string().max(500).optional(),
  /** yyyy-mm-dd, already resolved in London by the caller. */
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export type RequestMaintenancePhotoUploadInput = z.input<typeof requestSchema>

export async function requestMaintenancePhotoUpload(
  input: RequestMaintenancePhotoUploadInput
): Promise<RequestMaintenancePhotoUploadResult> {
  try {
    const actor = await currentSuperAdmin()
    if (!actor) return { error: DENIED }

    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'That photo could not be accepted.' }
    }

    const { itemId, fileName, mimeType, sizeBytes, width, height, caption, takenOn } = parsed.data
    const supabase = createAdminClient()

    const { data: item, error: itemError } = await supabase
      .from('maintenance_items')
      .select('id')
      .eq('id', itemId)
      .maybeSingle()

    if (itemError) {
      console.error('[maintenance-photos] could not load item for upload:', itemError)
      return { error: PREPARE_FAILED }
    }
    if (!item) {
      return { error: 'That maintenance item could not be found.' }
    }

    const storagePath = buildStoragePath(itemId, mimeType)

    // The pending row is written before the URL is issued, on purpose. If this
    // insert fails no signed URL ever exists, so no object can be stored, so
    // there is nothing to orphan.
    const { data: inserted, error: insertError } = await supabase
      .from('maintenance_photos')
      .insert({
        item_id: itemId,
        storage_path: storagePath,
        file_name: fileName.slice(0, 255),
        mime_type: mimeType,
        file_size_bytes: sizeBytes,
        width,
        height,
        caption: caption ?? null,
        taken_on: takenOn ?? null,
        state: 'pending',
        uploaded_by: actor.userId,
        uploaded_by_email: actor.email,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[maintenance-photos] pending row insert failed:', insertError)
      return { error: PREPARE_FAILED }
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(MAINTENANCE_PHOTO_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false })

    if (signedError || !signed?.token) {
      console.error('[maintenance-photos] signed upload URL failed:', signedError)
      // No object can exist yet, so the pending row is pure noise. Remove it now
      // rather than leaving it for the 24 hour pass.
      const { error: rollbackError } = await supabase
        .from('maintenance_photos')
        .delete()
        .eq('id', inserted.id)
        .eq('state', 'pending')
      if (rollbackError) {
        console.error('[maintenance-photos] could not remove the pending row:', rollbackError)
      }
      return { error: PREPARE_FAILED }
    }

    return {
      photoId: inserted.id as string,
      path: (signed.path as string | undefined) ?? storagePath,
      token: signed.token as string,
    }
  } catch (error) {
    console.error('[maintenance-photos] unexpected error preparing an upload:', error)
    return { error: PREPARE_FAILED }
  }
}

// ---------------------------------------------------------------------------
// Confirm an upload
// ---------------------------------------------------------------------------

const confirmSchema = z.object({
  itemId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
})

export type ConfirmMaintenancePhotoUploadInput = z.infer<typeof confirmSchema>

export async function confirmMaintenancePhotoUpload(
  input: ConfirmMaintenancePhotoUploadInput
): Promise<ConfirmMaintenancePhotoUploadResult> {
  try {
    // Re-checked here and not only at request time: a permission removed while
    // the browser was uploading must stop the photo being adopted.
    const actor = await currentSuperAdmin()
    if (!actor) return { error: DENIED }

    const parsed = confirmSchema.safeParse(input)
    if (!parsed.success) {
      return { error: CONFIRM_FAILED }
    }

    const { itemId, storagePath } = parsed.data
    if (!isPathOwnedByItem(storagePath, itemId)) {
      console.error('[maintenance-photos] refused a storage path outside the item prefix')
      return { error: CONFIRM_FAILED }
    }

    const supabase = createAdminClient()

    const { data: row, error: rowError } = await supabase
      .from('maintenance_photos')
      .select(PHOTO_COLUMNS)
      .eq('storage_path', storagePath)
      .eq('item_id', itemId)
      .maybeSingle()

    if (rowError) {
      console.error('[maintenance-photos] could not load the pending row:', rowError)
      return { error: CONFIRM_FAILED }
    }
    if (!row) {
      return { error: CONFIRM_FAILED }
    }

    const existing = row as unknown as MaintenancePhotoRow

    // Idempotent. A retried or duplicated confirm promotes nothing a second time,
    // re-downloads nothing and returns the same photo.
    if (existing.state === 'ready') {
      const view = await toPhotoView(existing)
      return view ? { success: true, photo: view } : { error: CONFIRM_FAILED }
    }

    if (existing.state === 'failed') {
      return { error: REJECTED_UNREADABLE }
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(MAINTENANCE_PHOTO_BUCKET)
      .download(storagePath)

    if (downloadError || !blob) {
      console.error('[maintenance-photos] stored object could not be read:', downloadError)
      return { error: CONFIRM_FAILED }
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const verified = await verifyStoredImage(buffer)

    if ('rejection' in verified) {
      await rejectStoredPhoto(supabase, existing, verified.rejection, actor)
      return { error: verified.rejection }
    }

    const { data: promoted, error: promoteError } = await supabase
      .from('maintenance_photos')
      .update({
        state: 'ready',
        mime_type: verified.mimeType,
        file_size_bytes: verified.byteSize,
        width: verified.width,
        height: verified.height,
      })
      .eq('id', existing.id)
      // Only a pending row is promoted, so two confirms racing cannot both win.
      .eq('state', 'pending')
      .select(PHOTO_COLUMNS)
      .maybeSingle()

    if (promoteError) {
      console.error('[maintenance-photos] could not promote the photo:', promoteError)
      return { error: CONFIRM_FAILED }
    }

    // No row came back because the racing confirm promoted it first. Read it and
    // return the same answer rather than reporting a failure.
    const finalRow = (promoted as unknown as MaintenancePhotoRow | null) ?? (await readPhotoRow(supabase, existing.id))
    if (!finalRow || finalRow.state !== 'ready') {
      return { error: CONFIRM_FAILED }
    }

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.email,
      operation_type: 'upload',
      resource_type: 'maintenance_photo',
      resource_id: finalRow.id,
      operation_status: 'success',
      additional_info: {
        item_id: itemId,
        storage_path: storagePath,
        mime_type: verified.mimeType,
        width: verified.width,
        height: verified.height,
        file_size_bytes: verified.byteSize,
      },
    })

    revalidatePath(`/maintenance/${itemId}`)

    const view = await toPhotoView(finalRow)
    return view ? { success: true, photo: view } : { error: CONFIRM_FAILED }
  } catch (error) {
    console.error('[maintenance-photos] unexpected error confirming an upload:', error)
    return { error: CONFIRM_FAILED }
  }
}

// ---------------------------------------------------------------------------
// Rejection: the object goes, the row stays as evidence.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

async function rejectStoredPhoto(
  supabase: AdminClient,
  row: MaintenancePhotoRow,
  reason: string,
  actor: Actor
): Promise<void> {
  const { error: removeError } = await supabase.storage
    .from(MAINTENANCE_PHOTO_BUCKET)
    .remove([row.storage_path])

  if (removeError) {
    // Logged for reconciliation, never retried into a loop. The row leaves the
    // pending state below, so no later pass picks it up again.
    console.error(
      `[maintenance-photos] orphaned object after a rejected upload, correlation ${row.id}:`,
      removeError
    )
  }

  const { error: updateError } = await supabase
    .from('maintenance_photos')
    .update({ state: 'failed' })
    .eq('id', row.id)

  if (updateError) {
    console.error('[maintenance-photos] could not mark the photo failed:', updateError)
  }

  await logAuditEvent({
    user_id: actor.userId,
    user_email: actor.email,
    operation_type: 'upload',
    resource_type: 'maintenance_photo',
    resource_id: row.id,
    operation_status: 'failure',
    error_message: reason,
    additional_info: { item_id: row.item_id, storage_path: row.storage_path },
  })
}

async function readPhotoRow(
  supabase: AdminClient,
  photoId: string
): Promise<MaintenancePhotoRow | null> {
  const { data, error } = await supabase
    .from('maintenance_photos')
    .select(PHOTO_COLUMNS)
    .eq('id', photoId)
    .maybeSingle()

  if (error) {
    console.error('[maintenance-photos] could not re-read the photo:', error)
    return null
  }

  return (data as unknown as MaintenancePhotoRow | null) ?? null
}

// ---------------------------------------------------------------------------
// Signed URLs for display. One hour, issued only after a per-item super-admin
// check, and never persisted.
// ---------------------------------------------------------------------------

async function toPhotoView(row: MaintenancePhotoRow): Promise<MaintenancePhotoView | null> {
  const photo = mapMaintenancePhoto(row)
  if (!isDisplayableMaintenancePhoto(photo)) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(MAINTENANCE_PHOTO_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) {
    console.error('[maintenance-photos] could not sign the photo URL:', error)
    return null
  }

  return {
    ...photo,
    signedUrl: data.signedUrl,
    signedUrlExpiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  }
}

const listSchema = z.object({ itemId: z.string().uuid() })

export async function listMaintenancePhotos(itemId: string): Promise<ListMaintenancePhotosResult> {
  try {
    const actor = await currentSuperAdmin()
    if (!actor) return { error: DENIED }

    const parsed = listSchema.safeParse({ itemId })
    if (!parsed.success) return { error: 'That maintenance item could not be found.' }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('maintenance_photos')
      .select(PHOTO_COLUMNS)
      .eq('item_id', parsed.data.itemId)
      .eq('state', 'ready')
      .is('redacted_at', null)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('[maintenance-photos] could not list photos:', error)
      return { error: 'The photos could not be loaded. Please try again.' }
    }

    const rows = (data ?? []) as unknown as MaintenancePhotoRow[]
    const views = await Promise.all(rows.map((row) => toPhotoView(row)))

    return { photos: views.filter((view): view is MaintenancePhotoView => view !== null) }
  } catch (error) {
    console.error('[maintenance-photos] unexpected error listing photos:', error)
    return { error: 'The photos could not be loaded. Please try again.' }
  }
}

// ---------------------------------------------------------------------------
// Exceptional removal. Spec section 5: a distinct, attributed, super-admin only
// action that deletes the stored bytes and keeps the metadata row marked as
// redacted with who did it, when and why. The row is never deleted, because the
// trail is the whole point, and redaction is never presented as deletion.
// ---------------------------------------------------------------------------

const redactSchema = z.object({
  photoId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
})

export type RedactMaintenancePhotoResult =
  | { error: string }
  | { success: true; photoId: string }

const REDACT_REASON_REQUIRED = 'Please say briefly why this photo is being removed.'
const REDACT_NOT_FOUND = 'That photo could not be found.'
const REDACT_FAILED = 'That photo could not be removed. Please try again.'
const REDACT_HALF_DONE =
  'The photo file was removed but the record could not be updated. Please try again.'

export async function redactMaintenancePhoto(
  photoId: string,
  reason: string
): Promise<RedactMaintenancePhotoResult> {
  try {
    const actor = await currentSuperAdmin()
    if (!actor) return { error: DENIED }

    const parsed = redactSchema.safeParse({ photoId, reason })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      return { error: field === 'reason' ? REDACT_REASON_REQUIRED : REDACT_NOT_FOUND }
    }

    const supabase = createAdminClient()

    const { data, error: rowError } = await supabase
      .from('maintenance_photos')
      .select(PHOTO_COLUMNS)
      .eq('id', parsed.data.photoId)
      .maybeSingle()

    if (rowError) {
      console.error('[maintenance-photos] could not load the photo to redact:', rowError)
      return { error: REDACT_FAILED }
    }

    const row = (data as unknown as MaintenancePhotoRow | null) ?? null
    if (!row) return { error: REDACT_NOT_FOUND }

    // Already redacted. The bytes are gone and the row already names who removed
    // them, so this is a no-op rather than a second redaction that would rewrite
    // the attribution.
    if (row.redacted_at) return { success: true, photoId: row.id }

    // The bytes go first, on purpose. If storage refuses, the row is left exactly
    // as it was, so a record can never claim a redaction that did not happen.
    const { error: removeError } = await supabase.storage
      .from(MAINTENANCE_PHOTO_BUCKET)
      .remove([row.storage_path])

    if (removeError) {
      console.error('[maintenance-photos] could not delete the stored object:', removeError)
      await logAuditEvent({
        user_id: actor.userId,
        user_email: actor.email,
        operation_type: 'redact',
        resource_type: 'maintenance_photo',
        resource_id: row.id,
        operation_status: 'failure',
        error_message: 'the stored object could not be deleted, so the photo was not redacted',
        additional_info: { item_id: row.item_id, storage_path: row.storage_path },
      })
      return { error: REDACT_FAILED }
    }

    const redactedAt = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('maintenance_photos')
      .update({
        redacted_at: redactedAt,
        redacted_by: actor.userId,
        redacted_by_email: actor.email,
        redaction_reason: parsed.data.reason,
      })
      .eq('id', row.id)
      // Only an unredacted row is marked, so two redactions racing cannot both win.
      .is('redacted_at', null)

    if (updateError) {
      // The bytes have gone but the row does not say so yet. Retrying is safe:
      // removing an object that is already absent succeeds, and the update runs
      // again. Logged as a failure so the gap is visible either way.
      console.error('[maintenance-photos] could not mark the photo redacted:', updateError)
      await logAuditEvent({
        user_id: actor.userId,
        user_email: actor.email,
        operation_type: 'redact',
        resource_type: 'maintenance_photo',
        resource_id: row.id,
        operation_status: 'failure',
        error_message: 'the stored object was deleted but the row could not be marked redacted',
        additional_info: { item_id: row.item_id, storage_path: row.storage_path },
      })
      return { error: REDACT_HALF_DONE }
    }

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.email,
      operation_type: 'redact',
      resource_type: 'maintenance_photo',
      resource_id: row.id,
      operation_status: 'success',
      additional_info: {
        item_id: row.item_id,
        storage_path: row.storage_path,
        redacted_at: redactedAt,
        reason: parsed.data.reason,
      },
    })

    revalidatePath(`/maintenance/${row.item_id}`)

    return { success: true, photoId: row.id }
  } catch (error) {
    console.error('[maintenance-photos] unexpected error redacting a photo:', error)
    return { error: REDACT_FAILED }
  }
}

// ---------------------------------------------------------------------------
// Stale pending cleanup. A signed URL that was issued and never used leaves a
// pending row behind; after 24 hours it and any object it points at go.
// ---------------------------------------------------------------------------

async function isCronCaller(): Promise<boolean> {
  try {
    const headerList = await headers()
    const request = new Request('https://maintenance.local/photo-cleanup', {
      headers: new Headers(Array.from(headerList.entries())),
    })
    return authorizeCronRequest(request).authorized
  } catch {
    return false
  }
}

export async function cleanupStaleMaintenancePhotoUploads(): Promise<CleanupMaintenancePhotoUploadsResult> {
  const correlationId = randomUUID()

  try {
    const authorised = (await isCronCaller()) || (await currentSuperAdmin()) !== null
    if (!authorised) return { error: DENIED }

    const supabase = createAdminClient()
    const cutoff = new Date(Date.now() - STALE_PENDING_HOURS * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('maintenance_photos')
      .select('id, item_id, storage_path')
      .eq('state', 'pending')
      .lt('uploaded_at', cutoff)
      .limit(500)

    if (error) {
      console.error(`[maintenance-photos] cleanup ${correlationId} could not read stale rows:`, error)
      return { error: 'The photo cleanup could not run.' }
    }

    const stale = (data ?? []) as Array<{ id: string; item_id: string; storage_path: string }>
    let cleaned = 0
    let orphanedObjects = 0

    for (const row of stale) {
      const { error: removeError } = await supabase.storage
        .from(MAINTENANCE_PHOTO_BUCKET)
        .remove([row.storage_path])

      if (removeError) {
        // The bytes are still there. Logged for reconciliation with a correlation
        // id, and the row is kept as failed so the orphan stays traceable. It
        // leaves the pending state either way, so this is never retried into a
        // loop.
        orphanedObjects += 1
        console.error(
          `[maintenance-photos] cleanup ${correlationId} could not delete ${row.storage_path} for photo ${row.id}:`,
          removeError
        )

        const { error: retireError } = await supabase
          .from('maintenance_photos')
          .update({ state: 'failed' })
          .eq('id', row.id)
          .eq('state', 'pending')

        if (retireError) {
          console.error(
            `[maintenance-photos] cleanup ${correlationId} could not retire photo ${row.id}:`,
            retireError
          )
        }
        continue
      }

      // The object is gone, so the pending row points at nothing and goes too.
      const { error: deleteError } = await supabase
        .from('maintenance_photos')
        .delete()
        .eq('id', row.id)
        .eq('state', 'pending')

      if (deleteError) {
        console.error(
          `[maintenance-photos] cleanup ${correlationId} could not remove photo ${row.id}:`,
          deleteError
        )
        continue
      }

      cleaned += 1
    }

    return {
      success: true,
      correlationId,
      examined: stale.length,
      cleaned,
      orphanedObjects,
    }
  } catch (error) {
    console.error(`[maintenance-photos] cleanup ${correlationId} failed:`, error)
    return { error: 'The photo cleanup could not run.' }
  }
}
