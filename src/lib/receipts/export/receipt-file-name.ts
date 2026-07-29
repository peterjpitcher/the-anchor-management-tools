import type { ReceiptFile, ReceiptTransaction } from '@/types/database'

export function buildReceiptFileName(
  transaction: ReceiptTransaction,
  file: ReceiptFile,
  index: number
): string {
  const guid = sanitizePathSegment(
    file.id ?? `${transaction.id ?? 'transaction'}-${index + 1}`,
    `file-${index + 1}`
  )
  const date = transaction.transaction_date.slice(0, 10)
  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const vendor = sanitizeFilenameSegment(transaction.vendor_name ?? '', 'Unknown Vendor').slice(0, 80)
  const extension = getExtension(file.file_name)
  const fileName = `${date} - £${amount.toFixed(2)} - ${vendor} - ${guid}.${extension}`

  return `receipts/${sanitizeZipFilename(fileName, `${guid}.${extension}`)}`
}

function getExtension(fileName: string): string {
  const match = fileName.trim().match(/\.([A-Za-z0-9]{1,10})$/)
  return match?.[1].toLowerCase() ?? 'pdf'
}

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
}

function sanitizeZipFilename(value: string, fallback: string): string {
  return sanitizeFilenameSegment(value, fallback)
}

function sanitizePathSegment(value: string, fallback: string): string {
  let cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+/g, '.')
    .trim()

  cleaned = cleaned.replace(/^\.+/, '').replace(/\.+$/, '')

  return cleaned || fallback
}
