/**
 * What a person does with the AI's suggestions: accept, change or dismiss a suggested category,
 * accept every suggestion for one vendor, and see what the AI could not do.
 *
 * A single accept is one database function (`decide_receipt_ai_category`): it checks the payment
 * is still uncategorised, writes the category and closes the proposal together. "Accept all" is a
 * recorded run, the same kind a rule run makes, so it respects the lock date and can be undone.
 *
 * @requires Callers must verify user auth and 'receipts.manage'.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { RECEIPT_AI_PROMPT_VERSION } from '@/lib/receipts/ai-client'
import { NO_CATEGORY_LABEL } from '@/lib/receipts/no-category'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'
import { loadReceiptSettings } from './receiptSettings'
import { performRecordedRun, type RecordedRunChange } from './receiptRuleRuns'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AiCategoryDecision = 'accept' | 'edit' | 'dismiss'

const DECISION_REFUSALS: Record<string, string> = {
  not_found: 'That transaction no longer exists.',
  no_proposal: 'There is no suggestion open for this transaction.',
  already_classified: 'This transaction has been categorised in the meantime. The suggestion has been closed.',
  not_outgoing: 'Expense categories can only be set on outgoing transactions.',
  invalid: 'Choose a category, or "No category applies".',
}

export async function performDecideReceiptAiCategory(
  userId: string,
  input: {
    transactionId: string
    decision: AiCategoryDecision
    /** For `edit`: the category the person chose instead. */
    expenseCategory?: ReceiptExpenseCategory | null
    /** For `edit`: the person chose "no category applies". */
    noCategoryApplies?: boolean
  }
): Promise<{
  success?: boolean
  error?: string
  decision?: AiCategoryDecision
  transaction?: ReceiptTransaction
  /** Set when the suggestion was closed because the payment already had a category. */
  superseded?: boolean
}> {
  if (!UUID_PATTERN.test(input.transactionId)) {
    return { error: 'Transaction reference is invalid' }
  }
  if (!['accept', 'edit', 'dismiss'].includes(input.decision)) {
    return { error: 'Choose accept, change or dismiss.' }
  }

  let category: ReceiptExpenseCategory | null = null
  if (input.decision === 'edit' && !input.noCategoryApplies) {
    const parsed = receiptExpenseCategorySchema.safeParse(input.expenseCategory)
    if (!parsed.success) {
      return { error: DECISION_REFUSALS.invalid }
    }
    category = parsed.data
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('decide_receipt_ai_category', {
    p_transaction_id: input.transactionId,
    p_decision: input.decision,
    p_category: category,
    p_no_category: input.decision === 'edit' ? Boolean(input.noCategoryApplies) : false,
    p_user: userId,
  })

  if (error || !data) {
    console.error('Failed to decide a suggested category', error)
    return { error: 'The suggestion could not be saved. Nothing was changed.' }
  }

  const outcome = data.outcome as string
  if (outcome !== 'accepted' && outcome !== 'edited' && outcome !== 'dismissed' && outcome !== 'already_classified') {
    return { error: DECISION_REFUSALS[outcome] ?? 'The suggestion could not be saved.' }
  }

  const { data: transaction, error: reloadError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', input.transactionId)
    .maybeSingle()
  if (reloadError) {
    console.error('Failed to reload a transaction after deciding its suggestion', reloadError)
  }

  if (outcome === 'already_classified') {
    return {
      error: DECISION_REFUSALS.already_classified,
      superseded: true,
      transaction: (transaction ?? undefined) as ReceiptTransaction | undefined,
    }
  }

  return {
    success: true,
    decision: input.decision,
    transaction: (transaction ?? undefined) as ReceiptTransaction | undefined,
  }
}

// ---------------------------------------------------------------------------
// Open proposals, grouped by vendor
// ---------------------------------------------------------------------------

export type CategoryProposal = {
  transactionId: string
  transactionDate: string
  details: string
  amount: number
  /** Null with `noCategoryApplies` true: the suggestion is that no category applies. */
  category: ReceiptExpenseCategory | null
  noCategoryApplies: boolean
  confidence: number | null
  reasoning: string | null
}

export type CategoryProposalGroup = {
  /** Null for payments with no vendor yet. */
  vendorId: string | null
  vendorName: string
  proposals: CategoryProposal[]
}

type OpenProposalRow = {
  transaction_id: string
  proposed_expense_category: string | null
  proposed_no_category: boolean
  confidence: number | null
  reasoning: string | null
  receipt_transactions:
    | (Pick<
        ReceiptTransaction,
        'id' | 'transaction_date' | 'details' | 'amount_out' | 'vendor_id' | 'vendor_name' | 'expense_category' | 'updated_at'
      > & { no_category_applies?: boolean | null })
    | null
}

async function loadOpenProposals(supabase: ReturnType<typeof createAdminClient>): Promise<OpenProposalRow[]> {
  const rows = await fetchAllRows<OpenProposalRow>(
    (from, to) =>
      (supabase as any)
        .from('receipt_ai_attempts')
        .select(
          'transaction_id, proposed_expense_category, proposed_no_category, confidence, reasoning, receipt_transactions(id, transaction_date, details, amount_out, vendor_id, vendor_name, expense_category, no_category_applies, updated_at)'
        )
        .eq('category_state', 'proposed')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'open AI category proposals' }
  )
  // A proposal is open only while the payment is still uncategorised. One that a rule or a
  // person has since answered is left for the next classification run to close.
  return rows.filter((row) => {
    const payment = Array.isArray(row.receipt_transactions) ? row.receipt_transactions[0] : row.receipt_transactions
    return Boolean(payment) && !payment.expense_category && !payment.no_category_applies
  })
}

function paymentOf(row: OpenProposalRow) {
  return (Array.isArray(row.receipt_transactions) ? row.receipt_transactions[0] : row.receipt_transactions) as NonNullable<
    OpenProposalRow['receipt_transactions']
  >
}

export async function queryOpenCategoryProposals(): Promise<CategoryProposalGroup[]> {
  const supabase = createAdminClient()
  const rows = await loadOpenProposals(supabase)

  const groups = new Map<string, CategoryProposalGroup>()
  for (const row of rows) {
    const payment = paymentOf(row)
    const key = payment.vendor_id ?? 'none'
    const group = groups.get(key) ?? {
      vendorId: payment.vendor_id,
      vendorName: payment.vendor_name ?? 'No vendor yet',
      proposals: [],
    }
    group.proposals.push({
      transactionId: payment.id,
      transactionDate: payment.transaction_date,
      details: payment.details,
      amount: Number(payment.amount_out ?? 0),
      category: (row.proposed_expense_category as ReceiptExpenseCategory | null) ?? null,
      noCategoryApplies: Boolean(row.proposed_no_category),
      confidence: row.confidence,
      reasoning: row.reasoning,
    })
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      proposals: group.proposals.sort((left, right) => right.transactionDate.localeCompare(left.transactionDate)),
    }))
    .sort((left, right) => right.proposals.length - left.proposals.length || left.vendorName.localeCompare(right.vendorName))
}

export type AcceptAllResult = {
  success?: boolean
  error?: string
  runId?: string
  accepted?: number
  /** Changed since the list was loaded, so left for a person to look at. */
  skippedChanged?: number
  /** On or before the lock date. */
  skippedLocked?: number
}

/**
 * Accepts every open suggestion for one vendor's payments. Recorded as a run, so it respects the
 * lock date, writes each payment only if it is unchanged, keeps what it replaced and can be
 * undone from Recent runs.
 */
export async function performAcceptVendorCategoryProposals(
  userId: string,
  input: { vendorId: string | null }
): Promise<AcceptAllResult> {
  if (input.vendorId !== null && !UUID_PATTERN.test(input.vendorId)) {
    return { error: 'Choose a vendor.' }
  }

  const supabase = createAdminClient()

  let rows: OpenProposalRow[]
  let lockDate: string | null
  try {
    rows = (await loadOpenProposals(supabase)).filter((row) => (paymentOf(row).vendor_id ?? null) === input.vendorId)
    lockDate = (await loadReceiptSettings(supabase)).lockDate
  } catch (error) {
    console.error('Failed to load suggestions to accept', error)
    return { error: 'The suggestions could not be loaded. Nothing was changed.' }
  }

  if (!rows.length) {
    return { error: 'There are no open suggestions for this vendor.' }
  }

  const now = new Date().toISOString()
  const vendorName = paymentOf(rows[0]).vendor_name ?? 'no vendor'

  const changes: RecordedRunChange[] = rows.map((row) => {
    const payment = paymentOf(row)
    const none = Boolean(row.proposed_no_category) && !row.proposed_expense_category
    return {
      transaction_id: payment.id,
      expected_updated_at: payment.updated_at,
      after: {
        expense_category: none ? null : row.proposed_expense_category,
        no_category_applies: none,
        expense_category_source: 'ai_accepted',
        expense_rule_id: null,
        expense_updated_at: now,
      },
      logs: [
        {
          action_type: 'ai_category_accepted',
          note: `Expense: ${none ? NO_CATEGORY_LABEL.toLowerCase() : row.proposed_expense_category} (suggestion accepted with the rest for ${vendorName})`,
        },
      ],
    }
  })

  const run = await performRecordedRun(supabase, userId, {
    kind: 'ai_accept_all',
    label: `Accepted suggestions: ${vendorName}`,
    lockDate,
    reviewed: rows.length,
    changes,
  })

  if (run.failure === 'not_recorded' || !run.runId) {
    return { error: 'The suggestions could not be accepted. Nothing was changed.' }
  }
  if (run.failure) {
    return {
      error:
        run.failure === 'stale'
          ? 'The lock date changed while accepting. What was accepted is recorded under Recent runs and can be undone.'
          : 'Accepting stopped part-way. What was accepted is recorded under Recent runs and can be undone.',
      runId: run.runId,
      accepted: run.applied,
    }
  }

  await closeProposalsForRun(supabase, run.runId, userId, 'accepted')

  return {
    success: true,
    runId: run.runId,
    accepted: run.applied,
    skippedChanged: run.skippedChanged,
    skippedLocked: run.skippedLocked,
  }
}

/**
 * Brings the proposals into line with a run of accepted suggestions: closed as accepted once the
 * run has written them, and open again for any payment an undo put back.
 */
export async function closeProposalsForRun(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  userId: string | null,
  state: 'accepted' | 'reopened'
): Promise<void> {
  const changeState = state === 'accepted' ? 'applied' : 'undone'
  const rows = await fetchAllRows<{ transaction_id: string }>(
    (from, to) =>
      (supabase as any)
        .from('receipt_rule_run_changes')
        .select('transaction_id')
        .eq('run_id', runId)
        .eq('state', changeState)
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'run changes for proposal upkeep' }
  ).catch((error) => {
    console.error('Failed to read run changes for proposal upkeep', error)
    return [] as Array<{ transaction_id: string }>
  })

  const ids = rows.map((row) => row.transaction_id)
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200)
    const update =
      state === 'accepted'
        ? { category_state: 'accepted', reviewed_by: userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { category_state: 'proposed', reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() }
    const { error } = await (supabase as any)
      .from('receipt_ai_attempts')
      .update(update)
      .in('transaction_id', chunk)
      .eq('category_state', state === 'accepted' ? 'proposed' : 'accepted')
    if (error) {
      // The payments are right either way. A proposal left open for a payment that now has a
      // category is not shown, and is closed by the next classification run.
      console.error('Failed to update proposals after a run', error)
    }
  }
}

// ---------------------------------------------------------------------------
// What the AI could not do
// ---------------------------------------------------------------------------

export type ReceiptAiStatus = {
  /** Payments whose classification failed and has not succeeded since. */
  failed: number
  /** Of those, failures that will not be retried without someone asking. */
  failedForGood: number
  /** Payments that look like wage payments but need a person to check. */
  payrollChecks: number
}

type AttentionRow = {
  outcome: string
  receipt_transactions:
    | (Pick<
        ReceiptTransaction,
        'vendor_name' | 'vendor_source' | 'expense_category' | 'expense_category_source' | 'amount_out'
      > & { no_category_applies?: boolean | null })
    | null
}

/** Still true of the payment: no vendor, or money out with no category and none ruled out. */
function stillNeedsClassifying(payment: NonNullable<AttentionRow['receipt_transactions']>): boolean {
  const needsVendor = !payment.vendor_name && !payment.vendor_source
  const needsCategory =
    Number(payment.amount_out ?? 0) > 0 &&
    !payment.expense_category &&
    !payment.expense_category_source &&
    !payment.no_category_applies
  return needsVendor || needsCategory
}

/**
 * Counts only payments that still need something. A payment a person has classified since the
 * AI failed on it, or since it was flagged as a possible wage payment, is no longer counted.
 */
export async function queryReceiptAiStatus(): Promise<ReceiptAiStatus> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<AttentionRow>(
    (from, to) =>
      (supabase as any)
        .from('receipt_ai_attempts')
        .select(
          'outcome, receipt_transactions(vendor_name, vendor_source, expense_category, expense_category_source, no_category_applies, amount_out)'
        )
        .eq('prompt_version', RECEIPT_AI_PROMPT_VERSION)
        .in('outcome', ['failed_retryable', 'failed_final', 'payroll_check'])
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'AI attempts needing attention' }
  )

  const status: ReceiptAiStatus = { failed: 0, failedForGood: 0, payrollChecks: 0 }
  for (const row of rows) {
    const payment = Array.isArray(row.receipt_transactions) ? row.receipt_transactions[0] : row.receipt_transactions
    if (!payment || !stillNeedsClassifying(payment)) continue
    if (row.outcome === 'payroll_check') {
      status.payrollChecks += 1
    } else {
      status.failed += 1
      if (row.outcome === 'failed_final') status.failedForGood += 1
    }
  }
  return status
}

/** After a run of accepted suggestions is undone, the suggestions it had closed are open again. */
export async function performReopenProposalsForUndoneRun(runId: string): Promise<void> {
  await closeProposalsForRun(createAdminClient(), runId, null, 'reopened')
}
