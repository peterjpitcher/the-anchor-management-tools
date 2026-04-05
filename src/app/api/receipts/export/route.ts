import { NextRequest, NextResponse } from 'next/server'
import archiver, { type ArchiverError } from 'archiver'
import { PassThrough } from 'stream'
import Papa from 'papaparse'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { receiptQuarterExportSchema } from '@/lib/validation'
import type { ReceiptTransaction, ReceiptFile } from '@/types/database'
import {
  buildMileageCsv,
  buildExpensesCsv,
  buildMgdCsv,
  appendExpenseImages,
  appendClaimSummaryPdf,
} from '@/lib/receipts/export'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Prefixes formula-injection trigger characters (=, +, -, @) with a tab
 * so spreadsheet applications treat the cell as text rather than a formula.
 * Only applied to free-text string columns — numbers and dates are left as-is.
 */
function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value
  if (['=', '+', '-', '@'].includes(value[0])) {
    return '\t' + value
  }
  return value
}

const RECEIPT_BUCKET = 'receipts'
const DOWNLOAD_CONCURRENCY = 4

type ReceiptTransactionRow = ReceiptTransaction & {
  receipt_files?: ReceiptFile[] | null
}

type QuarterRange = { startDate: string; endDate: string }

export async function GET(request: NextRequest) {
  try {
    const canExport = await checkUserPermission('receipts', 'export')
    if (!canExport) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year'))
    const quarter = Number(url.searchParams.get('quarter'))

    const parsed = receiptQuarterExportSchema.safeParse({ year, quarter })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid export parameters'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { startDate, endDate } = deriveQuarterRange(parsed.data.year, parsed.data.quarter)

    // Determine if the user is a super_admin — enhanced bundle includes
    // mileage, expenses, MGD CSVs, expense receipt images, and claim PDF.
    const isSuperAdmin = await checkIsSuperAdmin()

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

    const archive = archiver('zip', { zlib: { level: 1 } })
    const passthrough = new PassThrough()

    archive.on('warning', (warning) => {
      const archiverWarning = warning as ArchiverError
      if (archiverWarning?.code === 'ENOENT') {
        console.warn('Archiver warning:', warning)
        return
      }
      console.error('Archiver warning (non-ENOENT):', warning)
    })
    archive.on('error', (error) => {
      console.error('Receipts export archive error:', error)
    })

    archive.pipe(passthrough)

    // Collect chunks as they arrive to avoid backpressure deadlock
    const chunks: Buffer[] = []
    passthrough.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    const streamDone = new Promise<void>((resolve, reject) => {
      passthrough.on('end', resolve)
      passthrough.on('error', reject)
    })

    // Append summary CSV
    archive.append(summaryCsv, {
      name: `Receipts_Q${parsed.data.quarter}_${parsed.data.year}.csv`,
    })

    // Append receipt files with concurrency limit
    const downloadTasks: Array<() => Promise<void>> = []

    for (const transaction of rows) {
      const files = transaction.receipt_files ?? []
      if (!files?.length) continue

      for (const [index, file] of files.entries()) {
        downloadTasks.push(async () => {
          const download = await supabase.storage.from(RECEIPT_BUCKET).download(file.storage_path)
          if (download.error || !download.data) {
            console.warn(`Failed to download receipt ${file.storage_path}:`, download.error)
            return
          }

          const buffer = await normaliseToBuffer(download.data)
          const name = buildReceiptFileName(transaction, file, index)

          archive.append(buffer, { name })
        })
      }
    }

    await runWithConcurrency(downloadTasks, DOWNLOAD_CONCURRENCY)

    // --- Enhanced bundle for super_admin users ---
    if (isSuperAdmin) {
      const q = parsed.data.quarter as 1 | 2 | 3 | 4
      const y = parsed.data.year

      // Generate mileage, expenses, and MGD CSVs in parallel
      const [mileageResult, expensesResult, mgdResult] = await Promise.all([
        buildMileageCsv(supabase, startDate, endDate, y, q),
        buildExpensesCsv(supabase, startDate, endDate, y, q),
        buildMgdCsv(supabase, y, q),
      ])

      // Append CSVs to archive
      archive.append(mileageResult.csv, {
        name: `Mileage_Q${q}_${y}.csv`,
      })
      archive.append(expensesResult.csv, {
        name: `Expenses_Q${q}_${y}.csv`,
      })
      archive.append(mgdResult.csv, {
        name: mgdResult.fileName,
      })

      // Append expense receipt images using the same IDs from the CSV generation
      // to ensure CSV and images represent the same snapshot of data
      const expenseImageCount = await appendExpenseImages(supabase, expensesResult.summary.expenseIds, archive)

      // Generate and append Claim Summary PDF
      await appendClaimSummaryPdf(archive, {
        year: y,
        quarter: q,
        mileage: mileageResult.summary,
        expenses: expensesResult.summary,
        mgd: mgdResult.summary,
        mgdFileName: mgdResult.fileName,
        hasExpenseImages: expenseImageCount > 0,
      })
    }

    if (!rows.length && !isSuperAdmin) {
      const placeholder = Buffer.from('No transactions found for this quarter.', 'utf-8')
      archive.append(placeholder, { name: 'README.txt' })
    }

    await archive.finalize()
    await streamDone

    const zipBuffer = Buffer.concat(chunks)

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="receipts_q${parsed.data.quarter}_${parsed.data.year}.zip"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(zipBuffer.length),
      },
    })
  } catch (err) {
    console.error('Receipts export failed:', err)
    return NextResponse.json({ error: 'Failed to generate receipts export.' }, { status: 500 })
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
    'Vendor source',
    'Expense category',
    'Expense category source',
    'AI confidence',
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
      escapeCsvCell(tx.details ?? ''),
      escapeCsvCell(tx.transaction_type ?? ''),
      escapeCsvCell(tx.vendor_name ?? ''),
      friendlySource(tx.vendor_source),
      escapeCsvCell(tx.expense_category ?? ''),
      friendlySource(tx.expense_category_source),
      tx.ai_confidence != null ? String(tx.ai_confidence) : '',
      amountIn,
      amountOut,
      friendlyStatus(tx.status),
      escapeCsvCell(notes),
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

function friendlySource(source: string | null | undefined): string {
  switch (source) {
    case 'ai': return 'AI'
    case 'manual': return 'Manual'
    case 'rule': return 'Rule'
    case 'import': return 'Import'
    default: return ''
  }
}

function friendlyStatus(status: ReceiptTransaction['status']) {
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

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
  if (!tasks.length) return

  const queue = tasks.slice()
  const workerCount = Math.min(limit, queue.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const task = queue.shift()
      if (!task) return
      await task()
    }
  })

  await Promise.all(workers)
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

/**
 * Checks whether the current authenticated user has the super_admin role.
 * Uses the cookie-based auth client to identify the user, then queries
 * user_roles + roles via the admin client.
 */
async function checkIsSuperAdmin(): Promise<boolean> {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return false

    const admin = createAdminClient()
    const { data: roles, error } = await admin
      .from('user_roles')
      .select('roles!inner ( name )')
      .eq('user_id', user.id)

    if (error || !roles) return false

    return roles.some(
      (r) => (r as unknown as { roles: { name: string } }).roles?.name === 'super_admin'
    )
  } catch {
    return false
  }
}

