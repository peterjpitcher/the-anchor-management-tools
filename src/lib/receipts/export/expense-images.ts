/**
 * Expense receipt image handling for quarterly export.
 *
 * Downloads expense receipt images from Supabase storage and streams
 * them into the archiver with sanitised filenames.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Archiver } from 'archiver'

const EXPENSE_RECEIPTS_BUCKET = 'expense-receipts'
const EXPENSE_IMAGE_CONCURRENCY = 8

interface ExpenseJoin {
  expense_date: string
  company_ref: string
  amount: number
}

interface ExpenseFileRow {
  id: string
  expense_id: string
  storage_path: string
  file_name: string
  mime_type: string
  expense: ExpenseJoin | ExpenseJoin[] | null
}

/**
 * Queries expense_files for the given expense IDs, downloads each from
 * Supabase storage, and appends to the archiver under expense-receipts/.
 *
 * Returns the number of images added (0 means the folder should be omitted).
 */
export async function appendExpenseImages(
  supabase: SupabaseClient,
  expenseIds: string[],
  archive: Archiver
): Promise<number> {
  if (expenseIds.length === 0) return 0

  // Fetch all files for the given expense IDs
  const { data: files, error } = await supabase
    .from('expense_files')
    .select('id, expense_id, storage_path, file_name, mime_type, expense:expenses!expense_files_expense_id_fkey ( expense_date, company_ref, amount )')
    .in('expense_id', expenseIds)
    .order('expense_id', { ascending: true })
    .order('uploaded_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch expense files for export:', error)
    return 0
  }

  const rows = (files ?? []) as ExpenseFileRow[]
  if (rows.length === 0) return 0

  // Build filenames, handling duplicates
  const fileNameMap = buildFileNames(rows)

  let addedCount = 0

  // Download and append with concurrency
  const tasks: Array<() => Promise<void>> = rows.map((file) => async () => {
    try {
      const download = await supabase.storage
        .from(EXPENSE_RECEIPTS_BUCKET)
        .download(file.storage_path)

      if (download.error || !download.data) {
        console.warn(`Skipping expense receipt ${file.storage_path}: ${download.error?.message ?? 'no data'}`)
        return
      }

      const buffer = await normaliseToBuffer(download.data)
      const name = fileNameMap.get(file.id)
      if (name) {
        archive.append(buffer, { name: `expense-receipts/${name}` })
        addedCount++
      }
    } catch (err) {
      console.warn(`Failed to download expense receipt ${file.storage_path}:`, err)
    }
  })

  await runWithConcurrency(tasks, EXPENSE_IMAGE_CONCURRENCY)

  return addedCount
}

/**
 * Builds unique filenames for expense receipt images.
 *
 * Pattern: {YYYY-MM-DD}_{CompanySanitised}_{Amount}.{ext}
 * Multiple images same expense: append _2, _3
 * Collisions across expenses: append expense UUID prefix
 */
function buildFileNames(files: ExpenseFileRow[]): Map<string, string> {
  const result = new Map<string, string>()

  // Group by expense_id to handle multi-image expenses
  const byExpense = new Map<string, ExpenseFileRow[]>()
  for (const file of files) {
    const existing = byExpense.get(file.expense_id) ?? []
    existing.push(file)
    byExpense.set(file.expense_id, existing)
  }

  // Track used filenames to detect cross-expense collisions
  const usedNames = new Map<string, string>() // name -> first expense_id that used it

  for (const [expenseId, expenseFiles] of byExpense) {
    for (let i = 0; i < expenseFiles.length; i++) {
      const file = expenseFiles[i]
      // Supabase FK join may return array or single object
      const expense = Array.isArray(file.expense) ? file.expense[0] ?? null : file.expense

      const date = expense?.expense_date ?? 'unknown'
      const company = sanitiseCompanyName(expense?.company_ref ?? 'unknown')
      const amount = expense?.amount ? Number(expense.amount).toFixed(2) : '0.00'
      const ext = getExtension(file.file_name, file.mime_type)

      let baseName = `${date}_${company}_${amount}`

      // Multi-image suffix for same expense
      if (expenseFiles.length > 1 && i > 0) {
        baseName += `_${i + 1}`
      }

      let fullName = `${baseName}.${ext}`

      // Check for cross-expense collision
      const previousExpenseId = usedNames.get(fullName)
      if (previousExpenseId && previousExpenseId !== expenseId) {
        // Disambiguate with expense UUID prefix
        fullName = `${expenseId.slice(0, 8)}_${baseName}.${ext}`
      }

      // Handle remaining collisions (same expense multi-image edge case)
      if (usedNames.has(fullName) && usedNames.get(fullName) !== expenseId) {
        fullName = `${expenseId.slice(0, 8)}_${baseName}_${i + 1}.${ext}`
      }

      usedNames.set(fullName, expenseId)
      result.set(file.id, fullName)
    }
  }

  return result
}

/**
 * Sanitises a company name for use in filenames.
 * Strips special characters, removes spaces, truncates to 30 chars.
 */
function sanitiseCompanyName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 30) || 'unknown'
}

/**
 * Determines file extension from filename or mime type.
 * HEIC files are stored as JPEG after conversion, so use .jpg.
 */
function getExtension(fileName: string, mimeType: string): string {
  // HEIC stored as JPEG
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'jpg'

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext && ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) return ext

  // Fallback based on mime type
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  }
  return mimeMap[mimeType] ?? 'jpg'
}

async function normaliseToBuffer(data: unknown): Promise<Buffer> {
  if (!data) return Buffer.from('')
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    const arrayBuffer = await (data as Blob).arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
  return Buffer.from(String(data))
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
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
