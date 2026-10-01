/**
 * Running a rule over payments that already exist: preview, apply, undo.
 *
 * The preview works out, with the same code the engine uses, exactly which payments the rule
 * would change and to what. It is stored with each payment's version. Applying it writes only
 * that set: a payment that has changed since is skipped, and the run stops if the rule, any other
 * rule or the lock date has moved. Every change is stored with what it replaced, so the run can
 * be undone.
 *
 * @requires Callers must verify user auth, 'receipts.manage', and super admin for scope "all".
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  evaluatePaymentAgainstRules,
  paymentAmount,
  type EvaluablePayment,
  type RuleChangePlan,
} from '@/lib/receipts/rule-evaluation'
import {
  compareRuleMatchers,
  computeRuleHealth,
  explainRuleMatch,
  type MatcherComparison,
  type RuleHealthItem,
  type RuleMatchExplanation,
} from '@/lib/receipts/rule-health'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import { NO_CATEGORY_LABEL } from '@/lib/receipts/no-category'
import type { ReceiptTransaction } from '@/types/database'
import { loadRulesForEvaluation } from './receiptAutomation'
import type { AdminClient } from './types'

export type RuleRunScope = 'pending' | 'all'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYMENT_COLUMNS =
  'id, transaction_date, details, transaction_type, amount_in, amount_out, status, marked_method, vendor_id, vendor_name, vendor_source, vendor_rule_id, expense_category, no_category_applies, expense_category_source, expense_rule_id, updated_at'
const CHANGE_INSERT_CHUNK = 500
const SAMPLE_LIMIT = 50
/** Changes written per call, so one request stays well inside the time a server action has. */
export const RULE_RUN_STEP_SIZE = 200

async function loadPaymentsForEvaluation(supabase: AdminClient, scope: RuleRunScope): Promise<EvaluablePayment[]> {
  return fetchAllRows<EvaluablePayment>(
    (from, to) => {
      let query = (supabase as any).from('receipt_transactions').select(PAYMENT_COLUMNS)
      if (scope === 'pending') query = query.eq('status', 'pending')
      return query.order('id', { ascending: true }).range(from, to)
    },
    { label: `receipt payments for rule evaluation (${scope})` }
  )
}

export type RuleRunSample = {
  transactionId: string
  transactionDate: string
  details: string
  amount: number
  before: { status: ReceiptTransaction['status']; vendor: string | null; category: string | null }
  after: { status: ReceiptTransaction['status']; vendor: string | null; category: string | null }
}

export type RuleRunPreview = {
  success: true
  /** Null when the rule would change nothing: there is nothing to apply. */
  runId: string | null
  ruleName: string
  scope: RuleRunScope
  lockDate: string | null
  reviewed: number
  /** Payments the rule matches. */
  matched: number
  /** Matched payments it would change. */
  planned: number
  statusChanges: number
  vendorChanges: number
  expenseChanges: number
  /** Matched payments where a person, the import or invoice pairing has already decided. */
  protectedCount: number
  /** Matched payments it would change, left alone because they are on or before the lock date. */
  locked: number
  /** Matched payments where another rule decides every field, so this one changes nothing. */
  outranked: number
  samples: RuleRunSample[]
}

function categoryLabel(category: string | null | undefined, noCategoryApplies: boolean | null | undefined): string | null {
  return category ?? (noCategoryApplies ? NO_CATEGORY_LABEL : null)
}

function sampleOf(payment: EvaluablePayment, plan: RuleChangePlan): RuleRunSample {
  return {
    transactionId: payment.id,
    transactionDate: payment.transaction_date,
    details: payment.details,
    amount: paymentAmount(payment),
    before: { status: payment.status, vendor: payment.vendor_name, category: categoryLabel(payment.expense_category, payment.no_category_applies) },
    after: {
      status: plan.statusChanged ? (plan.after.status as ReceiptTransaction['status']) : payment.status,
      vendor: plan.vendorChanged ? ((plan.after.vendor_name as string | null) ?? null) : payment.vendor_name,
      category: plan.expenseChanged
        ? categoryLabel(plan.after.expense_category as string | null, plan.after.no_category_applies as boolean | undefined)
        : categoryLabel(payment.expense_category, payment.no_category_applies),
    },
  }
}

export async function performPreviewReceiptRuleRun(
  userId: string,
  input: { ruleId: string; scope: RuleRunScope }
): Promise<RuleRunPreview | { success: false; error: string }> {
  if (!UUID_PATTERN.test(input.ruleId)) {
    return { success: false, error: 'Choose a rule to run.' }
  }
  if (input.scope !== 'pending' && input.scope !== 'all') {
    return { success: false, error: 'Choose which transactions to run the rule over.' }
  }

  const supabase = createAdminClient()

  let loaded: Awaited<ReturnType<typeof loadRulesForEvaluation>>
  let payments: EvaluablePayment[]
  try {
    loaded = await loadRulesForEvaluation(supabase, { createVendors: true })
    payments = await loadPaymentsForEvaluation(supabase, input.scope)
  } catch (error) {
    console.error('Failed to load rules or payments for a rule run preview', error)
    return { success: false, error: 'The rules and transactions could not be loaded. Nothing was changed.' }
  }

  const rule = loaded.rules.find((candidate) => candidate.id === input.ruleId)
  if (!rule) {
    return { success: false, error: 'That rule is not active. Switch it on before running it.' }
  }
  if (loaded.unresolvedVendorRuleIds.has(rule.id)) {
    return { success: false, error: 'The vendor this rule sets could not be looked up. Nothing was changed.' }
  }

  const now = new Date().toISOString()
  const preview: RuleRunPreview = {
    success: true,
    runId: null,
    ruleName: rule.name,
    scope: input.scope,
    lockDate: loaded.lockDate,
    reviewed: 0,
    matched: 0,
    planned: 0,
    statusChanges: 0,
    vendorChanges: 0,
    expenseChanges: 0,
    protectedCount: 0,
    locked: 0,
    outranked: 0,
    samples: [],
  }
  const plans: RuleChangePlan[] = []

  for (const payment of payments) {
    const evaluation = evaluatePaymentAgainstRules(payment, loaded.rules, {
      includeClosed: input.scope === 'all',
      targetRuleId: rule.id,
      lockDate: loaded.lockDate,
      matcher: loaded.matcher,
      unresolvedVendorRuleIds: loaded.unresolvedVendorRuleIds,
      now,
    })
    if (!evaluation.inScope) continue
    preview.reviewed += 1
    if (!evaluation.matched) continue

    preview.matched += 1
    if (evaluation.protectedByOwner) preview.protectedCount += 1
    if (evaluation.locked) preview.locked += 1
    if (!evaluation.winners.status && !evaluation.winners.vendor && !evaluation.winners.expense) {
      preview.outranked += 1
    }

    const plan = evaluation.plan
    if (!plan) continue
    plans.push(plan)
    if (plan.statusChanged) preview.statusChanges += 1
    if (plan.vendorChanged) preview.vendorChanges += 1
    if (plan.expenseChanged) preview.expenseChanges += 1
    if (preview.samples.length < SAMPLE_LIMIT) preview.samples.push(sampleOf(payment, plan))
  }

  preview.planned = plans.length
  if (!plans.length) {
    return preview
  }

  // An earlier preview of this rule by the same person that was never applied is replaced.
  const { error: cleanupError } = await (supabase as any)
    .from('receipt_rule_runs')
    .delete()
    .eq('rule_id', rule.id)
    .eq('created_by', userId)
    .in('status', ['drafting', 'previewed'])
  if (cleanupError) {
    console.error('Failed to clear earlier rule run previews', cleanupError)
  }

  const { data: run, error: runError } = await (supabase as any)
    .from('receipt_rule_runs')
    .insert({
      kind: 'rule_run',
      rule_id: rule.id,
      label: rule.name,
      scope: input.scope,
      rule_updated_at: rule.updated_at,
      ruleset_updated_at: loaded.rulesetUpdatedAt,
      ruleset_count: loaded.rulesetCount,
      lock_date: loaded.lockDate,
      status: 'drafting',
      reviewed_count: preview.reviewed,
      matched_count: preview.matched,
      protected_count: preview.protectedCount,
      locked_count: preview.locked,
      planned_count: plans.length,
      created_by: userId,
    })
    .select('id')
    .single()

  if (runError || !run) {
    console.error('Failed to store a rule run preview', runError)
    return { success: false, error: 'The preview could not be saved. Nothing was changed.' }
  }

  for (let index = 0; index < plans.length; index += CHANGE_INSERT_CHUNK) {
    const chunk = plans.slice(index, index + CHANGE_INSERT_CHUNK).map((plan) => ({
      run_id: run.id,
      transaction_id: plan.transactionId,
      expected_updated_at: plan.expectedUpdatedAt,
      after: plan.after,
      logs: plan.logs,
    }))
    const { error: changeError } = await (supabase as any).from('receipt_rule_run_changes').insert(chunk)
    if (changeError) {
      console.error('Failed to store rule run changes', changeError)
      // A half-written preview is never applied: it stays in drafting, and is removed here.
      await (supabase as any).from('receipt_rule_runs').delete().eq('id', run.id)
      return { success: false, error: 'The preview could not be saved. Nothing was changed.' }
    }
  }

  const { error: readyError } = await (supabase as any)
    .from('receipt_rule_runs')
    .update({ status: 'previewed' })
    .eq('id', run.id)
    .eq('status', 'drafting')
  if (readyError) {
    console.error('Failed to mark a rule run preview ready', readyError)
    return { success: false, error: 'The preview could not be saved. Nothing was changed.' }
  }

  preview.runId = run.id as string
  return preview
}

// ---------------------------------------------------------------------------
// A run a person started that is not a rule run: bulk apply, "accept all"
// ---------------------------------------------------------------------------

/** One planned change of a recorded run. */
export type RecordedRunChange = {
  transaction_id: string
  /** The payment's version when the plan was made. A payment changed since is skipped. */
  expected_updated_at: string
  after: Record<string, string | boolean | null>
  logs: Array<{ action_type: string; note: string }>
}

export type RecordedRunResult = {
  /** Present once the run exists. It is listed under Recent runs and can be undone there. */
  runId?: string
  applied: number
  skippedChanged: number
  skippedLocked: number
  /**
   * `not_recorded`: nothing was written at all. `stale`: the lock date changed while it ran.
   * `stopped`: it stopped part-way. In the last two, what was applied is recorded and undoable.
   */
  failure?: 'not_recorded' | 'stale' | 'stopped'
}

const MAX_RECORDED_RUN_STEPS = 50

/**
 * Records a set of changes as a run and applies it, the way a rule run is applied: each payment
 * is written only if it is unchanged and not behind the lock date, with its history row, and
 * what it replaced is kept so the run can be undone.
 */
export async function performRecordedRun(
  supabase: AdminClient,
  userId: string,
  input: {
    kind: 'bulk_apply' | 'ai_accept_all'
    label: string
    lockDate: string | null
    /** How many payments were looked at to make the plan. */
    reviewed: number
    changes: RecordedRunChange[]
  }
): Promise<RecordedRunResult> {
  const client = supabase as any
  const nothing = { applied: 0, skippedChanged: 0, skippedLocked: 0 }

  const { data: run, error: runError } = await client
    .from('receipt_rule_runs')
    .insert({
      kind: input.kind,
      label: input.label,
      scope: 'all',
      lock_date: input.lockDate,
      status: 'drafting',
      reviewed_count: input.reviewed,
      matched_count: input.changes.length,
      planned_count: input.changes.length,
      created_by: userId,
    })
    .select('id')
    .single()

  if (runError || !run) {
    console.error('Failed to record a run', runError)
    return { ...nothing, failure: 'not_recorded' }
  }

  const runId = run.id as string
  for (let index = 0; index < input.changes.length; index += CHANGE_INSERT_CHUNK) {
    const rows = input.changes.slice(index, index + CHANGE_INSERT_CHUNK).map((change) => ({ run_id: runId, ...change }))
    const { error } = await client.from('receipt_rule_run_changes').insert(rows)
    if (error) {
      console.error('Failed to store the changes of a run', error)
      await client.from('receipt_rule_runs').delete().eq('id', runId)
      return { ...nothing, failure: 'not_recorded' }
    }
  }

  const { error: readyError } = await client
    .from('receipt_rule_runs')
    .update({ status: 'previewed' })
    .eq('id', runId)
    .eq('status', 'drafting')
  if (readyError) {
    console.error('Failed to start a run', readyError)
    await client.from('receipt_rule_runs').delete().eq('id', runId)
    return { ...nothing, failure: 'not_recorded' }
  }

  let applied = 0
  let skippedChanged = 0
  let skippedLocked = 0
  for (let step = 0; step < MAX_RECORDED_RUN_STEPS; step += 1) {
    const { data, error } = await client.rpc('apply_receipt_rule_run', {
      p_run_id: runId,
      p_user: userId,
      p_limit: RULE_RUN_STEP_SIZE,
    })
    if (error || !data || (data.outcome !== 'in_progress' && data.outcome !== 'completed')) {
      console.error('A recorded run stopped', error ?? data)
      return {
        runId,
        applied,
        skippedChanged,
        skippedLocked,
        failure: data?.outcome === 'stale_preview' ? 'stale' : 'stopped',
      }
    }
    applied = Number(data.applied_total ?? 0)
    skippedChanged = Number(data.skipped_changed_total ?? 0)
    skippedLocked = Number(data.skipped_locked_total ?? 0)
    if (data.outcome === 'completed') {
      return { runId, applied, skippedChanged, skippedLocked }
    }
  }

  // More steps than a run should ever need: say it stopped, never that it finished.
  return { runId, applied, skippedChanged, skippedLocked, failure: 'stopped' }
}

export type RuleRunRecord = {
  id: string
  kind: 'rule_run' | 'bulk_apply' | 'ai_accept_all'
  ruleId: string | null
  label: string | null
  scope: RuleRunScope
  status: 'drafting' | 'previewed' | 'running' | 'completed' | 'stopped' | 'undone'
  stopReason: string | null
  planned: number
  applied: number
  skippedChanged: number
  skippedLocked: number
  undone: number
  undoConflicts: number
  createdBy: string | null
  createdAt: string
  completedAt: string | null
  undoneAt: string | null
}

type RunRow = {
  id: string
  kind: RuleRunRecord['kind']
  rule_id: string | null
  label: string | null
  scope: RuleRunScope
  status: RuleRunRecord['status']
  stop_reason: string | null
  planned_count: number
  applied_count: number
  skipped_changed_count: number
  skipped_locked_count: number
  undone_count: number
  undo_conflict_count: number
  created_by: string | null
  created_at: string
  completed_at: string | null
  undone_at: string | null
}

const RUN_COLUMNS =
  'id, kind, rule_id, label, scope, status, stop_reason, planned_count, applied_count, skipped_changed_count, skipped_locked_count, undone_count, undo_conflict_count, created_by, created_at, completed_at, undone_at'

function toRunRecord(row: RunRow): RuleRunRecord {
  return {
    id: row.id,
    kind: row.kind,
    ruleId: row.rule_id,
    label: row.label,
    scope: row.scope,
    status: row.status,
    stopReason: row.stop_reason,
    planned: row.planned_count,
    applied: row.applied_count,
    skippedChanged: row.skipped_changed_count,
    skippedLocked: row.skipped_locked_count,
    undone: row.undone_count,
    undoConflicts: row.undo_conflict_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    undoneAt: row.undone_at,
  }
}

export async function queryReceiptRuleRun(runId: string): Promise<RuleRunRecord | null> {
  if (!UUID_PATTERN.test(runId)) return null
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('receipt_rule_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    .maybeSingle()
  if (error) {
    throw new Error(`Failed to load receipt rule run: ${error.message}`)
  }
  return data ? toRunRecord(data as RunRow) : null
}

/** The runs that changed something, newest first. Previews that were never applied are left out. */
export async function queryRecentReceiptRuleRuns(limit = 20): Promise<RuleRunRecord[]> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any)
    .from('receipt_rule_runs')
    .select(RUN_COLUMNS)
    .in('status', ['running', 'completed', 'stopped', 'undone'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    throw new Error(`Failed to load receipt rule runs: ${error.message}`)
  }
  return ((data ?? []) as RunRow[]).map(toRunRecord)
}

const STALE_PREVIEW_MESSAGE: Record<string, string> = {
  rule_changed: 'The rule has been changed since it was previewed. Preview it again.',
  rules_changed: 'Another rule has been changed since the preview, which can alter which rule wins. Preview it again.',
  lock_date_changed: 'The lock date has been changed since the preview. Preview it again.',
}

export type RuleRunStep =
  | {
      success: true
      done: boolean
      applied: number
      skippedChanged: number
      skippedLocked: number
      remaining: number
      appliedTotal: number
      skippedChangedTotal: number
      skippedLockedTotal: number
    }
  | { success: false; error: string; stale?: boolean }

export async function performApplyReceiptRuleRunStep(userId: string, runId: string): Promise<RuleRunStep> {
  if (!UUID_PATTERN.test(runId)) {
    return { success: false, error: 'Preview the rule first.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('apply_receipt_rule_run', {
    p_run_id: runId,
    p_user: userId,
    p_limit: RULE_RUN_STEP_SIZE,
  })

  if (error || !data) {
    console.error('Failed to apply a receipt rule run step', error)
    return { success: false, error: 'The run could not continue. What was applied so far is recorded and can be undone.' }
  }

  switch (data.outcome) {
    case 'in_progress':
    case 'completed':
      return {
        success: true,
        done: data.outcome === 'completed',
        applied: Number(data.applied ?? 0),
        skippedChanged: Number(data.skipped_changed ?? 0),
        skippedLocked: Number(data.skipped_locked ?? 0),
        remaining: Number(data.remaining ?? 0),
        appliedTotal: Number(data.applied_total ?? 0),
        skippedChangedTotal: Number(data.skipped_changed_total ?? 0),
        skippedLockedTotal: Number(data.skipped_locked_total ?? 0),
      }
    case 'stale_preview':
      return {
        success: false,
        stale: true,
        error: STALE_PREVIEW_MESSAGE[data.reason as string] ?? 'The preview is out of date. Preview the rule again.',
      }
    case 'undone':
      return { success: false, error: 'That run has been undone. Preview the rule again to run it.' }
    case 'not_ready':
      return { success: false, error: 'The preview was not finished. Preview the rule again.' }
    default:
      return { success: false, error: 'That preview no longer exists. Preview the rule again.' }
  }
}

export type RuleRunUndoStep =
  | { success: true; done: boolean; restored: number; conflicts: number; remaining: number; restoredTotal: number; conflictTotal: number }
  | { success: false; error: string }

export async function performUndoReceiptRuleRunStep(userId: string, runId: string): Promise<RuleRunUndoStep> {
  if (!UUID_PATTERN.test(runId)) {
    return { success: false, error: 'Choose a run to undo.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('undo_receipt_rule_run', {
    p_run_id: runId,
    p_user: userId,
    p_limit: RULE_RUN_STEP_SIZE,
  })

  if (error || !data) {
    console.error('Failed to undo a receipt rule run step', error)
    return { success: false, error: 'The undo could not continue. What was put back so far is recorded.' }
  }

  switch (data.outcome) {
    case 'in_progress':
    case 'undone':
    case 'already_undone':
      return {
        success: true,
        done: data.outcome !== 'in_progress',
        restored: Number(data.restored ?? 0),
        conflicts: Number(data.conflicts ?? 0),
        remaining: Number(data.remaining ?? 0),
        restoredTotal: Number(data.restored_total ?? 0),
        conflictTotal: Number(data.conflict_total ?? 0),
      }
    case 'nothing_to_undo':
      return { success: false, error: 'That run changed nothing, so there is nothing to undo.' }
    default:
      return { success: false, error: 'That run no longer exists.' }
  }
}

// ---------------------------------------------------------------------------
// Rule health, the test box and the matcher comparison
// ---------------------------------------------------------------------------

export type ReceiptRuleHealth = {
  reviewed: number
  matcher: RuleMatcherMode
  items: RuleHealthItem[]
}

/** How each rule is doing, worked out by running the matcher over every payment. */
export async function queryReceiptRuleHealth(): Promise<ReceiptRuleHealth> {
  const supabase = createAdminClient()
  const loaded = await loadRulesForEvaluation(supabase, { createVendors: false })
  const payments = await loadPaymentsForEvaluation(supabase, 'all')
  return {
    reviewed: payments.length,
    matcher: loaded.matcher,
    items: computeRuleHealth(payments, loaded.rules, { matcher: loaded.matcher, today: getTodayIsoDate() }),
  }
}

export async function queryReceiptRuleTest(input: {
  details: string
  transactionType?: string | null
  direction: 'in' | 'out'
  amount: number
}): Promise<RuleMatchExplanation & { matcher: RuleMatcherMode }> {
  const supabase = createAdminClient()
  const loaded = await loadRulesForEvaluation(supabase, { createVendors: false })
  return { ...explainRuleMatch(input, loaded.rules, loaded.matcher), matcher: loaded.matcher }
}

const COMPARISON_ROW_LIMIT = 200

/** Which payments a different rule would decide under whole-word matching. Changes nothing. */
export async function queryRuleMatcherComparison(): Promise<MatcherComparison & { matcher: RuleMatcherMode; truncated: boolean }> {
  const supabase = createAdminClient()
  const loaded = await loadRulesForEvaluation(supabase, { createVendors: false })
  const payments = await loadPaymentsForEvaluation(supabase, 'all')
  const comparison = compareRuleMatchers(payments, loaded.rules)
  return {
    ...comparison,
    differences: comparison.differences.slice(0, COMPARISON_ROW_LIMIT),
    truncated: comparison.differences.length > COMPARISON_ROW_LIMIT,
    matcher: loaded.matcher,
  }
}
