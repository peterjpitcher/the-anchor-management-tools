import { updateReceiptClassification, type ClassificationRuleSuggestion, type ReceiptWorkspaceData } from '@/app/actions/receipts'
import { decideReceiptAiCategory } from '@/app/actions/receipt-ai'
import { NO_CATEGORY_LABEL, NO_CATEGORY_VALUE } from '@/lib/receipts/no-category'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'

/**
 * The expense category of one payment, as the list row and the phone card both show and save it.
 * Kept in one place so the two cannot drift: "no category applies" is a real answer and not an
 * empty one, and saving a category while a suggestion is open answers the suggestion.
 */

export type WorkspaceTransaction = ReceiptWorkspaceData['transactions'][number]

/** Clear, every category, then "No category applies". */
export const EXPENSE_CHOICE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Clear' },
  ...receiptExpenseCategorySchema.options.map((option) => ({ value: option, label: option })),
  { value: NO_CATEGORY_VALUE, label: NO_CATEGORY_LABEL },
]

/** What the category select should start on for this payment. */
export function expenseChoiceValue(
  payment: Pick<ReceiptTransaction, 'expense_category'> & { no_category_applies?: boolean | null }
): string {
  if (payment.expense_category) return payment.expense_category
  return payment.no_category_applies ? NO_CATEGORY_VALUE : ''
}

/** What to show for the category, or null when there is nothing decided yet. */
export function expenseChoiceLabel(
  payment: Pick<ReceiptTransaction, 'expense_category'> & { no_category_applies?: boolean | null }
): string | null {
  if (payment.expense_category) return payment.expense_category
  return payment.no_category_applies ? NO_CATEGORY_LABEL : null
}

/** The select value a suggestion would be saved as. */
export function suggestionChoiceValue(suggestion: NonNullable<WorkspaceTransaction['aiSuggestion']>): string {
  return suggestion.noCategoryApplies ? NO_CATEGORY_VALUE : suggestion.category ?? ''
}

export function suggestionChoiceLabel(suggestion: NonNullable<WorkspaceTransaction['aiSuggestion']>): string {
  return suggestion.noCategoryApplies ? NO_CATEGORY_LABEL : suggestion.category ?? ''
}

export type ExpenseChoiceResult = {
  error?: string
  /** The payment as it now stands. Present on success, and when a suggestion turned out to be stale. */
  transaction?: ReceiptTransaction
  ruleSuggestion?: ClassificationRuleSuggestion
  /** The open suggestion is no longer open: it was accepted, changed, or had been overtaken. */
  suggestionClosed?: boolean
}

/**
 * Saves the category chosen in the select.
 *
 * With a suggestion open and a category chosen, the choice answers the suggestion: the same
 * category accepts it and a different one records that it was changed. Either way the suggestion
 * is closed in the same database call that writes the category.
 */
export async function saveExpenseChoice(transaction: WorkspaceTransaction, choice: string): Promise<ExpenseChoiceResult> {
  const value = choice.trim()
  const noCategoryApplies = value === NO_CATEGORY_VALUE
  const expenseCategory = !value || noCategoryApplies ? null : (value as ReceiptExpenseCategory)
  const suggestion = transaction.aiSuggestion ?? null

  if (suggestion && (expenseCategory || noCategoryApplies)) {
    const sameAsSuggested = value === suggestionChoiceValue(suggestion)
    const result = await decideReceiptAiCategory({
      transactionId: transaction.id,
      decision: sameAsSuggested ? 'accept' : 'edit',
      expenseCategory,
      noCategoryApplies,
    })
    if (result.error) {
      return { error: result.error, transaction: result.transaction, suggestionClosed: Boolean(result.superseded) }
    }
    return { transaction: result.transaction, suggestionClosed: true }
  }

  const result = await updateReceiptClassification({
    transactionId: transaction.id,
    expenseCategory,
    noCategoryApplies,
  })
  if (result?.error) {
    return { error: result.error }
  }
  return {
    transaction: result?.transaction,
    ruleSuggestion: result?.ruleSuggestion as ClassificationRuleSuggestion | undefined,
  }
}
