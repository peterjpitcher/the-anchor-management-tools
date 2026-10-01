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

/**
 * What a stored file is, read from its first bytes. The type the browser declared used to be
 * stored as it was. Null when the bytes are not one of the kinds we accept: the declared type
 * is then kept.
 */
export function sniffReceiptMimeType(bytes: Uint8Array): string | null {
  const at = (index: number) => bytes[index] ?? -1
  const ascii = (start: number, text: string) => [...text].every((char, index) => at(start + index) === char.charCodeAt(0))

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x89 && ascii(1, 'PNG')) return 'image/png'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11)).toLowerCase()
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  // A PDF may have a few stray bytes before its header, so the start of the file is searched.
  const head = Math.min(bytes.length, 1024)
  for (let index = 0; index + 5 <= head; index += 1) {
    if (ascii(index, '%PDF-')) return 'application/pdf'
  }
  return null
}
