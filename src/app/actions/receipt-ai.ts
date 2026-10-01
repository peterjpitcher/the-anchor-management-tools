'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logReceiptActorAudit, requireReceiptActor } from '@/app/actions/receipt-audit'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'
import {
  performAcceptVendorCategoryProposals,
  performDecideReceiptAiCategory,
  queryOpenCategoryProposals,
  queryReceiptAiStatus,
  type AcceptAllResult,
  type AiCategoryDecision,
  type CategoryProposalGroup,
  type ReceiptAiStatus,
} from '@/services/receipts/receiptAiReview'
import { performRequeueUnclassifiedTransactions } from '@/services/receipts/receiptMutations'

/**
 * What a person does with the AI's suggestions. Everything here needs `receipts:manage`: a
 * suggested category is only ever written because someone with that permission said yes.
 */

function revalidateAfterClassification(): void {
  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidatePath('/receipts/monthly')
  revalidatePath('/receipts/missing-expense')
  revalidatePath('/receipts/pnl')
  revalidateTag('dashboard')
}

export async function decideReceiptAiCategory(input: {
  transactionId: string
  decision: AiCategoryDecision
  expenseCategory?: ReceiptExpenseCategory | null
  noCategoryApplies?: boolean
}): Promise<{ success?: boolean; error?: string; transaction?: ReceiptTransaction; superseded?: boolean }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  const result = await performDecideReceiptAiCategory(actor.user_id, {
    transactionId: String(input?.transactionId ?? ''),
    decision: input?.decision,
    expenseCategory: input?.expenseCategory ?? null,
    noCategoryApplies: Boolean(input?.noCategoryApplies),
  })

  if (result.success) {
    await logReceiptActorAudit(actor, {
      operation_type: `ai_category_${result.decision}`,
      resource_type: 'receipt_transaction',
      resource_id: input.transactionId,
      operation_status: 'success',
      additional_info: {
        decision: result.decision,
        expense_category: result.transaction?.expense_category ?? null,
        no_category_applies: Boolean(result.transaction?.no_category_applies),
      },
    })
    revalidateAfterClassification()
  }

  return { success: result.success, error: result.error, transaction: result.transaction, superseded: result.superseded }
}

export async function getReceiptCategoryProposals(): Promise<{ groups?: CategoryProposalGroup[]; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  try {
    return { groups: await queryOpenCategoryProposals() }
  } catch (error) {
    console.error('Failed to load suggested categories', error)
    return { error: 'The suggested categories could not be loaded.' }
  }
}

export async function acceptVendorCategoryProposals(input: { vendorId: string | null }): Promise<AcceptAllResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  const vendorId = typeof input?.vendorId === 'string' && input.vendorId ? input.vendorId : null
  const result = await performAcceptVendorCategoryProposals(actor.user_id, { vendorId })

  await logReceiptActorAudit(actor, {
    operation_type: 'ai_category_accept_all',
    resource_type: 'receipt_vendor',
    resource_id: vendorId ?? 'no_vendor',
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    additional_info: {
      run_id: result.runId ?? null,
      accepted: result.accepted ?? 0,
      skipped_changed: result.skippedChanged ?? 0,
      skipped_locked: result.skippedLocked ?? 0,
    },
  })

  if (result.success || (result.accepted ?? 0) > 0) {
    revalidateAfterClassification()
  }
  return result
}

export async function getReceiptAiStatus(): Promise<{ status?: ReceiptAiStatus; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
  try {
    return { status: await queryReceiptAiStatus() }
  } catch (error) {
    console.error('Failed to load AI classification status', error)
    return { error: 'The AI classification status could not be loaded.' }
  }
}

/** Sends again the payments whose classification failed, including those that had been given up on. */
export async function retryFailedReceiptClassification(): Promise<{ success: boolean; queued?: number; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  const result = await performRequeueUnclassifiedTransactions({ retryFinalFailures: true })

  await logReceiptActorAudit(actor, {
    operation_type: 'requeue',
    resource_type: 'receipt_transactions',
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.error,
    additional_info: {
      action: 'retry_failed_classification',
      queued: result.queued ?? 0,
      already_asked: result.alreadyAsked ?? 0,
    },
  })

  return { success: result.success, queued: result.queued, error: result.error }
}
