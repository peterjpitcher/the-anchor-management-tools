'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  completeReceiptUpload,
  createReceiptUploadUrl,
} from '@/app/actions/receipts'
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

export async function uploadReceiptFile({
  supabase,
  transactionId,
  file,
}: UploadReceiptFileInput): Promise<{ success?: boolean; error?: string; receipt?: ReceiptFile }> {
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

  return completeReceiptUpload({
    transactionId,
    storagePath: signedUpload.path,
    fileName: signedUpload.friendlyName,
    fileType: file.type,
    fileSize: file.size,
  }) as Promise<{ success?: boolean; error?: string; receipt?: ReceiptFile }>
}

export function receiptUploadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  const tooLarge = (message.includes('body') && message.includes('limit')) || message.includes('too large') || message.includes('413')
  return tooLarge ? `File is too large. Please keep receipts under ${RECEIPT_FILE_UPLOAD_LIMIT_LABEL}.` : 'Upload failed'
}
