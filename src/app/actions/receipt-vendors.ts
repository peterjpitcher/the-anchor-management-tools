'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { currentUserCanGovernReceiptRules } from '@/app/actions/receipts'
import { logReceiptActorAudit, requireReceiptActor } from '@/app/actions/receipt-audit'
import type { ReceiptExpenseCategory } from '@/types/database'
import {
  performMergeReceiptVendor,
  performRenameReceiptVendor,
  performUndoReceiptVendorOperation,
  performUpdateReceiptVendorDetails,
  queryReceiptVendorDirectory,
  type ReceiptVendorDirectory,
  type ReceiptVendorKind,
  type VendorOperationResult,
  type VendorUndoResult,
} from '@/services/receipts/receiptVendors'

/**
 * Vendor management for the receipts section.
 *
 * Reading the list needs `receipts:view`. Confirming, deactivating and setting a vendor's kind or
 * default category need `receipts:manage`. Merging, renaming and undoing either rewrite the vendor
 * on every payment and rule that uses it, so they are for super admins only.
 */

function revalidateVendorPaths(): void {
  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/vendors/manage')
  revalidatePath('/receipts/missing-expense')
  revalidatePath('/receipts/pnl')
  revalidateTag('dashboard')
}

const SUPER_ADMIN_ONLY = 'Only a super admin can merge, rename or undo vendor changes.'

export async function getReceiptVendorDirectory(): Promise<{ directory?: ReceiptVendorDirectory; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  try {
    return { directory: await queryReceiptVendorDirectory() }
  } catch (error) {
    console.error('Failed to load the receipt vendor list', error)
    return { error: 'The vendor list could not be loaded.' }
  }
}

export async function mergeReceiptVendors(input: {
  fromVendorId: string
  intoVendorId: string
}): Promise<VendorOperationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_ONLY }
  }

  const result = await performMergeReceiptVendor(actor.user_id, input)

  await logReceiptActorAudit(actor, {
    operation_type: 'merge',
    resource_type: 'receipt_vendor',
    resource_id: input.intoVendorId,
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    additional_info: {
      from_vendor_id: input.fromVendorId,
      into_vendor_id: input.intoVendorId,
      from_name: result.fromName ?? null,
      into_name: result.toName ?? null,
      transactions: result.transactions ?? 0,
      rules: result.rules ?? 0,
      operation_id: result.operationId ?? null,
    },
  })

  if (result.success) {
    revalidateVendorPaths()
  }
  return result
}

export async function renameReceiptVendor(input: { vendorId: string; name: string }): Promise<VendorOperationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_ONLY }
  }

  const result = await performRenameReceiptVendor(actor.user_id, input)

  await logReceiptActorAudit(actor, {
    operation_type: 'rename',
    resource_type: 'receipt_vendor',
    resource_id: input.vendorId,
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    old_values: result.success ? { name: result.fromName } : undefined,
    new_values: result.success ? { name: result.toName } : undefined,
    additional_info: {
      requested_name: input.name,
      transactions: result.transactions ?? 0,
      rules: result.rules ?? 0,
      operation_id: result.operationId ?? null,
    },
  })

  if (result.success) {
    revalidateVendorPaths()
  }
  return result
}

export async function undoReceiptVendorOperation(operationId: string): Promise<VendorUndoResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_ONLY }
  }

  const result = await performUndoReceiptVendorOperation(actor.user_id, operationId)

  await logReceiptActorAudit(actor, {
    operation_type: 'undo',
    resource_type: 'receipt_vendor_operation',
    resource_id: operationId,
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    additional_info: {
      operation: result.operation ?? null,
      already_undone: result.alreadyUndone ?? false,
      transactions_restored: result.transactionsRestored ?? 0,
      transaction_conflicts: result.transactionConflicts ?? 0,
      rules_restored: result.rulesRestored ?? 0,
      rule_conflicts: result.ruleConflicts ?? 0,
    },
  })

  if (result.success) {
    revalidateVendorPaths()
  }
  return result
}

export async function updateReceiptVendorDetails(input: {
  vendorId: string
  status?: 'unconfirmed' | 'confirmed' | 'inactive'
  kind?: ReceiptVendorKind
  defaultExpenseCategory?: ReceiptExpenseCategory | null
}): Promise<{ success?: boolean; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  const result = await performUpdateReceiptVendorDetails(input)

  if (result.success) {
    await logReceiptActorAudit(actor, {
      operation_type: 'update',
      resource_type: 'receipt_vendor',
      resource_id: input.vendorId,
      operation_status: 'success',
      old_values: result.before,
      new_values: result.after,
      additional_info: { name: result.name ?? null },
    })
    revalidateVendorPaths()
    return { success: true }
  }

  return { error: result.error ?? 'The vendor could not be updated.' }
}
