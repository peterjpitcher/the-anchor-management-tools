import { createAdminClient } from '@/lib/supabase/admin'
import { getRuleMatch } from '@/lib/receipts/rule-matching'
import type {
  ReceiptClassificationSignal,
  ReceiptExpenseCategory,
  ReceiptRule,
  ReceiptRuleConflict,
  ReceiptRuleSuggestion,
  ReceiptTransaction,
} from '@/types/database'
import type { AdminClient } from './types'
import {
  buildRuleSuggestion,
  getTransactionDirection,
  guessAmountValue,
  normalizeVendorInput,
} from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'

type SignalInsert = Omit<ReceiptClassificationSignal, 'id'> & {
  payload?: Record<string, unknown>
}

type SuggestionApprovalOptions = {
  active?: boolean
}

export async function resolveReceiptVendorId(
  supabase: AdminClient,
  vendorName: string | null | undefined
): Promise<string | null> {
  const normalizedName = normalizeVendorInput(vendorName ?? null)
  const vendorKey = normalizeReceiptVendorKey(normalizedName)

  if (!normalizedName || !vendorKey) {
    return null
  }

  const { data: existing, error: existingError } = await supabase
    .from('receipt_vendors')
    .select('id')
    .eq('vendor_key', vendorKey)
    .maybeSingle()

  if (existingError) {
    console.warn('Failed to resolve receipt vendor', existingError)
  }

  if (existing?.id) {
    const { error: aliasError } = await supabase
      .from('receipt_vendor_aliases')
      .insert({
        vendor_id: existing.id,
        alias: normalizedName,
        alias_key: vendorKey,
        source: 'system',
        confidence: 100,
      })
    if (aliasError && aliasError.code !== '23505') {
      console.warn('Failed to create receipt vendor alias', aliasError)
    }

    return existing.id
  }

  const { data: created, error: createError } = await supabase
    .from('receipt_vendors')
    .insert({
      canonical_name: normalizedName,
      vendor_key: vendorKey,
      status: 'unconfirmed',
    })
    .select('id')
    .maybeSingle()

  if (createError || !created?.id) {
    console.warn('Failed to create receipt vendor', createError)
    return null
  }

  const { error: aliasError } = await supabase
    .from('receipt_vendor_aliases')
    .insert({
      vendor_id: created.id,
      alias: normalizedName,
      alias_key: vendorKey,
      source: 'system',
      confidence: 100,
    })
  if (aliasError && aliasError.code !== '23505') {
    console.warn('Failed to create receipt vendor alias', aliasError)
  }

  return created.id
}

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

export async function queryReceiptGovernanceItems(): Promise<{
  conflicts: ReceiptRuleConflict[]
  suggestions: ReceiptRuleSuggestion[]
}> {
  const supabase = createAdminClient()
  const [{ data: conflicts, error: conflictsError }, { data: suggestions, error: suggestionsError }] = await Promise.all([
    supabase
      .from('receipt_rule_conflicts')
      .select('*')
      .is('resolved_at', null)
      .order('overlap_count', { ascending: false })
      .order('detected_at', { ascending: false })
      .limit(50),
    supabase
      .from('receipt_rule_suggestions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (conflictsError) {
    console.error('Failed to load receipt rule conflicts', conflictsError)
  }

  if (suggestionsError) {
    console.error('Failed to load receipt rule suggestions', suggestionsError)
  }

  return {
    conflicts: (conflicts ?? []) as ReceiptRuleConflict[],
    suggestions: (suggestions ?? []) as ReceiptRuleSuggestion[],
  }
}

export async function performDetectReceiptRuleConflicts(): Promise<{
  checkedRules: number
  checkedTransactions: number
  conflicts: number
}> {
  const supabase = createAdminClient()
  const [{ data: rules, error: rulesError }, { data: transactions, error: transactionsError }] = await Promise.all([
    supabase
      .from('receipt_rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('receipt_transactions')
      .select('id, details, transaction_type, amount_in, amount_out')
      .order('transaction_date', { ascending: false })
      .limit(2000),
  ])

  if (rulesError) {
    throw new Error(`Failed to load receipt rules: ${rulesError.message}`)
  }

  if (transactionsError) {
    throw new Error(`Failed to load receipt transactions: ${transactionsError.message}`)
  }

  const activeRules = (rules ?? []) as ReceiptRule[]
  const txRows = (transactions ?? []) as Array<Pick<ReceiptTransaction, 'id' | 'details' | 'transaction_type' | 'amount_in' | 'amount_out'>>
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
      getRuleMatch(rule, tx, { direction, amountValue }).matched
    )

    for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
        const [left, right] = [matches[leftIndex], matches[rightIndex]].sort((a, b) => a.id.localeCompare(b.id))
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

type SuggestionSource = 'manual_corrections' | 'ai_classification'

export function suggestionDedupeKey(parts: {
  matchDescription: string | null
  direction: string
  vendorName: string | null
  expenseCategory: string | null
}): string {
  return [
    normalizeReceiptVendorKey(parts.matchDescription),
    parts.direction ?? 'both',
    normalizeReceiptVendorKey(parts.vendorName),
    parts.expenseCategory ?? '',
  ].join('|')
}

// Builds receipt_rule_suggestions insert rows from (transaction, vendor, expense) inputs.
// minOccurrences: manual=2, ai=1. existingKeys must already include active rules + pending/approved suggestions.
export function buildRuleSuggestionInserts(
  inputs: Array<{ transaction: ReceiptTransaction; vendorName: string | null; expenseCategory: ReceiptExpenseCategory | null; suggestedRuleKeywords: string | null; confidence: number | null }>,
  opts: { source: SuggestionSource; minOccurrences: number; existingKeys: Set<string>; cap: number }
): any[] {
  const groups = new Map<string, { suggestion: NonNullable<ReturnType<typeof buildRuleSuggestion>>; transactionIds: string[]; confidence: number | null }>()
  for (const input of inputs) {
    const suggestion = buildRuleSuggestion(input.transaction, {
      vendorName: input.vendorName, expenseCategory: input.expenseCategory, suggestedRuleKeywords: input.suggestedRuleKeywords,
    })
    if (!suggestion?.matchDescription) continue
    const key = suggestionDedupeKey({ matchDescription: suggestion.matchDescription, direction: suggestion.direction, vendorName: suggestion.setVendorName, expenseCategory: suggestion.setExpenseCategory })
    if (opts.existingKeys.has(key)) continue
    const group = groups.get(key) ?? { suggestion, transactionIds: [], confidence: input.confidence }
    group.transactionIds.push(input.transaction.id)
    group.confidence = group.confidence ?? input.confidence
    groups.set(key, group)
  }
  return Array.from(groups.values())
    .filter((g) => g.transactionIds.length >= opts.minOccurrences)
    .slice(0, opts.cap)
    .map((g) => ({
      suggested_name: g.suggestion.suggestedName,
      match_description: g.suggestion.matchDescription,
      match_transaction_type: null,
      match_direction: g.suggestion.direction,
      set_vendor_name: g.suggestion.setVendorName,
      set_expense_category: g.suggestion.setExpenseCategory,
      auto_status: 'pending',
      evidence_transaction_ids: g.transactionIds.slice(0, 20),
      evidence: { source: opts.source, transaction_count: g.transactionIds.length, details_sample: g.suggestion.details, ai_confidence: g.confidence },
    }))
}

// Count transactions a proposed rule's criteria would match (impact preview).
export async function previewSuggestionMatchCount(
  supabase: AdminClient,
  criteria: { match_description: string | null; match_direction: string }
): Promise<number> {
  if (!criteria.match_description) return 0
  const needles = criteria.match_description.split(',').map((n) => n.trim()).filter(Boolean)
  if (!needles.length) return 0
  const or = needles.map((n) => `details.ilike.%${n}%`).join(',')
  let q = supabase.from('receipt_transactions').select('id', { count: 'exact', head: true }).or(or)
  if (criteria.match_direction === 'out') q = q.not('amount_out', 'is', null)
  else if (criteria.match_direction === 'in') q = q.not('amount_in', 'is', null)
  const { count } = await q
  return count ?? 0
}

export async function performSuggestReceiptRules(): Promise<{
  reviewed: number
  created: number
}> {
  const supabase = createAdminClient()
  const [{ data: transactions, error: txError }, { data: existingSuggestions }, { data: rules }] = await Promise.all([
    supabase
      .from('receipt_transactions')
      .select('*')
      .or('vendor_source.eq.manual,expense_category_source.eq.manual')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabase
      .from('receipt_rule_suggestions')
      .select('match_description, match_direction, set_vendor_name, set_expense_category, status')
      .in('status', ['pending', 'approved']),
    supabase
      .from('receipt_rules')
      .select('match_description, match_direction, set_vendor_name, set_expense_category')
      .eq('is_active', true),
  ])

  if (txError) {
    throw new Error(`Failed to load manually classified receipt transactions: ${txError.message}`)
  }

  const existingKeys = new Set<string>()
  ;[...(existingSuggestions ?? []), ...(rules ?? [])].forEach((row: any) => {
    existingKeys.add(suggestionDedupeKey({
      matchDescription: row.match_description,
      direction: row.match_direction,
      vendorName: row.set_vendor_name,
      expenseCategory: row.set_expense_category,
    }))
  })

  const inputs = ((transactions ?? []) as ReceiptTransaction[]).map((transaction) => ({
    transaction,
    vendorName: transaction.vendor_source === 'manual' ? transaction.vendor_name : null,
    expenseCategory: transaction.expense_category_source === 'manual' ? transaction.expense_category : null,
    suggestedRuleKeywords: transaction.ai_suggested_keywords,
    confidence: null,
  }))

  const inserts = buildRuleSuggestionInserts(inputs, {
    source: 'manual_corrections',
    minOccurrences: 2,
    existingKeys,
    cap: 10,
  })

  if (!inserts.length) {
    return { reviewed: (transactions ?? []).length, created: 0 }
  }

  const { error: insertError } = await supabase
    .from('receipt_rule_suggestions')
    .insert(inserts)

  if (insertError) {
    throw new Error(`Failed to create receipt rule suggestions: ${insertError.message}`)
  }

  return {
    reviewed: (transactions ?? []).length,
    created: inserts.length,
  }
}

export async function performApproveReceiptRuleSuggestion(
  userId: string,
  suggestionId: string,
  options: SuggestionApprovalOptions = {}
): Promise<{ success?: boolean; rule?: ReceiptRule; error?: string }> {
  const supabase = createAdminClient()
  const { data: suggestion, error: suggestionError } = await supabase
    .from('receipt_rule_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('status', 'pending')
    .maybeSingle()

  if (suggestionError) {
    return { error: 'Failed to load suggestion.' }
  }

  if (!suggestion) {
    return { error: 'Suggestion not found or already reviewed.' }
  }

  const vendorId = suggestion.set_vendor_id ?? await resolveReceiptVendorId(supabase, suggestion.set_vendor_name)
  const now = new Date().toISOString()

  const { data: rule, error: insertError } = await supabase
    .from('receipt_rules')
    .insert({
      name: suggestion.suggested_name,
      description: 'Created from receipt rule suggestion evidence.',
      match_description: suggestion.match_description,
      match_transaction_type: suggestion.match_transaction_type,
      match_direction: suggestion.match_direction,
      match_min_amount: suggestion.match_min_amount,
      match_max_amount: suggestion.match_max_amount,
      auto_status: suggestion.auto_status,
      set_vendor_name: suggestion.set_vendor_name,
      set_expense_category: suggestion.set_expense_category,
      vendor_id: vendorId,
      priority: 1000,
      kind: 'standard',
      is_active: options.active ?? true,
      created_by: userId,
      updated_by: userId,
      reviewed_at: now,
      reviewed_by: userId,
    })
    .select('*')
    .maybeSingle()

  if (insertError || !rule) {
    console.error('Failed to approve receipt rule suggestion', insertError)
    return { error: 'Failed to create rule from suggestion.' }
  }

  const { error: updateError } = await supabase
    .from('receipt_rule_suggestions')
    .update({
      status: 'approved',
      approved_rule_id: rule.id,
      reviewed_at: now,
      reviewed_by: userId,
    })
    .eq('id', suggestion.id)

  if (updateError) {
    console.error('Failed to mark receipt rule suggestion approved', updateError)
  }

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
      rule_id: rule.id,
      ai_confidence: null,
      performed_by: userId,
      performed_at: now,
      payload: { suggestion_id: suggestion.id },
    }))
  )

  return { success: true, rule: rule as ReceiptRule }
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
