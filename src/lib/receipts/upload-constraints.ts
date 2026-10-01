export const RECEIPT_BUCKET_NAME = 'receipts'

// A statement is sent through a server action, and the platform refuses any request body over
// about 4.5 MB before the action runs. A higher limit here could never be reached, so the
// message would have promised something the upload cannot do. The largest statement so far is
// a few kilobytes.
export const MAX_RECEIPT_STATEMENT_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_RECEIPT_FILE_UPLOAD_BYTES = 50 * 1024 * 1024

export const RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL = '4 MB'
export const RECEIPT_FILE_UPLOAD_LIMIT_LABEL = '50 MB'

const ALLOWED_RECEIPT_MIME_TYPES = [
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
