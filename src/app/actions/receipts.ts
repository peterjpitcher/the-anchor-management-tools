'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { escapeRuleKeyword } from '@/lib/receipts/rule-matching'
import { NO_CATEGORY_VALUE } from '@/lib/receipts/no-category'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { receiptRuleSchema, receiptSourceTypeSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { ReceiptRuleSuggestion } from '@/types/database'

// ---------------------------------------------------------------------------
// Re-export types so existing consumers keep working
// ---------------------------------------------------------------------------
export type {
  
  ReceiptWorkspaceFilters,
  
  AIUsageBreakdown,
  RulePreviewResult,
  ReceiptWorkspaceSummary,
  ReceiptWorkspaceData,
  ReceiptMissingExpenseSummaryItem,
  
  
  ReceiptMonthlyInsights,
  ReceiptBankBalanceHistory,
  
  ReceiptVendorSummary,
  ReceiptVendorMonthTransaction,
  ReceiptVendorCostSignal,
  ReceiptVendorMovementRange,
  ReceiptVendorMovementComparison,
  
  ReceiptVendorMovementSignal,
  
  ReceiptVendorMovementSummary,
  
  ReceiptVendorAiReview,
  
  
  ReceiptVendorDetail,
  ReceiptVendorWatchlistItem,
  ReceiptVendorReviewItem,
  ReceiptVendorReviewStatus,
  
  
  ReceiptBulkReviewData,
  ClassificationRuleSuggestion,
  
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
  queryReceiptBankBalanceHistory,
  queryReceiptVendorSummary,
  queryReceiptVendorMonthTransactions,
  queryReceiptVendorDetail,
  queryReceiptVendorMovements,
  queryReceiptVendorCostReview,
  queryReceiptVendorAiSummary,
  queryReceiptVendorWatchlist,
  queryReceiptVendorReviews,
  queryReceiptMissingExpenseSummary,
  queryAIUsageBreakdown,
  queryPreviewReceiptRule,
  // Mutations
  performImportReceiptStatement,
  performMarkReceiptTransaction,
  performUpdateReceiptNote,
  performUpdateReceiptClassification,
  performCreateReceiptUploadUrl,
  performCompleteReceiptUpload,
  performUploadReceiptForTransaction,
  performDeleteReceiptFile,
  performCreateReceiptRule,
  performUpdateReceiptRule,
  performToggleReceiptRule,
  performApplyReceiptGroupClassification,
  performRequeueUnclassifiedTransactions,
  performSetReceiptVendorWatched,
  performSetReceiptVendorReviewStatus,
  performApproveReceiptRuleSuggestion,
  performApproveReceiptRuleSuggestions,
  enqueueReceiptSystemJob,
  performDeclineReceiptRuleSuggestion,
  queryReceiptGovernanceItems,
  refreshAutomationForPendingTransactions,
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
  ReceiptBankBalanceHistory,
  ReceiptVendorSummary,
  ReceiptVendorMonthTransaction,
  ReceiptVendorDetail,
  ReceiptVendorAiReview,
  ReceiptVendorCostSignal,
  ReceiptVendorMovementComparison,
  ReceiptVendorMovementRange,
  ReceiptVendorMovementSignal,
  ReceiptVendorMovementSummary,
  ReceiptVendorWatchlistItem,
  ReceiptVendorReviewItem,
  ReceiptVendorReviewStatus,
  ReceiptMissingExpenseSummaryItem,
  AIUsageBreakdown,
  RulePreviewResult,
  RuleMutationResult,
  BulkStatus,
} from '@/services/receipts'

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------

type ReceiptActor = { user_id: string; user_email: string }

async function requireCurrentUser(): Promise<ReceiptActor> {
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) {
    throw new Error('Unauthorized')
  }
  return { user_id, user_email: user_email ?? '' }
}

/**
 * Every receipts audit entry names the person who did it. The shared audit service records
 * whatever it is given and looks nobody up, so an entry written without an actor is anonymous
 * for good: 1,423 of the first 1,429 receipts entries were. The actor is therefore a required
 * argument here, not an optional field.
 */
async function logReceiptAudit(
  actor: ReceiptActor,
  event: Omit<Parameters<typeof logAuditEvent>[0], 'user_id' | 'user_email'>
): Promise<void> {
  await logAuditEvent({
    ...event,
    user_id: actor.user_id,
    user_email: actor.user_email || undefined,
  })
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RULE_REFRESH_WARNING =
  'The rule was saved, but it could not be run over the pending transactions. Run it from the rules list.'

/** The parts of a rule that decide what it matches and what it does, for the audit trail. */
function ruleAuditValues(rule: {
  name: string
  match_description: string | null
  match_transaction_type: string | null
  match_direction: string
  match_min_amount: number | null
  match_max_amount: number | null
  auto_status: string
  set_vendor_name: string | null
  set_expense_category: string | null
  priority: number
  is_active: boolean
}): Record<string, unknown> {
  return {
    name: rule.name,
    match_description: rule.match_description,
    match_transaction_type: rule.match_transaction_type,
    match_direction: rule.match_direction,
    match_min_amount: rule.match_min_amount,
    match_max_amount: rule.match_max_amount,
    auto_status: rule.auto_status,
    set_vendor_name: rule.set_vendor_name,
    set_expense_category: rule.set_expense_category,
    priority: rule.priority,
    is_active: rule.is_active,
  }
}

function revalidateReceiptPaths(): void {
  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')
  revalidatePath('/receipts/bank-balance')
  revalidatePath('/receipts/missing-expense')
  revalidatePath('/receipts/pnl')
  revalidateTag('dashboard')
}

function optionalRuleFormText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim().length ? value.trim() : undefined
}

function getReceiptRuleValidationInput(formData: FormData) {
  // "No category applies" travels in the category field and is stored as a flag.
  const setsNoCategory = formData.get('set_expense_category') === NO_CATEGORY_VALUE
  return {
    name: formData.get('name') ?? '',
    description: optionalRuleFormText(formData, 'description'),
    priority: toOptionalNumber(formData.get('priority')),
    kind: optionalRuleFormText(formData, 'kind') ?? 'standard',
    match_description: optionalRuleFormText(formData, 'match_description'),
    match_transaction_type: optionalRuleFormText(formData, 'match_transaction_type'),
    match_direction: formData.get('match_direction') ?? 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') ?? 'pending',
    set_vendor_name: optionalRuleFormText(formData, 'set_vendor_name'),
    set_expense_category: setsNoCategory ? undefined : optionalRuleFormText(formData, 'set_expense_category'),
    set_no_category: setsNoCategory,
  }
}

function validateReceiptRuleForm(formData: FormData): { success: true } | { success: false; error: string } {
  const parsed = receiptRuleSchema.safeParse(getReceiptRuleValidationInput(formData))

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }
  if ((parsed.data.set_expense_category || parsed.data.set_no_category) && parsed.data.match_direction !== 'out') {
    return { success: false, error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  return { success: true }
}

export async function currentUserCanGovernReceiptRules(): Promise<boolean> {
  const { user_id } = await requireCurrentUser()
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  try {
    const rpc = (supabase as unknown as { rpc?: unknown }).rpc
    if (typeof rpc === 'function') {
      const { data: rpcData, error: rpcError } = await rpc.call(supabase, 'is_super_admin', {
        check_user_id: user_id,
      }) as { data: unknown; error: unknown }

      if (!rpcError && typeof rpcData === 'boolean') {
        return rpcData
      }
    }

    const { data: roles, error } = await supabase
      .from('user_roles')
      .select('roles!inner(name)')
      .eq('user_id', user_id)

    if (error || !roles) {
      return false
    }

    return roles.some((row: any) => row.roles?.name === 'super_admin')
  } catch {
    return false
  }
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

async function getMonthlyReceiptSummary(limit = 12): Promise<ReceiptMonthlySummaryItem[]> {
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

export async function getReceiptBankBalanceHistory(): Promise<ReceiptBankBalanceHistory> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptBankBalanceHistory()
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

export async function getReceiptVendorDetail(input: {
  vendorLabel: string
  monthWindow?: number
}): Promise<{ detail?: ReceiptVendorDetail; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
  return queryReceiptVendorDetail(input)
}

export async function getReceiptVendorMovements(input: {
  range?: ReceiptVendorMovementRange
  comparison?: ReceiptVendorMovementComparison
  watchedOnly?: boolean
} = {}): Promise<{
  success: boolean
  movements: ReceiptVendorMovementSummary[]
  signals: ReceiptVendorMovementSignal[]
  error?: string
}> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { success: false, movements: [], signals: [], error: 'Insufficient permissions' }
  }

  const { user_id } = input.watchedOnly
    ? await requireCurrentUser()
    : { user_id: undefined as string | undefined }

  return queryReceiptVendorMovements({
    range: input.range,
    comparison: input.comparison,
    watchedOnly: input.watchedOnly,
    userId: user_id,
  })
}

export async function getReceiptVendorCostReview(input: {
  monthWindow?: number
} = {}): Promise<{
  success: boolean
  signals: ReceiptVendorCostSignal[]
  review?: ReceiptVendorAiReview
  error?: string
}> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { success: false, signals: [], error: 'Insufficient permissions' }
  }
  return queryReceiptVendorCostReview(input)
}

export async function getReceiptVendorAiSummary(input: {
  vendorLabel: string
  monthWindow?: number
}): Promise<{
  success: boolean
  review?: ReceiptVendorAiReview
  signals: ReceiptVendorCostSignal[]
  error?: string
}> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { success: false, signals: [], error: 'Insufficient permissions' }
  }
  return queryReceiptVendorAiSummary(input)
}

export async function getReceiptVendorWatchlist(): Promise<ReceiptVendorWatchlistItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  const { user_id } = await requireCurrentUser()
  return queryReceiptVendorWatchlist(user_id)
}

export async function setReceiptVendorWatched(input: {
  vendorLabel: string
  watched: boolean
}): Promise<{
  success?: boolean
  watched?: boolean
  item?: ReceiptVendorWatchlistItem
  error?: string
}> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performSetReceiptVendorWatched(user_id, input)

  if (result.success) {
    revalidatePath('/receipts/vendors')
  }

  return result
}

export async function getReceiptVendorReviews(): Promise<ReceiptVendorReviewItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  const { user_id } = await requireCurrentUser()
  return queryReceiptVendorReviews(user_id)
}

export async function setReceiptVendorReviewStatus(input: {
  vendorLabel: string
  comparison: ReceiptVendorMovementComparison
  monthStart: string
  status: ReceiptVendorReviewStatus
}): Promise<{ success?: boolean; item?: ReceiptVendorReviewItem; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const { user_id } = await requireCurrentUser()
  const result = await performSetReceiptVendorReviewStatus(user_id, input)

  if (result.success) {
    revalidatePath('/receipts/vendors')
  }

  return result
}

export async function getReceiptMissingExpenseSummary(): Promise<ReceiptMissingExpenseSummaryItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
  return queryReceiptMissingExpenseSummary()
}

async function getAIUsageBreakdown(): Promise<{ success: boolean; breakdown?: AIUsageBreakdown; error?: string }> {
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

  const parsed = receiptRuleSchema.safeParse(getReceiptRuleValidationInput(formData))
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid rule' }
  }
  if ((parsed.data.set_expense_category || parsed.data.set_no_category) && parsed.data.match_direction !== 'out') {
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

  const sourceTypeRaw = formData.get('sourceType')
  const sourceType = receiptSourceTypeSchema
    .catch('bank')
    .parse(typeof sourceTypeRaw === 'string' ? sourceTypeRaw : 'bank')

  const buffer = Buffer.from(await receiptFile.arrayBuffer())
  const actor = await requireCurrentUser()
  const { user_id, user_email } = actor

  const result = await performImportReceiptStatement(user_id, user_email, receiptFile, buffer, sourceType)

  if (result.success) {
    await logReceiptAudit(actor, {
      operation_type: 'create',
      resource_type: 'receipt_batch',
      resource_id: result.batch?.id ?? undefined,
      operation_status: 'success',
      additional_info: {
        filename: receiptFile.name,
        source_type: sourceType,
        inserted: result.inserted,
        skipped: result.skipped,
        records_in_file: result.recordsInFile ?? null,
        rejected: result.rejected?.length ?? 0,
        repeated_in_file: result.repeatedInFile ?? 0,
        auto_applied: result.autoApplied,
        auto_classified: result.autoClassified,
        already_imported: result.alreadyImported ?? false,
        followup_status: result.followupStatus ?? null,
        warning: result.warning ?? null,
      },
    })
    revalidateReceiptPaths()
  } else {
    await logReceiptAudit(actor, {
      operation_type: 'create',
      resource_type: 'receipt_batch',
      operation_status: 'failure',
      error_message: result.error ?? 'Import failed',
      additional_info: {
        filename: receiptFile.name,
        source_type: sourceType,
        records_in_file: result.recordsInFile ?? null,
        rejected: result.rejected?.length ?? 0,
      },
    })
  }

  return result
}

/**
 * Saves the note on a payment. Separate from the status change on purpose: a note must not
 * rewrite who marked the payment or drop the rule that closed it.
 */
export async function updateReceiptNote(input: { transactionId: string; note?: string | null }) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const result = await performUpdateReceiptNote(actor.user_id, input)

  if (result.success) {
    await logReceiptAudit(actor, {
      operation_type: 'update_note',
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: { cleared: !input.note },
    })
    revalidatePath('/receipts')
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

  const actor = await requireCurrentUser()
  const { user_id, user_email } = actor
  const result = await performMarkReceiptTransaction(user_id, user_email, input as any)

  if (result.success) {
    await logReceiptAudit(actor, {
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
  /** With no category: this payment takes none ("no category applies"). */
  noCategoryApplies?: boolean
  /** Sent after the person confirms that a name not on the vendor list is a new vendor. */
  createVendor?: boolean
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const result = await performUpdateReceiptClassification(user_id, input as any)

  if (result.success && result.changed) {
    const hasVendorField = Object.prototype.hasOwnProperty.call(input, 'vendorName')
    const hasExpenseField = Object.prototype.hasOwnProperty.call(input, 'expenseCategory')
    await logReceiptAudit(actor, {
      operation_type: 'update_classification',
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: {
        vendor_changed: hasVendorField,
        expense_changed: hasExpenseField,
        vendor: hasVendorField ? result.transaction?.vendor_name ?? null : null,
        vendor_id: hasVendorField ? result.transaction?.vendor_id ?? null : null,
        expense: input.expenseCategory ?? null,
        no_category_applies: hasExpenseField ? Boolean(result.transaction?.no_category_applies) : null,
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

  const actor = await requireCurrentUser()
  const { user_id, user_email } = actor
  const result = await performCompleteReceiptUpload(user_id, user_email, input)

  if (result.success) {
    await logReceiptAudit(actor, {
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

  const actor = await requireCurrentUser()
  const { user_id, user_email } = actor
  const result = await performUploadReceiptForTransaction(user_id, user_email, transactionId, parsedFile.data)

  if (result.success) {
    await logReceiptAudit(actor, {
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

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const result = await performDeleteReceiptFile(user_id, fileId)

  if (result.success) {
    await logReceiptAudit(actor, {
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

  const validation = validateReceiptRuleForm(formData)
  if (!validation.success) {
    return { error: validation.error }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const canGovernRules = await currentUserCanGovernReceiptRules()
  const result = await performCreateReceiptRule(user_id, formData, { canGovernRules })

  if ('success' in result && result.success) {
    await logReceiptAudit(actor, {
      operation_type: 'create',
      resource_type: 'receipt_rule',
      resource_id: result.rule.id,
      operation_status: 'success',
      new_values: ruleAuditValues(result.rule),
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

  const validation = validateReceiptRuleForm(formData)
  if (!validation.success) {
    return { error: validation.error }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const canGovernRules = await currentUserCanGovernReceiptRules()
  const result = await performUpdateReceiptRule(user_id, ruleId, formData, { canGovernRules })

  if ('success' in result && result.success) {
    await logReceiptAudit(actor, {
      operation_type: 'update',
      resource_type: 'receipt_rule',
      resource_id: ruleId,
      operation_status: 'success',
      new_values: ruleAuditValues(result.rule),
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

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const result = await performToggleReceiptRule(ruleId, isActive, user_id)

  if (result.success) {
    await logReceiptAudit(actor, {
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

export async function approveReceiptRuleSuggestion(
  suggestionId: string,
  options: { active?: boolean } = {}
) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const canGovernRules = await currentUserCanGovernReceiptRules()
  if (!canGovernRules) {
    return { error: 'Only super admins can approve suggested rules.' }
  }

  const result = await performApproveReceiptRuleSuggestion(user_id, suggestionId, options)

  if (result.success) {
    // A new rule can clash with an existing one, so the conflict list is worked out again.
    await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', result.rule?.id ?? suggestionId)
    // Re-run rules over pending rows so the newly approved rule classifies its evidence.
    // Triggered here (not in the service) to avoid a circular import between
    // receiptGovernance and receiptMutations. The approval has already committed, so a
    // refresh failure must not fail the action.
    let warning: string | undefined
    try {
      await refreshAutomationForPendingTransactions({ performedBy: user_id })
    } catch (e) {
      console.error('Failed to refresh rules after approve', e)
      warning = RULE_REFRESH_WARNING
    }
    await logReceiptAudit(actor, {
      operation_type: 'approve_suggestion',
      resource_type: 'receipt_rule_suggestion',
      resource_id: suggestionId,
      operation_status: 'success',
      additional_info: { rule_id: result.rule?.id ?? null, refresh_failed: Boolean(warning) },
    })
    revalidateReceiptPaths()
    return { ...result, warning }
  }

  return result
}

export async function approveReceiptRuleSuggestions(
  ids: string[],
  options: { active?: boolean } = {}
): Promise<{ approved?: number; failed?: number; error?: string; warning?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const canGovernRules = await currentUserCanGovernReceiptRules()
  if (!canGovernRules) {
    return { error: 'Only super admins can approve suggested rules.' }
  }

  const validIds = [...new Set(ids)].filter((id) => UUID_PATTERN.test(id))
  if (!validIds.length) {
    return { error: 'Select at least one suggestion to approve.' }
  }

  const result = await performApproveReceiptRuleSuggestions(user_id, validIds, options)

  // One refresh after the whole batch so the approved rules re-run over pending rows once.
  // The approvals have already committed, so a refresh failure must not fail the action.
  let warning: string | undefined
  if (result.approved > 0) {
    await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', `approved:${validIds[0]}`)
    try {
      await refreshAutomationForPendingTransactions({ performedBy: user_id })
    } catch (e) {
      console.error('Failed to refresh rules after approve', e)
      warning = RULE_REFRESH_WARNING
    }
  }

  await logReceiptAudit(actor, {
    operation_type: 'approve_suggestions_bulk',
    resource_type: 'receipt_rule_suggestion',
    // Nothing approved is not a success, whatever was selected.
    operation_status: result.approved > 0 ? 'success' : 'failure',
    error_message: result.approved > 0 ? undefined : 'No suggestion could be approved',
    additional_info: { ...result, count: validIds.length, refresh_failed: Boolean(warning) },
  })
  revalidateReceiptPaths()

  return { ...result, warning }
}

export async function getReceiptRuleSuggestionsPage(
  page = 1,
  pageSize = 20,
  /** `liveChecks` runs each keyword over every payment now: what it matches and what it clashes with. */
  options: { liveChecks?: boolean } = {}
): Promise<{ suggestions: ReceiptRuleSuggestion[]; suggestionsTotal: number; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { suggestions: [], suggestionsTotal: 0, error: 'Insufficient permissions' }
  }

  const { suggestions, suggestionsTotal } = await queryReceiptGovernanceItems({
    page,
    pageSize,
    liveChecks: options?.liveChecks === true,
  })
  return { suggestions, suggestionsTotal }
}

export async function declineReceiptRuleSuggestion(
  suggestionId: string,
  reason?: string
) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const canGovernRules = await currentUserCanGovernReceiptRules()
  if (!canGovernRules) {
    return { error: 'Only super admins can decline suggested rules.' }
  }

  const result = await performDeclineReceiptRuleSuggestion(user_id, suggestionId, reason)

  if (result.success) {
    await logReceiptAudit(actor, {
      operation_type: 'decline_suggestion',
      resource_type: 'receipt_rule_suggestion',
      resource_id: suggestionId,
      operation_status: 'success',
    })
    revalidatePath('/receipts')
  }

  return result
}

export async function applyReceiptGroupClassification(input: {
  details: string
  vendorName?: string | null
  expenseCategory?: string | null
  statuses?: BulkStatus[]
  /** Sent after the person confirms that a name not on the vendor list is a new vendor. */
  createVendor?: boolean
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const { user_id } = actor
  const result = await performApplyReceiptGroupClassification(user_id, input as any)

  if (result.success) {
    await logReceiptAudit(actor, {
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
  /** Sent after the person confirms that a name not on the vendor list is a new vendor. */
  createVendor?: boolean
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
  // With no keywords typed, the whole description is the keyword, commas and all.
  formData.set('match_description', data.matchDescription ?? escapeRuleKeyword(data.details))
  formData.set('match_direction', data.direction)
  formData.set('auto_status', data.autoStatus)
  formData.set('match_transaction_type', '')
  if (vendor) {
    formData.set('set_vendor_name', vendor)
    if (input.createVendor) {
      formData.set('create_vendor', 'true')
    }
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

export async function requeueUnclassifiedTransactions(): Promise<{ success: boolean; queued?: number; alreadyAsked?: number; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }

  const actor = await requireCurrentUser()
  const result = await performRequeueUnclassifiedTransactions()

  await logReceiptAudit(actor, {
    operation_type: 'requeue',
    resource_type: 'receipt_transactions',
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.error,
    additional_info: {
      action: 'requeue_unclassified_transactions',
      queued: result.queued ?? 0,
      already_asked: result.alreadyAsked ?? 0,
    },
  })

  return result
}
