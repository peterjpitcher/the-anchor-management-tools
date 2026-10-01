'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cancelReceiptUpload,
  completeReceiptUpload,
  createReceiptUploadUrl,
} from '@/app/actions/receipts'
import { ReceiptPhotoError, prepareReceiptFileForUpload } from '@/lib/receipts/heic-convert'
import {
  RECEIPT_BUCKET_NAME,
  RECEIPT_FILE_UPLOAD_LIMIT_LABEL,
} from '@/lib/receipts/upload-constraints'
import type { ReceiptFile } from '@/types/database'

export const RECEIPT_UPLOAD_ACCEPT = '.pdf,application/pdf,image/png,image/jpeg,image/jpg,image/gif,image/webp,image/heic,image/heif'

type UploadReceiptFileInput = {
  supabase: SupabaseClient
  transactionId: string
  file: File
}

/** An upload that has been stored and is waiting for the person to confirm or cancel it. */
export type PendingReceiptUpload = {
  transactionId: string
  storagePath: string
  fileName: string
  fileType: string
  fileSize: number
}

/** The same file is already on these transactions. */
export type DuplicateReceiptWarning = {
  count: number
  payments: Array<{
    transactionId: string
    transactionDate: string
    details: string
    amount: number | null
    fileName: string | null
  }>
}

export type UploadReceiptResult = {
  success?: boolean
  error?: string
  receipt?: ReceiptFile
  /** Nothing was attached: the file is on other transactions. Confirm or cancel `pending`. */
  duplicate?: DuplicateReceiptWarning
  pending?: PendingReceiptUpload
}

function readCompletion(
  result: Awaited<ReturnType<typeof completeReceiptUpload>>,
  pending: PendingReceiptUpload
): UploadReceiptResult {
  const outcome = result as { success?: boolean; error?: string; receipt?: ReceiptFile; duplicate?: DuplicateReceiptWarning }
  if (outcome.duplicate) {
    return { duplicate: outcome.duplicate, pending }
  }
  if (outcome.error || !outcome.receipt) {
    return { error: outcome.error ?? 'Upload failed' }
  }
  return { success: true, receipt: outcome.receipt }
}

export async function uploadReceiptFile({
  supabase,
  transactionId,
  file: chosen,
}: UploadReceiptFileInput): Promise<UploadReceiptResult> {
  // An iPhone photo is turned into a JPEG here, in the browser that can read it.
  let file: File
  try {
    file = await prepareReceiptFileForUpload(chosen)
  } catch (error) {
    if (error instanceof ReceiptPhotoError) return { error: error.userMessage }
    throw error
  }

  const signedUpload = await createReceiptUploadUrl({
    transactionId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  })

  if (signedUpload.error || !signedUpload.path || !signedUpload.token || !signedUpload.friendlyName) {
    return { error: signedUpload.error ?? 'Failed to prepare receipt upload.' }
  }

  const uploadResult = await supabase.storage
    .from(RECEIPT_BUCKET_NAME)
    .uploadToSignedUrl(signedUpload.path, signedUpload.token, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (uploadResult.error) {
    return { error: uploadResult.error.message || 'Failed to upload receipt file.' }
  }

  const pending: PendingReceiptUpload = {
    transactionId,
    storagePath: signedUpload.path,
    fileName: signedUpload.friendlyName,
    fileType: file.type,
    fileSize: file.size,
  }

  return readCompletion(await completeReceiptUpload(pending), pending)
}

/** The person has seen the warning and wants the file attached all the same. */
export async function confirmDuplicateReceiptUpload(pending: PendingReceiptUpload): Promise<UploadReceiptResult> {
  return readCompletion(await completeReceiptUpload({ ...pending, confirmDuplicate: true }), pending)
}

/** The person does not want it attached: the stored file is removed. */
export async function cancelDuplicateReceiptUpload(pending: PendingReceiptUpload): Promise<void> {
  await cancelReceiptUpload({ transactionId: pending.transactionId, storagePath: pending.storagePath })
}

export function receiptUploadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  const tooLarge = (message.includes('body') && message.includes('limit')) || message.includes('too large') || message.includes('413')
  return tooLarge ? `File is too large. Please keep receipts under ${RECEIPT_FILE_UPLOAD_LIMIT_LABEL}.` : 'Upload failed'
}
