import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { getRuleMatch } from '@/lib/receipts/rule-matching'
import { findDuplicateRule } from '@/lib/receipts/rule-identity'
import type {
  ReceiptClassificationSignal,
  ReceiptRule,
  ReceiptRuleConflict,
  ReceiptRuleSuggestion,
  ReceiptTransaction,
} from '@/types/database'
import type { AdminClient } from './types'
import { loadReceiptSettings } from './receiptSettings'
import { checkSuggestionsAgainstPayments, type SuggestionCheck } from './receiptRuleProposals'
import { getTransactionDirection, guessAmountValue } from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'

type SignalInsert = Omit<ReceiptClassificationSignal, 'id'> & {
  payload?: Record<string, unknown>
}

type SuggestionApprovalOptions = {
  active?: boolean
}

type ConflictTransactionRow = Pick<
  ReceiptTransaction,
  'id' | 'details' | 'transaction_type' | 'amount_in' | 'amount_out'
>

export async function recordReceiptClassificationSignals(
  supabase: AdminClient,
  signals: SignalInsert[]
): Promise<void> {
  if (!signals.length) return

  const payload = signals.map((signal) => ({
    ...signal,
    payload: signal.payload ?? {},
  }))

  const { error } = await supabase
    .from('receipt_classification_signals')
    .insert(payload as any)

  if (error) {
    console.error('Failed to record receipt classification signals', error)
  }
}

const SUGGESTIONS_PAGE_SIZE = 20

export async function queryReceiptGovernanceItems(
  options: {
    page?: number
    pageSize?: number
    /**
     * Run each suggestion's keyword over every payment now. Costs a read of every payment, so
     * the workspace does not ask for it; the proposals panel does when it is opened.
     */
    liveChecks?: boolean
  } = {}
): Promise<{
  conflicts: ReceiptRuleConflict[]
  suggestions: ReceiptRuleSuggestion[]
  suggestionsTotal: number
}> {
  const supabase = createAdminClient()
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : SUGGESTIONS_PAGE_SIZE
  const page = options.page && options.page > 0 ? options.page : 1
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const [
    { data: conflicts, error: conflictsError },
    { data: suggestions, error: suggestionsError, count: suggestionsCount },
  ] = await Promise.all([
    supabase
      .from('receipt_rule_conflicts')
      .select('*')
      .is('resolved_at', null)
      .order('overlap_count', { ascending: false })
      .order('detected_at', { ascending: false })
      .limit(50),
    supabase
      .from('receipt_rule_suggestions')
      .select('*', { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .range(from, to),
  ])

  if (conflictsError) {
    console.error('Failed to load receipt rule conflicts', conflictsError)
  }

  if (suggestionsError) {
    console.error('Failed to load receipt rule suggestions', suggestionsError)
  }

  // What a suggestion would match, and how many of those payments belong to another vendor. The
  // figures stored when it was raised are shown unless live ones are asked for.
  const suggestionRows = (suggestions ?? []) as ReceiptRuleSuggestion[]
  let enrichedSuggestions = suggestionRows
  if (options.liveChecks && suggestionRows.length) {
    const checks = await checkSuggestionsAgainstPayments(supabase, suggestionRows)
    enrichedSuggestions = suggestionRows.map((suggestion) => {
      const check = checks.get(suggestion.id)
      return check
        ? {
            ...suggestion,
            evidence: {
              ...(suggestion.evidence ?? {}),
              preview_match_count: check.matchCount,
              collision_count: check.collisions,
              checked_live: true,
            },
          }
        : suggestion
    })
  }

  return {
    conflicts: (conflicts ?? []) as ReceiptRuleConflict[],
    suggestions: enrichedSuggestions,
    suggestionsTotal: suggestionsCount ?? enrichedSuggestions.length,
  }
}

export async function performDetectReceiptRuleConflicts(): Promise<{
  checkedRules: number
  checkedTransactions: number
  conflicts: number
}> {
  const supabase = createAdminClient()
  // Every transaction, not a sample. The old single request returned the newest
  // 1,000 of 8,202, so the overlap warnings staff act on were drawn from about
  // 12% of the history. `id` is the unique tiebreak that keeps the page
  // boundaries stable.
  const [{ data: rules, error: rulesError }, txRows] = await Promise.all([
    supabase
      .from('receipt_rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true }),
    fetchAllRows<ConflictTransactionRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, details, transaction_type, amount_in, amount_out')
          .order('transaction_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      { maxRows: 20000, label: 'receipt rule conflict transactions' },
    ),
  ])

  if (rulesError) {
    throw new Error(`Failed to load receipt rules: ${rulesError.message}`)
  }

  const activeRules = (rules ?? []) as ReceiptRule[]
  const { matcher } = await loadReceiptSettings(supabase)
  // Two rules are in conflict only when nothing separates them: the same priority, and a
  // different result. Where the priorities differ the higher one wins by design, and where the
  // results are the same it does not matter which wins.
  const sameResult = (left: ReceiptRule, right: ReceiptRule) =>
    left.auto_status === right.auto_status &&
    (left.vendor_id ?? normalizeReceiptVendorKey(left.set_vendor_name)) ===
      (right.vendor_id ?? normalizeReceiptVendorKey(right.set_vendor_name)) &&
    (left.set_expense_category ?? null) === (right.set_expense_category ?? null)
  const pairMap = new Map<string, {
    ruleId: string
    overlappingRuleId: string
    overlapCount: number
    samePriority: boolean
    sampleTransactionIds: string[]
  }>()

  for (const tx of txRows) {
    const direction = getTransactionDirection(tx as ReceiptTransaction)
    const amountValue = guessAmountValue(tx as ReceiptTransaction)
    const matches = activeRules.filter((rule) =>
      getRuleMatch(rule, tx, { direction, amountValue, matcher }).matched
    )

    for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
        const [left, right] = [matches[leftIndex], matches[rightIndex]].sort((a, b) => a.id.localeCompare(b.id))
        if ((left.priority ?? 1000) !== (right.priority ?? 1000) || sameResult(left, right)) continue
        const key = `${left.id}:${right.id}`
        const existing = pairMap.get(key) ?? {
          ruleId: left.id,
          overlappingRuleId: right.id,
          overlapCount: 0,
          samePriority: (left.priority ?? 1000) === (right.priority ?? 1000),
          sampleTransactionIds: [],
        }
        existing.overlapCount += 1
        if (existing.sampleTransactionIds.length < 10) {
          existing.sampleTransactionIds.push(tx.id)
        }
        pairMap.set(key, existing)
      }
    }
  }

  const now = new Date().toISOString()
  await supabase
    .from('receipt_rule_conflicts')
    .update({ resolved_at: now })
    .is('resolved_at', null)

  const conflicts = Array.from(pairMap.values())
    .filter((entry) => entry.overlapCount > 0)
    .map((entry) => ({
      rule_id: entry.ruleId,
      overlapping_rule_id: entry.overlappingRuleId,
      overlap_count: entry.overlapCount,
      same_priority: entry.samePriority,
      sample_transaction_ids: entry.sampleTransactionIds,
      detected_at: now,
      resolved_at: null,
    }))

  if (conflicts.length) {
    const { error: upsertError } = await supabase
      .from('receipt_rule_conflicts')
      .upsert(conflicts, { onConflict: 'rule_id,overlapping_rule_id' })

    if (upsertError) {
      throw new Error(`Failed to persist receipt rule conflicts: ${upsertError.message}`)
    }
  }

  return {
    checkedRules: activeRules.length,
    checkedTransactions: txRows.length,
    conflicts: conflicts.length,
  }
}

/** Why a suggestion cannot be approved as it stands, or what kind of approval it is. */
type ApprovalGuard = { error: string } | { kind: 'new_rule' | 'add_category' }

const CATEGORY_APPROVAL_REFUSALS: Record<string, string> = {
  not_found: 'That suggestion no longer exists.',
  not_pending: 'That suggestion has already been approved or declined.',
  rule_unavailable: 'The rule this suggestion adds to has been switched off or removed. Decline the suggestion.',
  rule_has_category: 'The rule this suggestion adds to already sets a different category. Decline the suggestion.',
}

/**
 * The checks a suggestion must pass at the moment it is approved, whatever it showed when it
 * was raised:
 *  - it must not make a rule identical to one that exists, on or off;
 *  - its keyword must not also match payments that belong to a different vendor.
 * `checks` carries the live counts when the caller has worked them out for several at once.
 */
async function guardSuggestionApproval(
  supabase: AdminClient,
  suggestionId: string,
  checks?: Map<string, SuggestionCheck>
): Promise<ApprovalGuard> {
  const [{ data: suggestion, error: suggestionError }, { data: rules, error: rulesError }] = await Promise.all([
    supabase.from('receipt_rule_suggestions').select('*').eq('id', suggestionId).maybeSingle(),
    supabase.from('receipt_rules').select('*'),
  ])

  if (suggestionError || rulesError) {
    console.error('Failed to check a rule suggestion before approval', suggestionError ?? rulesError)
    return { error: 'The existing rules could not be checked. The suggestion was not approved.' }
  }
  // Already approved, or gone: the database function answers for those.
  if (!suggestion || suggestion.status !== 'pending') return { kind: 'new_rule' }

  const evidence = (suggestion.evidence ?? {}) as Record<string, unknown>
  if (evidence.kind === 'add_category') return { kind: 'add_category' }

  const duplicate = findDuplicateRule((rules ?? []) as ReceiptRule[], {
    match_description: suggestion.match_description,
    // An approved suggestion never carries a bank transaction type.
    match_transaction_type: null,
    match_direction: suggestion.match_direction,
    match_min_amount: suggestion.match_min_amount,
    match_max_amount: suggestion.match_max_amount,
    set_vendor_name: suggestion.set_vendor_name,
    vendor_id: suggestion.set_vendor_id,
    set_expense_category: suggestion.set_expense_category,
    auto_status: suggestion.auto_status,
  })
  if (duplicate) {
    return {
      error: duplicate.is_active
        ? `A rule with the same match and result already exists: "${duplicate.name}". Decline this suggestion.`
        : `A rule with the same match and result already exists but is switched off: "${duplicate.name}". Switch that one on, or decline this suggestion.`,
    }
  }

  // Only a suggestion that names a vendor can take another vendor's payments.
  if (suggestion.set_vendor_id) {
    let check = checks?.get(suggestionId)
    if (!check) {
      try {
        check = (await checkSuggestionsAgainstPayments(supabase, [suggestion as ReceiptRuleSuggestion])).get(suggestionId)
      } catch (checkError) {
        console.error('Failed to check a rule suggestion against the payments', checkError)
        return { error: 'The suggestion could not be checked against the transactions. It was not approved.' }
      }
    }
    if (check && check.collisions > 0) {
      return {
        error: `This keyword also matches ${check.collisions} transaction${check.collisions === 1 ? '' : 's'} that belong${check.collisions === 1 ? 's' : ''} to another vendor. Make it more specific as a new rule, then decline this suggestion.`,
      }
    }
  }

  return { kind: 'new_rule' }
}

/** Approves "add this category to the existing rule": the rule and the suggestion change together. */
async function approveCategorySuggestion(
  supabase: AdminClient,
  userId: string,
  suggestionId: string
): Promise<{ ruleId?: string; error?: string }> {
  const { data, error } = await (supabase as any).rpc('approve_receipt_rule_category_suggestion', {
    p_suggestion_id: suggestionId,
    p_user: userId,
  })
  if (error || !data) {
    console.error('Failed to approve a category suggestion', error)
    return { error: 'The category could not be added to the rule.' }
  }
  if (data.outcome !== 'approved') {
    return { error: CATEGORY_APPROVAL_REFUSALS[data.outcome as string] ?? 'The category could not be added to the rule.' }
  }
  return { ruleId: data.rule_id as string }
}

export async function performApproveReceiptRuleSuggestion(
  userId: string,
  suggestionId: string,
  options: SuggestionApprovalOptions = {}
): Promise<{ success?: boolean; rule?: ReceiptRule; error?: string }> {
  const supabase = createAdminClient()

  const guard = await guardSuggestionApproval(supabase, suggestionId)
  if ('error' in guard) {
    return { error: guard.error }
  }

  let ruleId: string | null = null
  if (guard.kind === 'add_category') {
    const approved = await approveCategorySuggestion(supabase, userId, suggestionId)
    if (approved.error || !approved.ruleId) {
      return { error: approved.error ?? 'The category could not be added to the rule.' }
    }
    ruleId = approved.ruleId
  } else {
    // Atomic approval: the RPC inserts the rule and marks the suggestion approved in a
    // single Postgres transaction (it also nulls the bank transaction_type). A failure
    // can no longer leave a rule with a still-pending suggestion.
    const { data, error: rpcError } = await supabase.rpc('approve_receipt_rule_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: userId,
      p_active: options.active ?? true,
    })

    if (rpcError || !data) {
      console.error('Failed to approve receipt rule suggestion', rpcError)
      return { error: 'Failed to create rule from suggestion.' }
    }
    ruleId = data as string
  }

  const { data: rule, error: ruleError } = await supabase
    .from('receipt_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle()

  if (ruleError || !rule) {
    console.error('Failed to re-fetch approved receipt rule', ruleError)
  }

  // Re-fetch the suggestion to record signals against its evidence (the RPC has already
  // transitioned it to approved, so this is read-only).
  const { data: suggestion, error: suggestionError } = await supabase
    .from('receipt_rule_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .maybeSingle()

  if (suggestionError) {
    console.error('Failed to re-fetch approved receipt rule suggestion', suggestionError)
  }

  if (suggestion) {
    const now = new Date().toISOString()
    const vendorId = suggestion.set_vendor_id ?? null
    const evidenceIds: string[] = Array.isArray(suggestion.evidence_transaction_ids)
      ? suggestion.evidence_transaction_ids.filter((value: unknown): value is string => typeof value === 'string')
      : []

    await recordReceiptClassificationSignals(
      supabase,
      evidenceIds.map((transactionId) => ({
        transaction_id: transactionId,
        source: 'system',
        signal_type: 'rule_suggestion_approved',
        prior_vendor_id: null,
        new_vendor_id: vendorId,
        prior_vendor_name: null,
        new_vendor_name: suggestion.set_vendor_name,
        prior_expense_category: null,
        new_expense_category: suggestion.set_expense_category,
        prior_status: null,
        new_status: null,
        rule_id: ruleId,
        ai_confidence: null,
        performed_by: userId,
        performed_at: now,
        payload: { suggestion_id: suggestion.id },
      }))
    )
  }

  // NOTE: the rule re-run (refreshAutomationForPendingTransactions) is intentionally
  // triggered from the action layer (src/app/actions/receipts.ts) rather than here.
  // receiptMutations.ts imports from this file, so importing the refresh here would
  // create a circular dependency. The action calls it after this returns success.
  return { success: true, rule: (rule ?? undefined) as ReceiptRule | undefined }
}

export async function performApproveReceiptRuleSuggestions(
  userId: string,
  ids: string[],
  options: SuggestionApprovalOptions = {}
): Promise<{ approved: number; failed: number }> {
  const supabase = createAdminClient()
  let approved = 0
  let failed = 0

  // One read of the payments checks every selected suggestion's keyword.
  let checks: Map<string, SuggestionCheck> | undefined
  try {
    const { data: selected, error: selectedError } = await supabase
      .from('receipt_rule_suggestions')
      .select('id, match_description, set_vendor_id')
      .in('id', ids)
    if (selectedError) throw new Error(selectedError.message)
    checks = await checkSuggestionsAgainstPayments(
      supabase,
      ((selected ?? []) as Array<Pick<ReceiptRuleSuggestion, 'id' | 'match_description' | 'set_vendor_id'>>).filter(
        (suggestion) => Boolean(suggestion.set_vendor_id)
      )
    )
  } catch (checkError) {
    console.error('Failed to check rule suggestions against the payments (bulk)', checkError)
    return { approved: 0, failed: ids.length }
  }

  for (const suggestionId of ids) {
    // Checked one at a time, so the second of two identical suggestions is caught by the first.
    const guard = await guardSuggestionApproval(supabase, suggestionId, checks)
    if ('error' in guard) {
      failed += 1
      continue
    }

    if (guard.kind === 'add_category') {
      const result = await approveCategorySuggestion(supabase, userId, suggestionId)
      if (result.error) failed += 1
      else approved += 1
      continue
    }

    // Each RPC call is its own atomic transaction; a failing id does not abort the rest.
    const { data: ruleId, error: rpcError } = await supabase.rpc('approve_receipt_rule_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: userId,
      p_active: options.active ?? true,
    })

    if (rpcError || !ruleId) {
      console.error('Failed to approve receipt rule suggestion (bulk)', { suggestionId, error: rpcError })
      failed += 1
      continue
    }

    approved += 1
  }

  return { approved, failed }
}

export async function performDeclineReceiptRuleSuggestion(
  userId: string,
  suggestionId: string,
  reason?: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = createAdminClient()
  const { data: updated, error } = await supabase
    .from('receipt_rule_suggestions')
    .update({
      status: 'declined',
      declined_reason: reason?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq('id', suggestionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Failed to decline receipt rule suggestion', error)
    return { error: 'Failed to decline suggestion.' }
  }

  if (!updated) {
    return { error: 'Suggestion not found or already reviewed.' }
  }

  return { success: true }
}

export async function performRefreshReceiptDuplicateCandidates(): Promise<{ success?: boolean; error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('refresh_receipt_duplicate_candidates')

  if (error) {
    console.error('Failed to refresh receipt duplicate candidates', error)
    return { error: 'Failed to refresh duplicate candidates.' }
  }

  return { success: true }
}
