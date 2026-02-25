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

type AdminClient = ReturnType<typeof createAdminClient>

const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options

function getTransactionDirection(tx: ReceiptTransaction): 'in' | 'out' {
  if (tx.amount_in && tx.amount_in > 0) return 'in'
  return 'out'
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

  const { error } = await (supabase.from('ai_usage_events') as any).insert([
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
      'id, details, transaction_type, amount_in, amount_out, vendor_name, vendor_source, vendor_rule_id, expense_category, expense_category_source, expense_rule_id, status, ai_confidence, ai_suggested_keywords'
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
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule'
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
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule'
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
    await client.from('receipt_transaction_logs').insert(
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
    return
  }

  // Record usage once for the entire batch
  await recordAIUsage(supabase, batchOutcome.usage, `receipt_classification_batch:${toClassify.length}`)

  for (const transaction of toClassify) {
    const classificationResult = resultMap.get(transaction.id)

    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule'
    const expenseLocked = transaction.expense_category_source === 'manual'

    const needsVendor = !vendorLocked && !transaction.vendor_name
    const needsExpense = !expenseLocked && !transaction.expense_category && canAssignExpenseCategory(transaction)

    if (!classificationResult) {
      continue
    }

    const { vendorName, expenseCategory, reasoning, confidence, suggestedRuleKeywords } = classificationResult
    const updatePayload: Record<string, unknown> = {}
    const changeNotes: string[] = []

    if (needsVendor && vendorName) {
      updatePayload.vendor_name = vendorName
      updatePayload.vendor_source = 'ai'
      updatePayload.vendor_rule_id = null
      updatePayload.vendor_updated_at = now
      changeNotes.push(`Vendor -> ${vendorName}`)
    }

    if (needsExpense && expenseCategory) {
      updatePayload.expense_category = expenseCategory
      updatePayload.expense_category_source = 'ai'
      updatePayload.expense_rule_id = null
      updatePayload.expense_updated_at = now
      changeNotes.push(`Expense -> ${expenseCategory}`)
    }

    // Always write confidence and keywords if returned
    if (confidence != null) {
      updatePayload.ai_confidence = confidence
    }
    if (suggestedRuleKeywords) {
      updatePayload.ai_suggested_keywords = suggestedRuleKeywords
    }

    if (!Object.keys(updatePayload).length) {
      continue
    }

    updatePayload.updated_at = now

    const { data: updatedTransaction, error: updateError } = await client
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Failed to persist AI classification', updateError)
      continue
    }

    if (!updatedTransaction) {
      console.error('Failed to persist AI classification: transaction not found', { transactionId: transaction.id })
      continue
    }

    if (changeNotes.length) {
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: transaction.status,
        action_type: 'ai_classification',
        note: reasoning
          ? `AI suggestion applied: ${changeNotes.join(' | ')} (Reason: ${reasoning})`
          : `AI suggestion applied: ${changeNotes.join(' | ')}`,
        performed_by: null,
        rule_id: null,
        performed_at: now,
      })
    }
  }

  if (logs.length) {
    await client.from('receipt_transaction_logs').insert(logs)
  }
}
