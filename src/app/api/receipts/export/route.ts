import { NextRequest, NextResponse } from 'next/server'
import archiver, { type ArchiverError } from 'archiver'
import { PassThrough } from 'stream'
import Papa from 'papaparse'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { receiptQuarterExportSchema } from '@/lib/validation'
import type { ReceiptTransaction, ReceiptFile } from '@/types/database'

export const runtime = 'nodejs'

const RECEIPT_BUCKET = 'receipts'

type ReceiptTransactionRow = ReceiptTransaction & {
  receipt_files?: ReceiptFile[] | null
}

type QuarterRange = { startDate: string; endDate: string }

export async function GET(request: NextRequest) {
  try {
    await checkUserPermission('receipts', 'export')

    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year'))
    const quarter = Number(url.searchParams.get('quarter'))

    const parsed = receiptQuarterExportSchema.safeParse({ year, quarter })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid export parameters'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { startDate, endDate } = deriveQuarterRange(parsed.data.year, parsed.data.quarter)

    const supabase = createAdminClient()
    const { data: transactions, error } = await supabase
      .from('receipt_transactions')
      .select('*, receipt_files(*)')
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })
      .order('details', { ascending: true })

    if (error) {
      console.error('Failed to fetch receipt transactions for export:', error)
      return NextResponse.json({ error: 'Failed to load transactions for export.' }, { status: 500 })
    }

    const rows = (transactions ?? []) as ReceiptTransactionRow[]
    const summaryCsv = await buildSummaryCsv(rows, parsed.data.year, parsed.data.quarter)

    const archive = archiver('zip', { zlib: { level: 9 } })
    const passthrough = new PassThrough()
    archive.pipe(passthrough)
    const chunks: Buffer[] = []

    const archiveFinished = new Promise<void>((resolve, reject) => {
      passthrough.on('data', (chunk) => chunks.push(chunk as Buffer))
      passthrough.on('end', resolve)
      passthrough.on('error', reject)
      archive.on('warning', (warning) => {
        const archiverWarning = warning as ArchiverError
        if (archiverWarning?.code === 'ENOENT') {
          console.warn('Archiver warning:', warning)
          return
        }
        reject(warning)
      })
      archive.on('error', (archiveError) => {
        reject(archiveError)
      })
    })

    archive.append(summaryCsv, {
      name: `Receipts_Q${parsed.data.quarter}_${parsed.data.year}.csv`,
    })

    for (const transaction of rows) {
      const files = transaction.receipt_files ?? []
      if (!files?.length) continue

      for (const [index, file] of files.entries()) {
        const download = await supabase.storage.from(RECEIPT_BUCKET).download(file.storage_path)
        if (download.error || !download.data) {
          console.warn(`Failed to download receipt ${file.storage_path}:`, download.error)
          continue
        }

        const buffer = await normaliseToBuffer(download.data)
        const name = buildReceiptFileName(transaction, file, index)

        archive.append(buffer, { name })
      }
    }

    if (!rows.length) {
      const placeholder = Buffer.from('No transactions found for this quarter.', 'utf-8')
      archive.append(placeholder, { name: 'README.txt' })
    }

    await archive.finalize()
    await archiveFinished

    const zipBuffer = Buffer.concat(chunks)

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="receipts_q${parsed.data.quarter}_${parsed.data.year}.zip"`,
        'Cache-Control': 'no-store',
        'Content-Length': zipBuffer.length.toString(),
      },
    })
  } catch (err) {
    console.error('Receipts export failed:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to generate receipts export.', details: message }, { status: 500 })
  }
}

async function buildSummaryCsv(
  transactions: ReceiptTransactionRow[],
  year: number,
  quarter: number
): Promise<Buffer> {
  const statusCounts: Record<ReceiptTransaction['status'], number> = {
    pending: 0,
    completed: 0,
    auto_completed: 0,
    no_receipt_required: 0,
    cant_find: 0,
  }

  transactions.forEach((tx) => {
    statusCounts[tx.status] += 1
  })

  const totalIn = totalAmount(transactions, 'amount_in')
  const totalOut = totalAmount(transactions, 'amount_out')

  const summaryRows: string[][] = [
    ['Quarter', `Q${quarter} ${year}`],
    ['Generated at', new Date().toISOString()],
    ['Total transactions', String(transactions.length)],
    ['Total in (GBP)', formatCurrency(totalIn)],
    ['Total out (GBP)', formatCurrency(totalOut)],
    ['Completed', String(statusCounts.completed)],
    ['Auto-completed', String(statusCounts.auto_completed)],
    ['No receipt required', String(statusCounts.no_receipt_required)],
    ["Can't find", String(statusCounts.cant_find)],
    ['Pending', String(statusCounts.pending)],
    [],
  ]

  const headerRow = [
    'Date',
    'Details',
    'Transaction type',
    'Vendor',
    'Expense category',
    'Amount in (GBP)',
    'Amount out (GBP)',
    'Status',
    'Notes',
  ]

  const dataRows = transactions.map((tx) => {
    const amountIn = typeof tx.amount_in === 'number' ? tx.amount_in.toFixed(2) : ''
    const amountOut = typeof tx.amount_out === 'number' ? tx.amount_out.toFixed(2) : ''
    const notes = sanitiseMultiline(tx.notes)

    return [
      formatDate(tx.transaction_date),
      tx.details ?? '',
      tx.transaction_type ?? '',
      tx.vendor_name ?? '',
      tx.expense_category ?? '',
      amountIn,
      amountOut,
      friendlyStatus(tx.status),
      notes,
    ]
  })

  const csvRows = [...summaryRows, headerRow, ...dataRows]
  const csv = Papa.unparse(csvRows, { newline: '\n' })
  return Buffer.from(`\ufeff${csv}`, 'utf-8')
}

function sanitiseMultiline(value: string | null): string {
  if (!value) return ''
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function deriveQuarterRange(year: number, quarter: number): QuarterRange {
  const startMonth = (quarter - 1) * 3 + 1
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const endMonth = startMonth + 2
  const endDate = new Date(Date.UTC(year, endMonth, 0))
  const endDateIso = endDate.toISOString().slice(0, 10)

  return { startDate, endDate: endDateIso }
}

function friendlyStatus(status: ReceiptTransaction['status']) {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'auto_completed':
      return 'Auto completed'
    case 'no_receipt_required':
      return 'No receipt req.'
    case 'cant_find':
      return "Can't find"
    default:
      return 'Pending'
  }
}

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function formatCurrency(value: number) {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function totalAmount(transactions: ReceiptTransactionRow[], key: 'amount_in' | 'amount_out') {
  return transactions.reduce((sum, tx) => sum + (tx[key] ?? 0), 0)
}

function buildReceiptFileName(transaction: ReceiptTransaction, file: ReceiptFile, index: number) {
  const uniqueSegment = sanitizePathSegment(file.id ?? `${transaction.id ?? 'transaction'}-${index + 1}`, `file-${index + 1}`)

  const baseName = file.file_name?.trim()
  if (baseName) {
    const safeBase = sanitizeZipFilename(baseName, `${uniqueSegment}.pdf`)
    return `receipts/${uniqueSegment}_${safeBase}`
  }

  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const amountLabel = amount ? amount.toFixed(2) : '0.00'
  const description = sanitizeDescriptionForFilename(transaction.details ?? '').slice(0, 80) || 'Receipt'
  const extension = file.file_name?.split('.').pop()?.toLowerCase() || 'pdf'
  const fallback = `${description}-${amountLabel}.${extension}`
  const safeFallback = sanitizeZipFilename(fallback, `${uniqueSegment}.pdf`)

  return `receipts/${uniqueSegment}_${safeFallback}`
}

async function normaliseToBuffer(data: unknown): Promise<Buffer> {
  if (!data) {
    return Buffer.from('')
  }

  if (Buffer.isBuffer(data)) {
    return data
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data)
  }

  if (typeof (data as any).arrayBuffer === 'function') {
    const arrayBuffer = await (data as Blob).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  return Buffer.from(String(data))
}

function sanitizeDescriptionForFilename(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\s&\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeZipFilename(value: string, fallback = 'receipt.pdf'): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
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
