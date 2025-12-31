'use server'

import type { createAdminClient } from '@/lib/supabase/admin'
import { classifyReceiptTransaction, type ClassificationUsage } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptTransaction, ReceiptTransactionLog } from '@/types/database'

type AdminClient = ReturnType<typeof createAdminClient>

const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options

function getTransactionDirection(tx: ReceiptTransaction): 'in' | 'out' {
  if (tx.amount_in && tx.amount_in > 0) return 'in'
  return 'out'
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
      'id, details, transaction_type, amount_in, amount_out, vendor_name, vendor_source, vendor_rule_id, expense_category, expense_category_source, expense_rule_id, status'
    )
    .in('id', transactionIds)

  if (error) {
    console.error('Failed to load transactions for AI classification', error)
    return
  }

  const transactionRows = (transactions ?? []) as ReceiptTransaction[]

  if (!transactionRows.length) return

  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []

  for (const transaction of transactionRows) {
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule'
    const expenseLocked = transaction.expense_category_source === 'manual'

    const needsVendor = !vendorLocked && !transaction.vendor_name
    const needsExpense = !expenseLocked && !transaction.expense_category

    if (!needsVendor && !needsExpense) {
      continue
    }

    const direction = getTransactionDirection(transaction)

    const outcome = await classifyReceiptTransaction({
      details: transaction.details,
      amountIn: transaction.amount_in,
      amountOut: transaction.amount_out,
      transactionType: transaction.transaction_type,
      categories: EXPENSE_CATEGORY_OPTIONS,
      direction,
      existingVendor: transaction.vendor_name ?? undefined,
      existingExpenseCategory: transaction.expense_category ?? undefined,
    })

    if (!outcome?.result) {
      continue
    }

    await recordAIUsage(supabase, outcome.usage, `receipt_classification:${transaction.id}`)

    const { vendorName, expenseCategory, reasoning } = outcome.result
    const updatePayload: Record<string, unknown> = {}
    const changeNotes: string[] = []
    const now = new Date().toISOString()

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

    if (!Object.keys(updatePayload).length) {
      continue
    }

    updatePayload.updated_at = now

    const { error: updateError } = await client
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)

    if (updateError) {
      console.error('Failed to persist AI classification', updateError)
      continue
    }

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

  if (logs.length) {
    await client.from('receipt_transaction_logs').insert(logs)
  }
}
