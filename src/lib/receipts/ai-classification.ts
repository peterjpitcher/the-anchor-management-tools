'use server'

import type { createAdminClient } from '@/lib/supabase/admin'
import {
  classifyReceiptTransactionsBatch,
  type ClassificationUsage,
  type BatchClassificationItem,
  type FewShotExample,
  type CrossTransactionHint,
} from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptTransaction, ReceiptTransactionLog, ReceiptExpenseCategory } from '@/types/database'
import { getTransactionDirection as getCanonicalDirection } from './direction'
import {
  buildRuleSuggestionInserts,
  previewSuggestionMatchCount,
  recordReceiptClassificationSignals,
  suggestionDedupeKey,
} from '@/services/receipts/receiptGovernance'

type AdminClient = ReturnType<typeof createAdminClient>

const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options

// Below this AI-reported confidence we don't even propose a rule suggestion. Keeps the
// suggestion queue trustworthy and cheap to review.
export const AI_SUGGESTION_MIN_CONFIDENCE = 70

type AiSuggestionInput = Parameters<typeof buildRuleSuggestionInserts>[0][number]

function getTransactionDirection(tx: ReceiptTransaction): 'in' | 'out' {
  const dir = getCanonicalDirection(tx.amount_in, tx.amount_out)
  return dir === 'in' ? 'in' : 'out'
}

function canAssignExpenseCategory(tx: ReceiptTransaction): boolean {
  return typeof tx.amount_out === 'number' && tx.amount_out > 0
}

export async function recordAIUsage(
  supabase: AdminClient,
  usage: ClassificationUsage | undefined,
  context: string
) {
  if (!usage) return

  const { error } = await supabase.from('ai_usage_events').insert([
    {
      context,
      model: usage.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      cost: usage.cost,
    },
  ])

  if (error) {
    console.error('Failed to record OpenAI usage', error)
  }
}

async function fetchFewShotExamples(supabase: AdminClient, limit = 10): Promise<FewShotExample[]> {
  try {
    const client = supabase as any

    // Get recent manual classification logs
    const { data: logs, error } = await client
      .from('receipt_transaction_logs')
      .select('transaction_id, performed_at')
      .eq('action_type', 'manual_classification')
      .order('performed_at', { ascending: false })
      .limit(limit)

    if (error || !logs?.length) return []

    const transactionIds = [...new Set((logs as Array<{ transaction_id: string }>).map((l) => l.transaction_id))]

    const { data: transactions, error: txError } = await client
      .from('receipt_transactions')
      .select('id, details, amount_in, amount_out, vendor_name, expense_category')
      .in('id', transactionIds)
      .not('vendor_name', 'is', null)

    if (txError || !transactions?.length) return []

    return (transactions as Array<{
      id: string
      details: string
      amount_in: number | null
      amount_out: number | null
      vendor_name: string | null
      expense_category: string | null
    }>)
      .filter((tx) => tx.vendor_name)
      .map((tx) => ({
        details: tx.details,
        direction: (tx.amount_in && tx.amount_in > 0 && !tx.amount_out) ? 'in' as const : 'out' as const,
        vendorName: tx.vendor_name,
        expenseCategory: tx.expense_category as ReceiptExpenseCategory | null,
      }))
  } catch {
    return []
  }
}

async function fetchCrossTransactionHints(
  supabase: AdminClient,
  transactions: ReceiptTransaction[]
): Promise<CrossTransactionHint[]> {
  try {
    const client = supabase as any
    const detailsSet = [...new Set(transactions.map((tx) => tx.details))]
    if (!detailsSet.length) return []

    const { data, error } = await client
      .from('receipt_transactions')
      .select('details, vendor_name, vendor_source')
      .in('details', detailsSet)
      .in('vendor_source', ['manual', 'rule'])
      .not('vendor_name', 'is', null)

    if (error || !data?.length) return []

    // Dedupe by details, prefer manual over rule
    const map = new Map<string, CrossTransactionHint>()
    for (const row of data as Array<{ details: string; vendor_name: string; vendor_source: string }>) {
      const existing = map.get(row.details)
      if (!existing || row.vendor_source === 'manual') {
        map.set(row.details, {
          details: row.details,
          vendorName: row.vendor_name,
          source: row.vendor_source as 'manual' | 'rule',
        })
      }
    }

    return Array.from(map.values())
  } catch {
    return []
  }
}

export async function classifyReceiptTransactionsWithAI(
  supabase: AdminClient,
  transactionIds: string[]
): Promise<void> {
  if (!transactionIds.length) return

  const { apiKey } = await getOpenAIConfig()
  if (!apiKey) {
    return
  }

  const client = supabase as any

  const { data: transactions, error } = await client
    .from('receipt_transactions')
    .select(
      'id, details, transaction_type, amount_in, amount_out, vendor_id, vendor_name, vendor_source, vendor_rule_id, expense_category, expense_category_source, expense_rule_id, status, ai_confidence, ai_suggested_keywords, source_type, merchant_category, merchant_town'
    )
    .in('id', transactionIds)

  if (error) {
    console.error('Failed to load transactions for AI classification', error)
    return
  }

  const transactionRows = (transactions ?? []) as ReceiptTransaction[]

  if (!transactionRows.length) return

  // Filter to only transactions that need classification
  // Explicit guard: skip transactions already AI-classified (vendor_source === 'ai') unless they also need expense
  const toClassify = transactionRows.filter((transaction) => {
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule' || transaction.vendor_source === 'import'
    const expenseLocked = transaction.expense_category_source === 'manual'

    const needsVendor = !vendorLocked && !transaction.vendor_name
    const needsExpense = !expenseLocked && !transaction.expense_category && canAssignExpenseCategory(transaction)

    return needsVendor || needsExpense
  })

  if (!toClassify.length) return

  // Fetch context in parallel
  const [fewShotExamples, crossTransactionHints] = await Promise.all([
    fetchFewShotExamples(supabase),
    fetchCrossTransactionHints(supabase, toClassify),
  ])

  // Build batch items
  const batchItems: BatchClassificationItem[] = toClassify.map((transaction) => {
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule' || transaction.vendor_source === 'import'
    // For Amex rows the statement carries the merchant's own category/town,
    // which give the model a stronger vendor/category signal than details alone.
    const merchantHint = transaction.source_type === 'amex'
      ? [transaction.merchant_category, transaction.merchant_town].filter(Boolean).join(' · ') || undefined
      : undefined
    return {
      id: transaction.id,
      details: transaction.details,
      amountIn: transaction.amount_in,
      amountOut: transaction.amount_out,
      transactionType: transaction.transaction_type,
      direction: getTransactionDirection(transaction),
      skipVendor: vendorLocked,
      existingVendor: transaction.vendor_name ?? undefined,
      existingExpenseCategory: transaction.expense_category ?? undefined,
      merchantHint,
    }
  })

  // Single batch API call
  const batchOutcome = await classifyReceiptTransactionsBatch({
    items: batchItems,
    categories: EXPENSE_CATEGORY_OPTIONS,
    fewShotExamples,
    crossTransactionHints,
  })

  // Build result map for easy lookup
  const resultMap = new Map(
    (batchOutcome?.results ?? []).map((r) => [r.id, r])
  )

  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []
  const now = new Date().toISOString()

  if (!batchOutcome) {
    // Log failures for all items
    const { error: logError } = await client.from('receipt_transaction_logs').insert(
      toClassify.map((transaction) => ({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: transaction.status,
        action_type: 'ai_classification_failed',
        note: 'Batch AI classification call failed',
        performed_by: null,
        rule_id: null,
        performed_at: now,
      }))
    )
    if (logError) console.error('Failed to insert transaction log:', logError)
    return
  }

  // The AI no longer writes vendor/expense onto rows. Instead it proposes guarded rule
  // suggestions: confidence-gated, grouped, deduped, with an impact preview. Rows stay
  // `pending` until a human approves a suggested rule, which then re-runs over them.
  const suggestionInputs: AiSuggestionInput[] = []

  for (const transaction of toClassify) {
    const classificationResult = resultMap.get(transaction.id)

    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule' || transaction.vendor_source === 'import'
    const expenseLocked = transaction.expense_category_source === 'manual'

    const needsVendor = !vendorLocked && !transaction.vendor_name
    const needsExpense = !expenseLocked && !transaction.expense_category && canAssignExpenseCategory(transaction)

    if (!classificationResult) {
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: transaction.status,
        action_type: 'ai_classification_failed',
        note: 'No classification result returned for transaction in batch',
        performed_by: null,
        rule_id: null,
        performed_at: now,
      })
      continue
    }

    const { vendorName, expenseCategory, confidence, suggestedRuleKeywords } = classificationResult

    // Only trustworthy results become suggestions, and only when there's something to set.
    if (confidence != null && confidence < AI_SUGGESTION_MIN_CONFIDENCE) continue
    if (!vendorName && !expenseCategory) continue

    suggestionInputs.push({
      transaction,
      vendorName: needsVendor ? vendorName ?? null : null,
      expenseCategory: needsExpense ? (expenseCategory as ReceiptExpenseCategory | null) ?? null : null,
      suggestedRuleKeywords: suggestedRuleKeywords ?? null,
      confidence: confidence ?? null,
    })
  }

  // Dedupe against active rules + pending/approved suggestions (mirrors performSuggestReceiptRules).
  const [{ data: existingSuggestions }, { data: existingRules }] = await Promise.all([
    client
      .from('receipt_rule_suggestions')
      .select('match_description, match_direction, set_vendor_name, set_expense_category')
      .in('status', ['pending', 'approved']),
    client
      .from('receipt_rules')
      .select('match_description, match_direction, set_vendor_name, set_expense_category')
      .eq('is_active', true),
  ])

  const existingKeys = new Set<string>()
  ;[...(existingSuggestions ?? []), ...(existingRules ?? [])].forEach((row: any) => {
    existingKeys.add(suggestionDedupeKey({
      matchDescription: row.match_description,
      direction: row.match_direction,
      vendorName: row.set_vendor_name,
      expenseCategory: row.set_expense_category,
    }))
  })

  const inserts = buildRuleSuggestionInserts(suggestionInputs, {
    source: 'ai_classification',
    minOccurrences: 1,
    existingKeys,
    cap: 25,
  })

  // Attach the impact preview ("would match N transactions") to each suggestion.
  for (const insert of inserts) {
    const previewMatchCount = await previewSuggestionMatchCount(supabase, {
      match_description: insert.match_description,
      match_direction: insert.match_direction,
    })
    insert.evidence = { ...insert.evidence, preview_match_count: previewMatchCount }
  }

  let createdSuggestions = 0
  if (inserts.length) {
    const { error: insertError } = await client
      .from('receipt_rule_suggestions')
      .insert(inserts)

    if (insertError) {
      console.error('Failed to create AI receipt rule suggestions', insertError)
    } else {
      createdSuggestions = inserts.length
    }
  }

  // Trace which transactions seeded a suggestion (no row mutation, signal only).
  const signals: Array<Parameters<typeof recordReceiptClassificationSignals>[1][number]> = []
  for (const insert of inserts) {
    const evidenceIds: string[] = Array.isArray(insert.evidence_transaction_ids) ? insert.evidence_transaction_ids : []
    for (const transactionId of evidenceIds) {
      signals.push({
        transaction_id: transactionId,
        source: 'ai',
        signal_type: 'ai_suggested_rule',
        prior_vendor_id: null,
        new_vendor_id: null,
        prior_vendor_name: null,
        new_vendor_name: insert.set_vendor_name,
        prior_expense_category: null,
        new_expense_category: insert.set_expense_category,
        prior_status: null,
        new_status: null,
        rule_id: null,
        ai_confidence: (insert.evidence?.ai_confidence as number | null | undefined) ?? null,
        performed_by: null,
        performed_at: now,
        payload: { suggested_name: insert.suggested_name, match_description: insert.match_description },
      })
    }
  }

  // Record usage after building suggestions so the context reflects what was produced.
  // Recording before risked double-billing on job retries.
  await recordAIUsage(supabase, batchOutcome.usage, `receipt_classification_batch:${createdSuggestions}`)

  if (logs.length) {
    const { error: logError } = await client.from('receipt_transaction_logs').insert(logs)
    if (logError) console.error('Failed to insert transaction log:', logError)
  }

  await recordReceiptClassificationSignals(supabase, signals)
}
