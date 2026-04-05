'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  validateFileType,
  optimiseImage,
  extensionForMimeType,
  type ValidMimeType,
} from '@/lib/expenses/imageProcessor'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Expense {
  id: string
  expense_date: string
  company_ref: string
  justification: string
  amount: number
  vat_applicable: boolean
  vat_amount: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  file_count: number
}

export interface ExpenseFile {
  id: string
  expense_id: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size_bytes: number | null
  uploaded_by: string | null
  uploaded_at: string
  signed_url?: string
}

export interface ExpenseStats {
  quarterTotal: number
  vatReclaimable: number
  missingReceipts: number
}

export interface ExpenseFilters {
  dateFrom?: string
  dateTo?: string
  companySearch?: string
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  company_ref: z.string().min(1, 'Company/ref is required').max(200, 'Max 200 characters'),
  justification: z.string().min(1, 'Justification is required').max(500, 'Max 500 characters'),
  amount: z.number().positive('Amount must be greater than 0'),
  vat_applicable: z.boolean(),
  vat_amount: z.number().min(0, 'VAT amount must be >= 0'),
  notes: z.string().max(2000, 'Max 2000 characters').nullable().optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPENSE_RECEIPTS_BUCKET = 'expense-receipts'
const MAX_FILES_PER_EXPENSE = 10
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

async function requireExpensePermission(action: 'view' | 'manage'): Promise<{
  userId: string
  userEmail: string
}> {
  const canDo = await checkUserPermission('expenses', action)
  if (!canDo) {
    throw new Error('Insufficient permissions')
  }
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { userId: user_id, userEmail: user_email ?? '' }
}

function revalidateExpensePaths(): void {
  revalidatePath('/expenses')
}

// ---------------------------------------------------------------------------
// QUERIES
// ---------------------------------------------------------------------------

/**
 * Fetch expenses with optional date range and company search filters.
 * Includes a file_count for each expense.
 */
export async function getExpenses(
  filters: ExpenseFilters = {}
): Promise<{ success: boolean; data?: Expense[]; error?: string }> {
  try {
    await requireExpensePermission('view')
    const supabase = createAdminClient()

    let query = supabase
      .from('expenses')
      .select('*, expense_files(id)')
      .order('expense_date', { ascending: false })

    if (filters.dateFrom) {
      query = query.gte('expense_date', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.lte('expense_date', filters.dateTo)
    }
    if (filters.companySearch) {
      query = query.ilike('company_ref', `%${filters.companySearch}%`)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Failed to fetch expenses', { error: error as unknown as Error })
      return { success: false, error: 'Failed to fetch expenses' }
    }

    const expenses: Expense[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      expense_date: row.expense_date as string,
      company_ref: row.company_ref as string,
      justification: row.justification as string,
      amount: Number(row.amount),
      vat_applicable: row.vat_applicable as boolean,
      vat_amount: Number(row.vat_amount),
      notes: (row.notes as string | null) ?? null,
      created_by: (row.created_by as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      file_count: Array.isArray(row.expense_files) ? row.expense_files.length : 0,
    }))

    return { success: true, data: expenses }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expenses'
    return { success: false, error: message }
  }
}

/**
 * Return stats for the current calendar quarter:
 * - Quarter total spend
 * - VAT reclaimable total
 * - Count of expenses missing receipt files
 */
export async function getExpenseStats(): Promise<{
  success: boolean
  data?: ExpenseStats
  error?: string
}> {
  try {
    await requireExpensePermission('view')
    const supabase = createAdminClient()

    // Determine current quarter boundaries using London timezone
    const todayStr = getTodayIsoDate() // YYYY-MM-DD in Europe/London
    const [yearStr, monthStr] = todayStr.split('-')
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10) - 1 // 0-indexed

    const quarterMonth = Math.floor(month / 3) * 3
    const qStartStr = `${year}-${String(quarterMonth + 1).padStart(2, '0')}-01`
    // Last day of quarter: day 0 of the month after the quarter
    const qEndDate = new Date(year, quarterMonth + 3, 0)
    const qEndStr = `${year}-${String(quarterMonth + 3).padStart(2, '0')}-${String(qEndDate.getDate()).padStart(2, '0')}`

    // Fetch all expenses for this quarter with file info
    const { data, error } = await supabase
      .from('expenses')
      .select('id, amount, vat_applicable, vat_amount, expense_files(id)')
      .gte('expense_date', qStartStr)
      .lte('expense_date', qEndStr)

    if (error) {
      logger.error('Failed to fetch expense stats', { error: error as unknown as Error })
      return { success: false, error: 'Failed to fetch expense stats' }
    }

    const rows = data ?? []
    let quarterTotal = 0
    let vatReclaimable = 0
    let missingReceipts = 0

    for (const row of rows) {
      quarterTotal += Number(row.amount)
      if (row.vat_applicable) {
        vatReclaimable += Number(row.vat_amount)
      }
      const fileCount = Array.isArray(row.expense_files) ? row.expense_files.length : 0
      if (fileCount === 0) {
        missingReceipts++
      }
    }

    return {
      success: true,
      data: {
        quarterTotal: Math.round(quarterTotal * 100) / 100,
        vatReclaimable: Math.round(vatReclaimable * 100) / 100,
        missingReceipts,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expense stats'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// MUTATIONS
// ---------------------------------------------------------------------------

/**
 * Create a new expense record.
 */
export async function createExpense(formData: {
  expense_date: string
  company_ref: string
  justification: string
  amount: number
  vat_applicable: boolean
  vat_amount: number
  notes?: string | null
}): Promise<{ success?: boolean; error?: string; data?: { id: string } }> {
  try {
    const { userId } = await requireExpensePermission('manage')

    const parsed = expenseSchema.safeParse(formData)
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Validation failed' }
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        expense_date: parsed.data.expense_date,
        company_ref: parsed.data.company_ref,
        justification: parsed.data.justification,
        amount: parsed.data.amount,
        vat_applicable: parsed.data.vat_applicable,
        vat_amount: parsed.data.vat_amount,
        notes: parsed.data.notes ?? null,
        created_by: userId,
      })
      .select('id')
      .single()

    if (error || !data) {
      logger.error('Failed to create expense', { error: error as unknown as Error })
      return { error: 'Failed to create expense' }
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'create',
      resource_type: 'expense',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { amount: parsed.data.amount },
    })

    revalidateExpensePaths()
    return { success: true, data: { id: data.id } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create expense'
    return { error: message }
  }
}

/**
 * Update an existing expense record.
 */
export async function updateExpense(formData: {
  id: string
  expense_date: string
  company_ref: string
  justification: string
  amount: number
  vat_applicable: boolean
  vat_amount: number
  notes?: string | null
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireExpensePermission('manage')

    const { id, ...rest } = formData
    if (!id) return { error: 'Expense ID is required' }

    const parsed = expenseSchema.safeParse(rest)
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Validation failed' }
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('expenses')
      .update({
        expense_date: parsed.data.expense_date,
        company_ref: parsed.data.company_ref,
        justification: parsed.data.justification,
        amount: parsed.data.amount,
        vat_applicable: parsed.data.vat_applicable,
        vat_amount: parsed.data.vat_amount,
        notes: parsed.data.notes ?? null,
      })
      .eq('id', id)

    if (error) {
      logger.error('Failed to update expense', { error: error as unknown as Error })
      return { error: 'Failed to update expense' }
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'update',
      resource_type: 'expense',
      resource_id: id,
      operation_status: 'success',
    })

    revalidateExpensePaths()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update expense'
    return { error: message }
  }
}

/**
 * Delete an expense and all associated files from storage.
 * The DB cascade handles expense_files rows, but storage objects
 * must be cleaned up manually.
 */
export async function deleteExpense(
  id: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireExpensePermission('manage')
    if (!id) return { error: 'Expense ID is required' }

    const supabase = createAdminClient()

    // Fetch file paths before deleting so we can clean up storage
    const { data: files } = await supabase
      .from('expense_files')
      .select('storage_path')
      .eq('expense_id', id)

    // Delete the expense (cascade deletes expense_files rows)
    const { error } = await supabase.from('expenses').delete().eq('id', id)

    if (error) {
      logger.error('Failed to delete expense', { error: error as unknown as Error })
      return { error: 'Failed to delete expense' }
    }

    // Clean up storage objects
    if (files && files.length > 0) {
      const paths = files.map((f) => f.storage_path)
      const { error: storageError } = await supabase.storage
        .from(EXPENSE_RECEIPTS_BUCKET)
        .remove(paths)

      if (storageError) {
        // Non-fatal: DB rows are already deleted; log for manual reconciliation
        logger.error('Failed to clean up expense storage files', {
          error: storageError as unknown as Error,
          metadata: { expense_id: id, paths },
        })
      }
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'delete',
      resource_type: 'expense',
      resource_id: id,
      operation_status: 'success',
    })

    revalidateExpensePaths()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete expense'
    return { error: message }
  }
}

// ---------------------------------------------------------------------------
// FILE OPERATIONS
// ---------------------------------------------------------------------------

/**
 * Upload one or more receipt files for an expense.
 * Server-side validates magic bytes, rejects unsupported types,
 * resizes images to max 2000px, compresses JPEG to 80% quality,
 * and converts HEIC to JPEG.
 */
export async function uploadExpenseFile(
  formData: FormData
): Promise<{ success?: boolean; error?: string; data?: ExpenseFile[] }> {
  try {
    const { userId } = await requireExpensePermission('manage')

    const expenseId = formData.get('expense_id') as string | null
    if (!expenseId) return { error: 'Expense ID is required' }

    const supabase = createAdminClient()

    // Verify the expense exists
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .select('id')
      .eq('id', expenseId)
      .single()

    if (expenseError || !expense) {
      return { error: 'Expense not found' }
    }

    // Check existing file count
    const { count: existingCount } = await supabase
      .from('expense_files')
      .select('id', { count: 'exact', head: true })
      .eq('expense_id', expenseId)

    const currentCount = existingCount ?? 0

    // Collect files from form data
    const files: File[] = []
    for (const [, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        files.push(value)
      }
    }

    if (files.length === 0) return { error: 'No files provided' }

    if (currentCount + files.length > MAX_FILES_PER_EXPENSE) {
      return {
        error: `Maximum ${MAX_FILES_PER_EXPENSE} files per expense. Currently ${currentCount}, trying to add ${files.length}.`,
      }
    }

    // Validate individual file sizes
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return { error: `File "${file.name}" exceeds 20MB limit` }
      }
    }

    // Process files in parallel
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const rawBuffer = Buffer.from(await file.arrayBuffer())

        // Validate magic bytes
        const typeResult = validateFileType(rawBuffer)
        if (!typeResult.valid || !typeResult.mimeType) {
          throw new Error(`File "${file.name}" has an unsupported file type`)
        }

        const detectedMime = typeResult.mimeType

        // Optimise image (PDFs pass through)
        const optimised = await optimiseImage(rawBuffer, detectedMime)

        // Determine file extension based on output mime
        const ext = extensionForMimeType(optimised.mimeType)
        const fileId = crypto.randomUUID()
        const storagePath = `${expenseId}/${fileId}.${ext}`

        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from(EXPENSE_RECEIPTS_BUCKET)
          .upload(storagePath, optimised.buffer, {
            upsert: false,
            contentType: optimised.mimeType,
          })

        if (uploadError) {
          throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`)
        }

        // Record metadata in DB
        const { data: record, error: recordError } = await supabase
          .from('expense_files')
          .insert({
            expense_id: expenseId,
            storage_path: storagePath,
            file_name: file.name,
            mime_type: optimised.mimeType,
            file_size_bytes: optimised.optimisedSizeBytes,
            uploaded_by: userId,
          })
          .select('*')
          .single()

        if (recordError || !record) {
          // Attempt to clean up the storage object
          await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([storagePath])
          throw new Error(`Failed to record metadata for "${file.name}"`)
        }

        return record as ExpenseFile
      })
    )

    // Collect successes and failures
    const uploaded: ExpenseFile[] = []
    const errors: string[] = []

    for (const result of results) {
      if (result.status === 'fulfilled') {
        uploaded.push(result.value)
      } else {
        errors.push(result.reason?.message ?? 'Unknown upload error')
      }
    }

    if (uploaded.length > 0) {
      await logAuditEvent({
        user_id: userId,
        operation_type: 'create',
        resource_type: 'expense_file',
        resource_id: expenseId,
        operation_status: 'success',
        additional_info: {
          file_count: uploaded.length,
          file_ids: uploaded.map((f) => f.id),
        },
      })
    }

    revalidateExpensePaths()

    if (errors.length > 0 && uploaded.length === 0) {
      return { error: errors.join('; ') }
    }

    if (errors.length > 0) {
      // Partial success
      return {
        success: true,
        error: `${uploaded.length} file(s) uploaded, ${errors.length} failed: ${errors.join('; ')}`,
        data: uploaded,
      }
    }

    return { success: true, data: uploaded }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload files'
    return { error: message }
  }
}

/**
 * Delete a single expense file from storage and DB.
 */
export async function deleteExpenseFile(
  fileId: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { userId } = await requireExpensePermission('manage')
    if (!fileId) return { error: 'File ID is required' }

    const supabase = createAdminClient()

    // Fetch the file record to get storage_path
    const { data: file, error: fetchError } = await supabase
      .from('expense_files')
      .select('id, storage_path, expense_id')
      .eq('id', fileId)
      .single()

    if (fetchError || !file) {
      return { error: 'File not found' }
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from(EXPENSE_RECEIPTS_BUCKET)
      .remove([file.storage_path])

    if (storageError) {
      logger.error('Failed to delete expense file from storage', {
        error: storageError as unknown as Error,
        metadata: { file_id: fileId, path: file.storage_path },
      })
      // Continue to delete DB record even if storage fails
    }

    // Delete DB record
    const { error: deleteError } = await supabase
      .from('expense_files')
      .delete()
      .eq('id', fileId)

    if (deleteError) {
      logger.error('Failed to delete expense file record', {
        error: deleteError as unknown as Error,
      })
      return { error: 'Failed to delete file record' }
    }

    await logAuditEvent({
      user_id: userId,
      operation_type: 'delete',
      resource_type: 'expense_file',
      resource_id: fileId,
      operation_status: 'success',
      additional_info: { expense_id: file.expense_id },
    })

    revalidateExpensePaths()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete file'
    return { error: message }
  }
}

/**
 * Fetch file metadata + signed URLs for a given expense.
 * Never accepts raw storage_path from the client — resolves by
 * expense_files.id after verifying permissions.
 */
export async function getExpenseFiles(
  expenseId: string
): Promise<{ success: boolean; data?: ExpenseFile[]; error?: string }> {
  try {
    await requireExpensePermission('view')
    if (!expenseId) return { success: false, error: 'Expense ID is required' }

    const supabase = createAdminClient()

    const { data: files, error } = await supabase
      .from('expense_files')
      .select('*')
      .eq('expense_id', expenseId)
      .order('uploaded_at', { ascending: true })

    if (error) {
      logger.error('Failed to fetch expense files', { error: error as unknown as Error })
      return { success: false, error: 'Failed to fetch files' }
    }

    if (!files || files.length === 0) {
      return { success: true, data: [] }
    }

    // Generate signed URLs (valid for 1 hour)
    const filesWithUrls: ExpenseFile[] = await Promise.all(
      files.map(async (file) => {
        const { data: urlData } = await supabase.storage
          .from(EXPENSE_RECEIPTS_BUCKET)
          .createSignedUrl(file.storage_path, 3600)

        return {
          id: file.id,
          expense_id: file.expense_id,
          storage_path: file.storage_path,
          file_name: file.file_name,
          mime_type: file.mime_type,
          file_size_bytes: file.file_size_bytes,
          uploaded_by: file.uploaded_by,
          uploaded_at: file.uploaded_at,
          signed_url: urlData?.signedUrl ?? undefined,
        }
      })
    )

    return { success: true, data: filesWithUrls }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch files'
    return { success: false, error: message }
  }
}
