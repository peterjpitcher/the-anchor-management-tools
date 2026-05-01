'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { receiptRuleSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Re-export types so existing consumers keep working
// ---------------------------------------------------------------------------
export type {
  ReceiptSortColumn,
  ReceiptWorkspaceFilters,
  AIModelBreakdown,
  AIUsageBreakdown,
  RulePreviewResult,
  ReceiptWorkspaceSummary,
  ReceiptWorkspaceData,
  ReceiptMissingExpenseSummaryItem,
  ReceiptMonthlySummaryItem,
  ReceiptMonthlyInsightMonth,
  ReceiptMonthlyInsights,
  ReceiptVendorTrendMonth,
  ReceiptVendorSummary,
  ReceiptVendorMonthTransaction,
  ReceiptDetailGroupSuggestion,
  ReceiptDetailGroup,
  ReceiptBulkReviewData,
  ClassificationRuleSuggestion,
  AutomationResult,
  BulkStatus,
} from '@/services/receipts'

// ---------------------------------------------------------------------------
// Service layer imports
// ---------------------------------------------------------------------------
import {
  // Queries
  queryReceiptWorkspaceData,
  queryReceiptBulkReviewData,
  queryReceiptSignedUrl,
  queryMonthlyReceiptSummary,
  queryMonthlyReceiptInsights,
  queryReceiptVendorSummary,
  queryReceiptVendorMonthTransactions,
  queryReceiptMissingExpenseSummary,
  queryAIUsageBreakdown,
  queryPreviewReceiptRule,
  // Mutations
  performImportReceiptStatement,
  performMarkReceiptTransaction,
  performUpdateReceiptClassification,
  performCreateReceiptUploadUrl,
  performCompleteReceiptUpload,
  performUploadReceiptForTransaction,
  performDeleteReceiptFile,
  performCreateReceiptRule,
  performUpdateReceiptRule,
  performToggleReceiptRule,
  performDeleteReceiptRule,
  performApplyReceiptGroupClassification,
  performRequeueUnclassifiedTransactions,
  applyAutomationRules,
  // Helpers
  fileSchema,
  receiptFileSchema,
  groupRuleInputSchema,
  normalizeVendorInput,
  coerceExpenseCategory,
  hashDetails,
  toOptionalNumber,
} from '@/services/receipts'

import type {
  ReceiptWorkspaceFilters,
  ReceiptWorkspaceData,
  ReceiptBulkReviewData,
  ReceiptMonthlySummaryItem,
  ReceiptMonthlyInsights,
  ReceiptVendorSummary,
  ReceiptVendorMonthTransaction,
  ReceiptMissingExpenseSummaryItem,
  AIUsageBreakdown,
  RulePreviewResult,
  RuleMutationResult,
  RetroStepResult,
  RetroStepSuccess,
  AutomationResult,
  BulkStatus,
} from '@/services/receipts'
import { RETRO_CHUNK_SIZE } from '@/services/receipts'

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------

async function requireCurrentUser(): Promise<{ user_id: string; user_email: string }> {
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { user_id, user_email: user_email ?? '' }
}

function revalidateReceiptPaths(): void {
  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')
  revalidatePath('/receipts/missing-expense')
  revalidatePath('/receipts/pnl')
  revalidateTag('dashboard')
}

function optionalRuleFormText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim().length ? value.trim() : undefined
}

// ---------------------------------------------------------------------------
// QUERIES (thin auth-check wrappers)
// ---------------------------------------------------------------------------

export async function getReceiptWorkspaceData(filters: ReceiptWorkspaceFilters = {}): Promise<ReceiptWorkspaceData> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptWorkspaceData(filters)
}

export async function getReceiptBulkReviewData(options: {
  limit?: number
  statuses?: BulkStatus[]
  onlyUnclassified?: boolean
  useFuzzyGrouping?: boolean
} = {}): Promise<ReceiptBulkReviewData> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptBulkReviewData(options)
}

export async function getReceiptSignedUrl(fileId: string) {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
  return queryReceiptSignedUrl(fileId)
}

export async function getMonthlyReceiptSummary(limit = 12): Promise<ReceiptMonthlySummaryItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryMonthlyReceiptSummary(limit)
}

export async function getMonthlyReceiptInsights(limit = 12): Promise<ReceiptMonthlyInsights> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryMonthlyReceiptInsights(limit)
}

export async function getReceiptVendorSummary(monthWindow = 12): Promise<ReceiptVendorSummary[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptVendorSummary(monthWindow)
}

export async function getReceiptVendorMonthTransactions(input: {
  vendorLabel: string
  monthStart: string
}): Promise<{ transactions: ReceiptVendorMonthTransaction[]; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { transactions: [], error: 'Insufficient permissions' }
  }
  return queryReceiptVendorMonthTransactions(input)
}

export async function getReceiptMissingExpenseSummary(): Promise<ReceiptMissingExpenseSummaryItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptMissingExpenseSummary()
}

export async function getAIUsageBreakdown(): Promise<{ success: boolean; breakdown?: AIUsageBreakdown; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { success: false, error: 'Insufficient permissions' }
  }
  return queryAIUsageBreakdown()
}

export async function previewReceiptRule(formData: FormData): Promise<{ success: boolean; preview?: RulePreviewResult; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const parsed = receiptRuleSchema.safeParse({
    name: formData.get('name') ?? '',
    description: optionalRuleFormText(formData, 'description'),
    match_description: optionalRuleFormText(formData, 'match_description'),
    match_transaction_type: optionalRuleFormText(formData, 'match_transaction_type'),
    match_direction: formData.get('match_direction') ?? 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') ?? 'no_receipt_required',
    set_vendor_name: optionalRuleFormText(formData, 'set_vendor_name'),
    set_expense_category: optionalRuleFormText(formData, 'set_expense_category'),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid rule' }
  }
  if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
    return { success: false, error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const preview = await queryPreviewReceiptRule(parsed.data)
  return { success: true, preview }
}

// ---------------------------------------------------------------------------
// MUTATIONS (auth check → call service → audit → revalidate → return)
// ---------------------------------------------------------------------------

export async function importReceiptStatement(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const file = formData.get('statement')
  const parsedFile = fileSchema.safeParse(file)
  if (!parsedFile.success) {
    return { error: parsedFile.error.issues[0]?.message ?? 'Invalid file upload' }
  }

  const receiptFile = parsedFile.data
  const buffer = Buffer.from(await receiptFile.arrayBuffer())
  const { user_id, user_email } = await requireCurrentUser()

  const result = await performImportReceiptStatement(user_id, user_email, receiptFile, buffer)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'receipt_batch',
      resource_id: result.batch?.id ?? undefined,
      operation_status: 'success',
      additional_info: {
        filename: receiptFile.name,
        inserted: result.inserted,
        skipped: result.skipped,
        auto_applied: result.autoApplied,
        auto_classified: result.autoClassified,
      },
    })
    revalidateReceiptPaths()
  }

  return result
}

export async function markReceiptTransaction(input: {
  transactionId: string
  status: string
  note?: string
  receiptRequired?: boolean
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id, user_email } = await requireCurrentUser()
  const result = await performMarkReceiptTransaction(user_id, user_email, input as any)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'update_status',
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: {
        new_status: input.status,
        note: input.note ?? null,
      },
    })
    revalidatePath('/receipts')
    revalidatePath('/receipts/monthly')
    revalidatePath('/receipts/pnl')
    revalidateTag('dashboard')
  }

  return result
}

export async function updateReceiptClassification(input: {
  transactionId: string
  vendorName?: string | null
  expenseCategory?: string | null
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performUpdateReceiptClassification(user_id, input as any)

  if (result.success && result.changed) {
    const hasVendorField = Object.prototype.hasOwnProperty.call(input, 'vendorName')
    const hasExpenseField = Object.prototype.hasOwnProperty.call(input, 'expenseCategory')
    await logAuditEvent({
      operation_type: 'update_classification',
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: {
        vendor_changed: hasVendorField,
        expense_changed: hasExpenseField,
        vendor: input.vendorName ?? null,
        expense: input.expenseCategory ?? null,
      },
    })
    revalidatePath('/receipts')
    revalidatePath('/receipts/monthly')
    revalidatePath('/receipts/missing-expense')
    revalidatePath('/receipts/vendors')
    revalidatePath('/receipts/pnl')
    revalidateTag('dashboard')
  }

  return result
}

export async function createReceiptUploadUrl(input: {
  transactionId: string
  fileName: string
  fileType: string
  fileSize: number
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  if (typeof input.transactionId !== 'string' || !input.transactionId) {
    return { error: 'Missing transaction reference' }
  }

  const { user_id } = await requireCurrentUser()
  return performCreateReceiptUploadUrl(user_id, input.transactionId, {
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
  })
}

export async function completeReceiptUpload(input: {
  transactionId: string
  storagePath: string
  fileName: string
  fileType: string
  fileSize: number
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  if (typeof input.transactionId !== 'string' || !input.transactionId) {
    return { error: 'Missing transaction reference' }
  }

  const { user_id, user_email } = await requireCurrentUser()
  const result = await performCompleteReceiptUpload(user_id, user_email, input)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'upload_receipt',
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: {
        status: 'completed',
        file_name: input.fileName,
        file_size: input.fileSize,
      },
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function uploadReceiptForTransaction(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const transactionId = formData.get('transactionId')
  if (typeof transactionId !== 'string' || !transactionId) {
    return { error: 'Missing transaction reference' }
  }

  const receiptFile = formData.get('receipt')
  const parsedFile = receiptFileSchema.safeParse(receiptFile)
  if (!parsedFile.success) {
    return { error: parsedFile.error.issues[0]?.message ?? 'Invalid receipt upload' }
  }

  const { user_id, user_email } = await requireCurrentUser()
  const result = await performUploadReceiptForTransaction(user_id, user_email, transactionId, parsedFile.data)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'upload_receipt',
      resource_type: 'receipt_transaction',
      resource_id: transactionId,
      operation_status: 'success',
      additional_info: { status: 'completed' },
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function deleteReceiptFile(fileId: string) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performDeleteReceiptFile(user_id, fileId)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'delete_receipt',
      resource_type: 'receipt_file',
      resource_id: fileId,
      operation_status: 'success',
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function createReceiptRule(formData: FormData): Promise<RuleMutationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performCreateReceiptRule(user_id, formData)

  if ('success' in result && result.success) {
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'receipt_rule',
      resource_id: result.rule.id,
      operation_status: 'success',
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function updateReceiptRule(ruleId: string, formData: FormData): Promise<RuleMutationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performUpdateReceiptRule(user_id, ruleId, formData)

  if ('success' in result && result.success) {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'receipt_rule',
      resource_id: ruleId,
      operation_status: 'success',
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function toggleReceiptRule(ruleId: string, isActive: boolean) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const result = await performToggleReceiptRule(ruleId, isActive)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'toggle',
      resource_type: 'receipt_rule',
      resource_id: ruleId,
      operation_status: 'success',
      additional_info: { is_active: isActive },
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function deleteReceiptRule(ruleId: string) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const result = await performDeleteReceiptRule(ruleId)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'receipt_rule',
      resource_id: ruleId,
      operation_status: 'success',
    })
    revalidatePath('/receipts')
    revalidateTag('dashboard')
  }

  return result
}

export async function applyReceiptGroupClassification(input: {
  details: string
  vendorName?: string | null
  expenseCategory?: string | null
  statuses?: BulkStatus[]
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performApplyReceiptGroupClassification(user_id, input as any)

  if (result.success) {
    await logAuditEvent({
      operation_type: 'bulk_classification',
      resource_type: 'receipt_transaction_group',
      resource_id: hashDetails(input.details),
      operation_status: 'success',
      additional_info: {
        details: input.details,
        count: result.updated,
        skipped_incoming_count: result.skippedIncomingCount,
      },
    })
    revalidateReceiptPaths()
  }

  return result
}

export async function createReceiptRuleFromGroup(input: {
  name: string
  details: string
  matchDescription?: string
  description?: string
  direction?: 'in' | 'out' | 'both'
  autoStatus?: string
  vendorName?: string | null
  expenseCategory?: string | null
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const parsed = groupRuleInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }

  const data = parsed.data
  const vendor = normalizeVendorInput(data.vendorName ?? null)
  const expense = coerceExpenseCategory(data.expenseCategory ?? null)

  const formData = new FormData()
  formData.set('name', data.name)
  if (data.description) {
    formData.set('description', data.description)
  }
  formData.set('match_description', data.matchDescription ?? data.details)
  formData.set('match_direction', data.direction)
  formData.set('auto_status', data.autoStatus)
  formData.set('match_transaction_type', '')
  if (vendor) {
    formData.set('set_vendor_name', vendor)
  }
  if (expense) {
    formData.set('set_expense_category', expense)
  }

  const result = await createReceiptRule(formData)

  if ('success' in result) {
    revalidatePath('/receipts/bulk')
    revalidateTag('dashboard')
  }

  return result
}

export async function requeueUnclassifiedTransactions(): Promise<{ success: boolean; queued?: number; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }
  return performRequeueUnclassifiedTransactions()
}

// ---------------------------------------------------------------------------
// RETRO-RUN actions (kept here because they compose multiple service calls)
// ---------------------------------------------------------------------------

export async function runReceiptRuleRetroactivelyStep({
  ruleId,
  scope = 'pending',
  offset = 0,
  chunkSize = RETRO_CHUNK_SIZE,
}: {
  ruleId: string
  scope?: 'pending' | 'all'
  offset?: number
  chunkSize?: number
}): Promise<RetroStepResult> {
  const startedAt = Date.now()
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  const { data: rule, error: ruleError } = await supabase
    .from('receipt_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle()

  if (ruleError || !rule) {
    console.error('[retro-step] rule lookup failed', { ruleId, ruleError })
    return { success: false, error: 'Rule not found' }
  }

  if (!rule.is_active) {
    console.warn('[retro-step] rule inactive', { ruleId })
    return { success: false, error: 'Enable the rule before running it' }
  }

  let idsQuery = supabase
    .from('receipt_transactions')
    .select('id', { count: 'exact', head: false })
    .order('transaction_date', { ascending: false })

  if (scope === 'pending') {
    idsQuery = idsQuery.eq('status', 'pending')
  }

  const { data: idRows, count, error: idsError } = await idsQuery.range(offset, offset + chunkSize - 1)

  if (idsError) {
    console.error('[retro-step] failed to load ids', { idsError, ruleId, offset, chunkSize })
    return { success: false, error: 'Failed to load transactions' }
  }

  const ids = (idRows ?? []).map((row) => row.id ?? null).filter((value): value is string => Boolean(value))

  const total = typeof count === 'number' ? count : offset + ids.length

  if (!ids.length) {
    return {
      success: true,
      reviewed: 0,
      matched: 0,
      statusAutoUpdated: 0,
      classificationUpdated: 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
      nextOffset: offset,
      total,
      done: true,
      durationMs: Date.now() - startedAt,
    }
  }

  const summary = await applyAutomationRules(ids, {
    includeClosed: scope === 'all',
    targetRuleId: ruleId,
    overrideManual: scope === 'all',
    allowClosedStatusUpdates: scope === 'all',
  })

  const nextOffset = offset + ids.length
  const done = nextOffset >= total
  const durationMs = Date.now() - startedAt

  logger.debug('[retro-step] processed chunk', {
    metadata: {
      ruleId,
      scope,
      offset,
      processed: ids.length,
      matched: summary.matched,
      statusAutoUpdated: summary.statusAutoUpdated,
      classificationUpdated: summary.classificationUpdated,
      vendorIntended: summary.vendorIntended,
      expenseIntended: summary.expenseIntended,
      nextOffset,
      total,
      done,
      durationMs,
    },
  })

  return {
    success: true,
    reviewed: ids.length,
    matched: summary.matched,
    statusAutoUpdated: summary.statusAutoUpdated,
    classificationUpdated: summary.classificationUpdated,
    vendorIntended: summary.vendorIntended,
    expenseIntended: summary.expenseIntended,
    samples: summary.samples,
    nextOffset,
    total,
    done,
    durationMs,
  }
}

export async function finalizeReceiptRuleRetroRun(input: {
  ruleId: string
  scope: 'pending' | 'all'
  reviewed: number
  statusAutoUpdated: number
  classificationUpdated: number
  matched: number
  vendorIntended: number
  expenseIntended: number
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  await logAuditEvent({
    operation_type: 'retro_run',
    resource_type: 'receipt_rule',
    resource_id: input.ruleId,
    operation_status: 'success',
    additional_info: {
      scope: input.scope,
      reviewed: input.reviewed,
      auto_marked: input.statusAutoUpdated,
      classified: input.classificationUpdated,
      matched: input.matched,
      vendor_intended: input.vendorIntended,
      expense_intended: input.expenseIntended,
    },
  })

  revalidateReceiptPaths()

  return { success: true }
}

export async function runReceiptRuleRetroactively(
  ruleId: string,
  scope: 'pending' | 'all' = 'pending'
) {
  const start = Date.now()
  const timeBudgetMs = 12_000

  let offset = 0
  let totals = {
    reviewed: 0,
    matched: 0,
    statusAutoUpdated: 0,
    classificationUpdated: 0,
    vendorIntended: 0,
    expenseIntended: 0,
  }
  let samples: AutomationResult['samples'] = []
  let totalRecords = 0

  while (true) {
    const step = await runReceiptRuleRetroactivelyStep({ ruleId, scope, offset })

    if (!step.success) {
      return { error: step.error }
    }

    totals = {
      reviewed: totals.reviewed + step.reviewed,
      matched: totals.matched + step.matched,
      statusAutoUpdated: totals.statusAutoUpdated + step.statusAutoUpdated,
      classificationUpdated: totals.classificationUpdated + step.classificationUpdated,
      vendorIntended: totals.vendorIntended + step.vendorIntended,
      expenseIntended: totals.expenseIntended + step.expenseIntended,
    }

    if (!samples.length && step.samples.length) {
      samples = step.samples
    }

    offset = step.nextOffset
    totalRecords = step.total

    if (step.done) {
      const finalizeResult = await finalizeReceiptRuleRetroRun({
        ruleId,
        scope,
        reviewed: totals.reviewed,
        statusAutoUpdated: totals.statusAutoUpdated,
        classificationUpdated: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
      })

      if (finalizeResult && 'error' in finalizeResult && finalizeResult.error) {
        return { error: finalizeResult.error }
      }

      return {
        success: true,
        ruleId,
        reviewed: totals.reviewed,
        autoApplied: totals.statusAutoUpdated,
        classified: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
        samples,
        scope,
        done: true,
      }
    }

    if (Date.now() - start > timeBudgetMs) {
      console.warn('[retro] time budget exceeded, returning partial result', {
        ruleId,
        scope,
        offset,
        totals,
        totalRecords,
      })
      const partialFinalizeResult = await finalizeReceiptRuleRetroRun({
        ruleId,
        scope,
        reviewed: totals.reviewed,
        statusAutoUpdated: totals.statusAutoUpdated,
        classificationUpdated: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
      })
      if (partialFinalizeResult && 'error' in partialFinalizeResult && partialFinalizeResult.error) {
        return { error: partialFinalizeResult.error }
      }
      return {
        success: true,
        ruleId,
        reviewed: totals.reviewed,
        autoApplied: totals.statusAutoUpdated,
        classified: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
        samples,
        scope,
        done: false,
        partial: true,
        nextOffset: offset,
        total: totalRecords,
        warning: `Time limit reached after processing ${totals.reviewed} transactions. Re-run to continue.`,
      }
    }
  }
}
