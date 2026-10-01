'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { currentUserCanGovernReceiptRules } from '@/app/actions/receipts'
import { logReceiptActorAudit, requireReceiptActor } from '@/app/actions/receipt-audit'
import type { MatcherComparison, RuleMatchExplanation } from '@/lib/receipts/rule-health'
import { performReopenProposalsForUndoneRun } from '@/services/receipts/receiptAiReview'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import {
  performApplyReceiptRuleRunStep,
  performPreviewReceiptRuleRun,
  performUndoReceiptRuleRunStep,
  queryReceiptRuleHealth,
  queryReceiptRuleRun,
  queryReceiptRuleTest,
  queryRecentReceiptRuleRuns,
  queryRuleMatcherComparison,
  type ReceiptRuleHealth,
  type RuleRunPreview,
  type RuleRunRecord,
  type RuleRunScope,
  type RuleRunStep,
  type RuleRunUndoStep,
} from '@/services/receipts/receiptRuleRuns'
import {
  performSetReceiptsLockDate,
  performSetRuleMatcher,
  queryReceiptSettings,
  type ReceiptSettings,
} from '@/services/receipts/receiptSettings'

/**
 * Rule runs over existing payments, the lock date, rule health and the test box.
 *
 * A run over pending payments needs `receipts:manage`. A run over all history, the lock date and
 * the matcher setting are for super admins. Permission is checked on every call: a run is several
 * requests, and a role can change between them.
 */

const SUPER_ADMIN_ALL = 'Only super admins can run a rule over all historical transactions.'
const SUPER_ADMIN_SETTING = 'Only a super admin can change this setting.'

function revalidateRulePaths(): void {
  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')
  revalidatePath('/receipts/missing-expense')
  revalidatePath('/receipts/pnl')
  revalidateTag('dashboard')
}

export async function previewReceiptRuleRun(input: {
  ruleId: string
  scope?: RuleRunScope
}): Promise<RuleRunPreview | { success: false; error: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }

  // Everything arrives from the browser, so none of it is trusted.
  const scope: RuleRunScope = input?.scope === 'all' ? 'all' : 'pending'
  const actor = await requireReceiptActor()
  if (scope === 'all' && !(await currentUserCanGovernReceiptRules())) {
    return { success: false, error: SUPER_ADMIN_ALL }
  }

  const result = await performPreviewReceiptRuleRun(actor.user_id, { ruleId: String(input?.ruleId ?? ''), scope })

  if (result.success) {
    await logReceiptActorAudit(actor, {
      operation_type: 'retro_run_previewed',
      resource_type: 'receipt_rule',
      resource_id: String(input.ruleId),
      operation_status: 'success',
      additional_info: {
        run_id: result.runId,
        scope,
        reviewed: result.reviewed,
        matched: result.matched,
        planned: result.planned,
        protected: result.protectedCount,
        locked: result.locked,
        lock_date: result.lockDate,
      },
    })
  }

  return result
}

export async function applyReceiptRuleRunStep(runId: string): Promise<RuleRunStep> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  let run: RuleRunRecord | null
  try {
    run = await queryReceiptRuleRun(String(runId ?? ''))
  } catch (error) {
    console.error('Failed to load a receipt rule run', error)
    return { success: false, error: 'The run could not be loaded.' }
  }
  if (!run) {
    return { success: false, error: 'That preview no longer exists. Preview the rule again.' }
  }
  // The person who looked at the preview is the person who runs it.
  if (run.createdBy !== actor.user_id) {
    return { success: false, error: 'That preview was made by someone else. Preview the rule yourself before running it.' }
  }
  if (run.scope === 'all' && !(await currentUserCanGovernReceiptRules())) {
    return { success: false, error: SUPER_ADMIN_ALL }
  }

  const step = await performApplyReceiptRuleRunStep(actor.user_id, run.id)

  const isFirstStep = step.success && step.appliedTotal + step.skippedChangedTotal + step.skippedLockedTotal ===
    step.applied + step.skippedChanged + step.skippedLocked

  if (!step.success || step.done || isFirstStep) {
    await logReceiptActorAudit(actor, {
      operation_type: step.success ? (step.done ? 'retro_run' : 'retro_run_started') : 'retro_run',
      resource_type: 'receipt_rule',
      resource_id: run.ruleId ?? run.id,
      operation_status: step.success ? 'success' : 'failure',
      error_message: step.success ? undefined : step.error,
      additional_info: {
        run_id: run.id,
        rule_name: run.label,
        scope: run.scope,
        planned: run.planned,
        ...(step.success
          ? {
              applied: step.appliedTotal,
              skipped_changed: step.skippedChangedTotal,
              skipped_locked: step.skippedLockedTotal,
              remaining: step.remaining,
            }
          : {}),
      },
    })
  }

  if (step.success && step.done) {
    revalidateRulePaths()
  }
  return step
}

export async function undoReceiptRuleRunStep(runId: string): Promise<RuleRunUndoStep> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()

  let run: RuleRunRecord | null
  try {
    run = await queryReceiptRuleRun(String(runId ?? ''))
  } catch (error) {
    console.error('Failed to load a receipt rule run', error)
    return { success: false, error: 'The run could not be loaded.' }
  }
  if (!run) {
    return { success: false, error: 'That run no longer exists.' }
  }
  if (run.scope === 'all' && !(await currentUserCanGovernReceiptRules())) {
    return { success: false, error: 'Only super admins can undo a run over all historical transactions.' }
  }

  const step = await performUndoReceiptRuleRunStep(actor.user_id, run.id)

  if (!step.success || step.done) {
    await logReceiptActorAudit(actor, {
      operation_type: 'retro_run_undone',
      resource_type: 'receipt_rule',
      resource_id: run.ruleId ?? run.id,
      operation_status: step.success ? 'success' : 'failure',
      error_message: step.success ? undefined : step.error,
      additional_info: {
        run_id: run.id,
        rule_name: run.label,
        scope: run.scope,
        ...(step.success ? { restored: step.restoredTotal, conflicts: step.conflictTotal } : {}),
      },
    })
  }

  if (step.success && step.done) {
    // Undoing a run of accepted suggestions puts those suggestions back on offer.
    if (run.kind === 'ai_accept_all') {
      await performReopenProposalsForUndoneRun(run.id)
    }
    revalidateRulePaths()
  }
  return step
}

export async function getRecentReceiptRuleRuns(): Promise<{ runs?: RuleRunRecord[]; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
  try {
    return { runs: await queryRecentReceiptRuleRuns() }
  } catch (error) {
    console.error('Failed to load recent receipt rule runs', error)
    return { error: 'The recent runs could not be loaded.' }
  }
}

export async function getReceiptSettings(): Promise<{ settings?: ReceiptSettings; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
  try {
    return { settings: await queryReceiptSettings() }
  } catch (error) {
    console.error('Failed to load receipt settings', error)
    return { error: 'The receipts settings could not be loaded.' }
  }
}

export async function setReceiptsLockDate(date: string | null): Promise<{ success?: boolean; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_SETTING }
  }

  const value = typeof date === 'string' && date.trim() ? date.trim() : null
  const result = await performSetReceiptsLockDate(actor.user_id, value)

  await logReceiptActorAudit(actor, {
    operation_type: 'set_lock_date',
    resource_type: 'receipt_settings',
    resource_id: 'locked_before',
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    old_values: result.success ? { locked_before: result.previous ?? null } : undefined,
    new_values: result.success ? { locked_before: result.current ?? null } : undefined,
  })

  if (!result.success) {
    return { error: result.error ?? 'The lock date could not be saved.' }
  }
  revalidatePath('/receipts')
  return { success: true }
}

export async function getReceiptRuleHealth(): Promise<{ health?: ReceiptRuleHealth; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  try {
    return { health: await queryReceiptRuleHealth() }
  } catch (error) {
    console.error('Failed to work out receipt rule health', error)
    return { error: 'Rule health could not be worked out.' }
  }
}

export async function testReceiptRules(input: {
  details: string
  transactionType?: string | null
  direction?: 'in' | 'out'
  amount?: number
}): Promise<{ result?: RuleMatchExplanation & { matcher: RuleMatcherMode }; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const details = typeof input?.details === 'string' ? input.details.trim().slice(0, 500) : ''
  if (!details) {
    return { error: 'Paste a bank description to test.' }
  }
  const amount = Number(input?.amount)
  try {
    return {
      result: await queryReceiptRuleTest({
        details,
        transactionType: typeof input?.transactionType === 'string' ? input.transactionType.trim().slice(0, 120) || null : null,
        direction: input?.direction === 'in' ? 'in' : 'out',
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      }),
    }
  } catch (error) {
    console.error('Failed to test receipt rules', error)
    return { error: 'The rules could not be tested.' }
  }
}

export async function getRuleMatcherComparison(): Promise<{
  comparison?: MatcherComparison & { matcher: RuleMatcherMode; truncated: boolean }
  error?: string
}> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_SETTING }
  }
  try {
    return { comparison: await queryRuleMatcherComparison() }
  } catch (error) {
    console.error('Failed to compare the rule matchers', error)
    return { error: 'The comparison could not be worked out.' }
  }
}

export async function setReceiptRuleMatcher(matcher: RuleMatcherMode): Promise<{ success?: boolean; error?: string }> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }
  const actor = await requireReceiptActor()
  if (!(await currentUserCanGovernReceiptRules())) {
    return { error: SUPER_ADMIN_SETTING }
  }

  const result = await performSetRuleMatcher(actor.user_id, matcher)

  await logReceiptActorAudit(actor, {
    operation_type: 'set_rule_matcher',
    resource_type: 'receipt_settings',
    resource_id: 'rule_matcher',
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    old_values: result.success ? { rule_matcher: result.previous } : undefined,
    new_values: result.success ? { rule_matcher: matcher } : undefined,
  })

  if (!result.success) {
    return { error: result.error ?? 'The setting could not be saved.' }
  }
  revalidatePath('/receipts')
  return { success: true }
}
