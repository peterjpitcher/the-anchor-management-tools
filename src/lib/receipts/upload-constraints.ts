export const RECEIPT_BUCKET_NAME = 'receipts'

export const MAX_RECEIPT_STATEMENT_UPLOAD_BYTES = 15 * 1024 * 1024
export const MAX_RECEIPT_FILE_UPLOAD_BYTES = 50 * 1024 * 1024

export const RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL = '15 MB'
export const RECEIPT_FILE_UPLOAD_LIMIT_LABEL = '50 MB'

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

export function isAllowedReceiptMimeType(fileType: string): boolean {
  return ALLOWED_RECEIPT_MIME_TYPES.includes(fileType as (typeof ALLOWED_RECEIPT_MIME_TYPES)[number])
}
