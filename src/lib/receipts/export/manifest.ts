/**
 * What goes into the quarterly receipts pack, worked out once.
 *
 * The pack used to be built from one unpaged read (silently cut at 1,000 payments), and a file
 * that failed to download was skipped with a console warning, so the accountant received a pack
 * with a hole in it and nothing to say so. The pack is now built from a manifest: the payments
 * and files it will ship, read in pages. Every file is either in the pack or named in
 * MISSING_FILES.txt, and MANIFEST.csv lists the lot.
 *
 * Pure: nothing here reads or writes.
 */

import { formatDateTimeInLondon } from '@/lib/dateUtils'
import type { ReceiptFile, ReceiptTransaction } from '@/types/database'
import { buildCsvBuffer, escapeCsvCell, formatCurrency, formatDateDdMmYyyy } from './csv-helpers'
import { buildReceiptFileName } from './receipt-file-name'

export type ExportPayment = ReceiptTransaction & {
  receipt_files?: ReceiptFile[] | null
}

export type ManifestFile = {
  transactionId: string
  fileId: string
  storagePath: string
  /** Where the file sits in the ZIP. */
  zipPath: string
  fileName: string
  source: 'upload' | 'invoice'
  /** Other payments in this pack that carry a file with the same bytes. */
  sharedWith: number
  payment: ExportPayment
}

export type ExportManifest = {
  payments: ExportPayment[]
  files: ManifestFile[]
}

export type MissingFile = {
  file: ManifestFile
  reason: string
}

function filesOf(payment: ExportPayment): ReceiptFile[] {
  return payment.receipt_files ?? []
}

/** Every payment and file the pack will ship, in the order they were read. */
export function buildExportManifest(payments: ExportPayment[]): ExportManifest {
  // How many payments each set of bytes is attached to, for the "shared" column. Invoice copies
  // are left out: one invoice on several payments is expected, and each is its own render.
  const paymentsByHash = new Map<string, Set<string>>()
  for (const payment of payments) {
    for (const file of filesOf(payment)) {
      if (!file.content_hash || file.source === 'invoice') continue
      const set = paymentsByHash.get(file.content_hash) ?? new Set<string>()
      set.add(payment.id)
      paymentsByHash.set(file.content_hash, set)
    }
  }

  const files: ManifestFile[] = []
  for (const payment of payments) {
    filesOf(payment).forEach((file, index) => {
      const shared = file.content_hash && file.source !== 'invoice' ? paymentsByHash.get(file.content_hash) : undefined
      files.push({
        transactionId: payment.id,
        fileId: file.id,
        storagePath: file.storage_path,
        zipPath: buildReceiptFileName(payment, file, index),
        fileName: file.file_name,
        source: file.source === 'invoice' ? 'invoice' : 'upload',
        sharedWith: shared ? Math.max(0, shared.size - 1) : 0,
        payment,
      })
    })
  }

  return { payments, files }
}

/**
 * A fingerprint of what the manifest holds: every payment and file id. Read again before the
 * pack is finished; if it differs, the quarter changed while the pack was being built.
 */
export function manifestFingerprint(
  payments: ReadonlyArray<{ id: string; receipt_files?: ReadonlyArray<{ id: string }> | null }>
): string {
  return payments
    .map((payment) => `${payment.id}:${[...(payment.receipt_files ?? [])].map((file) => file.id).sort().join(',')}`)
    .sort()
    .join('|')
}

function friendlySource(source: string | null | undefined): string {
  switch (source) {
    case 'ai':
      return 'AI'
    case 'ai_accepted':
      return 'AI, accepted'
    case 'manual':
      return 'Manual'
    case 'rule':
      return 'Rule'
    case 'import':
      return 'Import'
    case 'invoice':
      return 'Invoice'
    default:
      return ''
  }
}

function friendlyStatus(status: ReceiptTransaction['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'auto_completed':
      return 'Auto completed'
    case 'no_receipt_required':
      return 'No receipt required'
    case 'cant_find':
      return "Can't find"
    default:
      return 'Pending'
  }
}

function oneLine(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function money(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : ''
}

function stamp(now: Date): string {
  return formatDateTimeInLondon(now, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function categoryOf(payment: ExportPayment): string {
  if (payment.expense_category) return payment.expense_category
  return payment.no_category_applies ? 'No category applies' : ''
}

/** The summary CSV: totals, then one row per payment. */
export function buildReceiptsSummaryCsv(
  manifest: ExportManifest,
  period: { year: number; quarter: number },
  options: { now?: Date; missing?: MissingFile[] } = {}
): Buffer {
  const payments = manifest.payments
  const counts: Record<ReceiptTransaction['status'], number> = {
    pending: 0,
    completed: 0,
    auto_completed: 0,
    no_receipt_required: 0,
    cant_find: 0,
  }
  for (const payment of payments) counts[payment.status] += 1

  const totalIn = payments.reduce((sum, payment) => sum + (payment.amount_in ?? 0), 0)
  const totalOut = payments.reduce((sum, payment) => sum + (payment.amount_out ?? 0), 0)
  const completedWithoutReceipt = payments.filter(
    (payment) => payment.status === 'completed' && filesOf(payment).length === 0
  ).length
  const missingIds = new Set((options.missing ?? []).map((entry) => entry.file.fileId))

  const summaryRows: string[][] = [
    ['Quarter', `Q${period.quarter} ${period.year}`],
    ['Generated at (London time)', stamp(options.now ?? new Date())],
    ['Total transactions', String(payments.length)],
    ['Total in (GBP)', formatCurrency(totalIn)],
    ['Total out (GBP)', formatCurrency(totalOut)],
    ['Completed', String(counts.completed)],
    ['Completed without a receipt', String(completedWithoutReceipt)],
    ['Auto-completed', String(counts.auto_completed)],
    ['No receipt required', String(counts.no_receipt_required)],
    ["Can't find", String(counts.cant_find)],
    ['Pending', String(counts.pending)],
    ['Receipt files in this pack', String(manifest.files.length - missingIds.size)],
    ['Receipt files missing from this pack', String(missingIds.size)],
    [],
  ]

  const headerRow = [
    'Date',
    'Details',
    'Transaction type',
    'Vendor',
    'Vendor source',
    'Expense category',
    'Expense category source',
    'AI confidence',
    'Amount in (GBP)',
    'Amount out (GBP)',
    'Status',
    'Has receipt',
    'Receipt files',
    'Completed reason',
    'Notes',
    'Source',
    'Cardholder',
  ]

  const dataRows = payments.map((payment) => {
    const files = filesOf(payment)
    return [
      formatDateDdMmYyyy(payment.transaction_date),
      escapeCsvCell(payment.details ?? ''),
      escapeCsvCell(payment.transaction_type ?? ''),
      escapeCsvCell(payment.vendor_name ?? ''),
      friendlySource(payment.vendor_source),
      escapeCsvCell(categoryOf(payment)),
      friendlySource(payment.expense_category_source),
      payment.ai_confidence != null ? String(payment.ai_confidence) : '',
      money(payment.amount_in),
      money(payment.amount_out),
      friendlyStatus(payment.status),
      files.length > 0 ? 'Yes' : 'No',
      escapeCsvCell(files.map((file) => file.file_name).join('; ')),
      escapeCsvCell(oneLine(payment.completed_reason)),
      escapeCsvCell(oneLine(payment.notes)),
      payment.source_type === 'amex' ? 'Amex' : 'Bank',
      escapeCsvCell(payment.card_member ?? ''),
    ]
  })

  return buildCsvBuffer([...summaryRows, headerRow, ...dataRows])
}

/** MANIFEST.csv: one row per file the pack should hold, and whether it does. */
export function buildManifestCsv(
  manifest: ExportManifest,
  period: { year: number; quarter: number },
  options: { now?: Date; missing?: MissingFile[] } = {}
): Buffer {
  const missingReason = new Map((options.missing ?? []).map((entry) => [entry.file.fileId, entry.reason]))

  const head: string[][] = [
    ['Quarter', `Q${period.quarter} ${period.year}`],
    ['Generated at (London time)', stamp(options.now ?? new Date())],
    ['Transactions', String(manifest.payments.length)],
    ['Files listed', String(manifest.files.length)],
    ['Files in this pack', String(manifest.files.length - missingReason.size)],
    ['Files missing', String(missingReason.size)],
    [],
    [
      'File in pack',
      'In pack',
      'Why not',
      'Kind',
      'Original name',
      'Date',
      'Details',
      'Vendor',
      'Amount in (GBP)',
      'Amount out (GBP)',
      'Also on other transactions',
      'Transaction reference',
    ],
  ]

  const rows = manifest.files.map((file) => {
    const reason = missingReason.get(file.fileId)
    return [
      escapeCsvCell(file.zipPath),
      reason ? 'No' : 'Yes',
      escapeCsvCell(reason ?? ''),
      file.source === 'invoice' ? 'Invoice copy' : 'Receipt',
      escapeCsvCell(file.fileName),
      formatDateDdMmYyyy(file.payment.transaction_date),
      escapeCsvCell(file.payment.details ?? ''),
      escapeCsvCell(file.payment.vendor_name ?? ''),
      money(file.payment.amount_in),
      money(file.payment.amount_out),
      file.sharedWith > 0 ? String(file.sharedWith) : '',
      file.transactionId,
    ]
  })

  return buildCsvBuffer([...head, ...rows])
}

/** MISSING_FILES.txt: in plain words, what the pack does not hold and why. */
export function buildMissingFilesText(missing: MissingFile[], period: { year: number; quarter: number }): string {
  const lines = [
    `Receipts pack for Q${period.quarter} ${period.year}: ${missing.length} file${missing.length === 1 ? '' : 's'} could not be included.`,
    '',
    'Each transaction below is recorded as having this file, but the file could not be read from storage',
    'when the pack was built. Download the pack again; if a file is still missing, attach it again.',
    '',
  ]
  for (const entry of missing) {
    const payment = entry.file.payment
    const amount = payment.amount_out ?? payment.amount_in ?? 0
    lines.push(
      `- ${formatDateDdMmYyyy(payment.transaction_date)}  ${oneLine(payment.details)}  ${formatCurrency(amount)}`,
      `    file: ${entry.file.fileName}`,
      `    why: ${entry.reason}`
    )
  }
  return `${lines.join('\n')}\n`
}
