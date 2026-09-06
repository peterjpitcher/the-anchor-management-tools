'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client'
import {
  confirmMaintenancePhotoUpload,
  requestMaintenancePhotoUpload,
  type MaintenancePhotoView,
} from '@/app/actions/maintenance-photos'
import {
  MAINTENANCE_PHOTO_BUCKET,
  MaintenancePhotoError,
  maintenancePhotoErrorMessage,
  normaliseMaintenancePhoto,
  type NormalisedMaintenancePhoto,
} from '@/lib/maintenance/photo-normalise'

/**
 * The three steps of an upload, in order, with the failure of each one handled.
 *
 * The bytes go browser-direct to storage on a signed URL. They never pass through
 * a server action, because Vercel rejects request bodies over about 4.49MB at the
 * proxy before the function is invoked, which an ordinary phone photo exceeds.
 */

export type MaintenancePhotoUploadStage =
  | 'preparing'
  | 'uploading'
  | 'saving'
  | 'done'
  | 'failed'

export interface MaintenancePhotoUploadDeps {
  normalise: typeof normaliseMaintenancePhoto
  requestUpload: typeof requestMaintenancePhotoUpload
  confirmUpload: typeof confirmMaintenancePhotoUpload
  getSupabase: () => SupabaseClient
  wait: (ms: number) => Promise<void>
}

export const defaultMaintenancePhotoUploadDeps: MaintenancePhotoUploadDeps = {
  normalise: normaliseMaintenancePhoto,
  requestUpload: requestMaintenancePhotoUpload,
  confirmUpload: confirmMaintenancePhotoUpload,
  getSupabase: () => createBrowserSupabaseClient() as unknown as SupabaseClient,
  wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface UploadMaintenancePhotoInput {
  itemId: string
  file: File
  caption?: string
  onStage?: (stage: MaintenancePhotoUploadStage) => void
}

export type UploadMaintenancePhotoResult =
  | { error: string }
  | { photo: MaintenancePhotoView }

const UPLOAD_FAILED = 'That photo could not be uploaded. Please try again.'
const CONFIRM_LOST =
  'The photo uploaded but saving it did not finish. Please try again in a moment.'

/** Confirm is idempotent, so retrying a lost confirm promotes the same row. */
const CONFIRM_ATTEMPTS = 3
const CONFIRM_RETRY_MS = 400

export async function uploadMaintenancePhoto(
  { itemId, file, caption, onStage }: UploadMaintenancePhotoInput,
  deps: MaintenancePhotoUploadDeps = defaultMaintenancePhotoUploadDeps
): Promise<UploadMaintenancePhotoResult> {
  let normalised: NormalisedMaintenancePhoto

  onStage?.('preparing')

  try {
    normalised = await deps.normalise(file)
  } catch (error) {
    // The browser could not decode the file. Plain English, never a codec error.
    if (!(error instanceof MaintenancePhotoError)) {
      console.error('[maintenance-photos] normalisation failed:', error)
    }
    onStage?.('failed')
    return { error: maintenancePhotoErrorMessage(error) }
  }

  const requested = await deps.requestUpload({
    itemId,
    fileName: normalised.originalFileName,
    mimeType: normalised.mimeType,
    sizeBytes: normalised.byteSize,
    width: normalised.width,
    height: normalised.height,
    caption,
  })

  if ('error' in requested) {
    onStage?.('failed')
    return { error: requested.error }
  }

  onStage?.('uploading')

  const supabase = deps.getSupabase()
  const upload = await supabase.storage
    .from(MAINTENANCE_PHOTO_BUCKET)
    .uploadToSignedUrl(requested.path, requested.token, normalised.file, {
      upsert: false,
      contentType: normalised.mimeType,
    })

  if (upload.error) {
    // The pending row stays behind and the 24 hour cleanup pass retires it.
    console.error('[maintenance-photos] signed upload failed:', upload.error)
    onStage?.('failed')
    return { error: UPLOAD_FAILED }
  }

  onStage?.('saving')

  let lastError = CONFIRM_LOST

  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
    let confirmed: Awaited<ReturnType<typeof confirmMaintenancePhotoUpload>>

    try {
      confirmed = await deps.confirmUpload({ itemId, storagePath: requested.path })
    } catch (error) {
      // A lost confirm, typically the connection dropping. Retrying is safe
      // because confirm is idempotent on the storage path.
      console.error('[maintenance-photos] confirm attempt failed:', error)
      if (attempt < CONFIRM_ATTEMPTS) {
        await deps.wait(CONFIRM_RETRY_MS * attempt)
        continue
      }
      onStage?.('failed')
      return { error: CONFIRM_LOST }
    }

    if ('success' in confirmed) {
      onStage?.('done')
      return { photo: confirmed.photo }
    }

    lastError = confirmed.error
    // A rejection is a settled answer, not a transient one, so it is not retried.
    break
  }

  onStage?.('failed')
  return { error: lastError }
}
