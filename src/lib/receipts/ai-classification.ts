// Server only, and deliberately not a server action. With a 'use server' directive the build
// listed classifyReceiptTransactionsWithAI as callable from a browser, with no permission check.
// It is run by the job queue and nowhere else.
//
// What this does for a set of payments (spec 8.2):
//
//  1. A payment is asked about once. What happened is kept in `receipt_ai_attempts`, one row per
//     payment and prompt version. It is asked again only if the last try failed in a way that
//     may not happen twice.
//  2. Wage payments are recognised here from the employee list and never sent to OpenAI.
//     Anything else that carries a member of staff's name is flagged for a person and not sent.
//  3. The model is given our own vendor list and names the vendor from it. That vendor is
//     written onto the payment, but only if the payment still has no vendor and nothing has
//     decided it. A rule or a person always wins.
//  4. The category is written the same way: only where the payment has no category and nothing
//     has decided it (owner decision, 1 October 2026). Where the vendor has a default category
//     a person set, that is what is written. "No category applies" is never written: it is
//     stored as a proposal for a person to accept.
//  5. A failed call is recorded against every payment it covered and, when trying again can
//     help, thrown so the queue retries. A failure used to return quietly as "done".
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ClassificationUsage } from '@/lib/openai'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'
import {
  classifyReceiptPayments,
  ReceiptAiError,
  RECEIPT_AI_MIN_CONFIDENCE,
  RECEIPT_AI_PROMPT_VERSION,
  type AiExample,
  type AiPaymentInput,
  type AiPaymentResult,
  type AiVendorOption,
} from './ai-client'
import { canAiWriteField, canAutomationChangeStatus } from './field-protection'
import {
  containsEmployeeName,
  recognisePayrollPayment,
  type PayrollCheckReason,
  type PayrollEmployee,
} from './payroll-recognition'
import { vendorMatchingKey } from './vendor-matching'
import { loadReceiptSettings } from '@/services/receipts/receiptSettings'
import { resolveReceiptVendor, type ResolvedReceiptVendor } from '@/services/receipts/receiptVendors'

type AdminClient = ReturnType<typeof createAdminClient>

const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options
const WAGES_CATEGORY: ReceiptExpenseCategory = 'Total Staff'
/** A payment whose call keeps failing is given up on after this many tries. */
const MAX_TRIES = 5
const EXAMPLE_LIMIT = 10

/**
 * Whether an unambiguous wage payment is closed as "no receipt required" as well as classified.
 * Working default W2: yes, as the payroll rules of 2026 did. One place to change if the owner
 * rules otherwise.
 */
const WAGE_MATCH_CLOSES_PAYMENT = true

export type ReceiptAiOutcome =
  | 'vendor_written'
  | 'category_written'
  | 'category_proposed'
  | 'nothing_identified'
  | 'low_confidence'
  | 'skipped_protected'
  | 'payroll_local'
  | 'payroll_check'
  | 'failed_retryable'
  | 'failed_final'

export type ReceiptAiRunSummary = {
  /** Payments that needed something and had not been asked about. */
  considered: number
  payrollLocal: number
  payrollCheck: number
  /** Payments sent to the model. */
  sent: number
  vendorsWritten: number
  categoriesWritten: number
  /** "No category applies" is never written: it waits for a person. */
  categoriesProposed: number
  nothingIdentified: number
  lowConfidence: number
  skippedProtected: number
  failed: number
  /** Payments left alone because they are on or before the lock date. */
  locked: number
}

type PaymentRow = Pick<
  ReceiptTransaction,
  | 'id'
  | 'transaction_date'
  | 'details'
  | 'transaction_type'
  | 'amount_in'
  | 'amount_out'
  | 'vendor_id'
  | 'vendor_name'
  | 'vendor_source'
  | 'expense_category'
  | 'expense_category_source'
  | 'status'
  | 'marked_method'
  | 'updated_at'
> & {
  no_category_applies?: boolean | null
  source_type?: string | null
  merchant_category?: string | null
  merchant_town?: string | null
}

type AttemptRow = {
  transaction_id: string
  outcome: ReceiptAiOutcome
  tries: number
}

type AttemptWrite = {
  transaction_id: string
  prompt_version: string
  outcome: ReceiptAiOutcome
  vendor_id: string | null
  vendor_written: boolean
  proposed_expense_category: ReceiptExpenseCategory | null
  proposed_no_category: boolean
  category_state: 'proposed' | 'written' | 'none'
  confidence: number | null
  reasoning: string | null
  model: string | null
  error: string | null
  tries: number
  updated_at: string
}

const PAYMENT_COLUMNS =
  'id, transaction_date, details, transaction_type, amount_in, amount_out, vendor_id, vendor_name, vendor_source, expense_category, no_category_applies, expense_category_source, status, marked_method, source_type, merchant_category, merchant_town, updated_at'

const PAYROLL_CHECK_NOTE: Record<PayrollCheckReason, string> = {
  name_without_reference: 'Names a member of staff without the payroll reference. Possible wage payment or repaid expense: check.',
  ambiguous_name: 'The name fits more than one member of staff. Possible wage payment: check.',
  initial_only: 'An initial and surname with the payroll reference. Possible wage payment: check.',
  reference_without_name: 'Carries the payroll reference but no name on the employee list. Possible wage payment: check.',
}

function directionOf(payment: Pick<PaymentRow, 'amount_in' | 'amount_out'>): 'in' | 'out' {
  return payment.amount_in && payment.amount_in > 0 ? 'in' : 'out'
}

function amountOf(payment: Pick<PaymentRow, 'amount_in' | 'amount_out'>): number {
  return Number((payment.amount_in && payment.amount_in > 0 ? payment.amount_in : payment.amount_out) ?? 0)
}

function needsVendor(payment: PaymentRow): boolean {
  return canAiWriteField(payment.vendor_name, payment.vendor_source)
}

function needsCategory(payment: PaymentRow): boolean {
  return (
    directionOf(payment) === 'out' &&
    Number(payment.amount_out ?? 0) > 0 &&
    !payment.no_category_applies &&
    canAiWriteField(payment.expense_category, payment.expense_category_source)
  )
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

export async function loadPayrollEmployees(supabase: AdminClient): Promise<PayrollEmployee[]> {
  // Current and former: a leaver's last wage still carries their name.
  const rows = await fetchAllRows<{
    employee_id: string
    first_name: string | null
    last_name: string | null
    preferred_name: string | null
  }>(
    (from, to) =>
      (supabase as any)
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name')
        .order('employee_id', { ascending: true })
        .range(from, to),
    { label: 'employees for wage recognition' }
  )
  return rows
    .filter((row) => (row.first_name ?? '').trim() && (row.last_name ?? '').trim())
    .map((row) => ({
      id: row.employee_id,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      preferredName: row.preferred_name,
    }))
}

type VendorRow = { id: string; canonical_name: string; kind: string | null; default_expense_category: string | null }

async function loadVendors(supabase: AdminClient): Promise<VendorRow[]> {
  return fetchAllRows<VendorRow>(
    (from, to) =>
      (supabase as any)
        .from('receipt_vendors')
        .select('id, canonical_name, kind, default_expense_category')
        .in('status', ['unconfirmed', 'confirmed'])
        .order('canonical_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'receipt vendors for classification' }
  )
}

async function loadAliases(supabase: AdminClient): Promise<Map<string, string[]>> {
  const rows = await fetchAllRows<{ vendor_id: string; alias: string }>(
    (from, to) =>
      (supabase as any)
        .from('receipt_vendor_aliases')
        .select('vendor_id, alias')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'receipt vendor aliases for classification' }
  )
  const byVendor = new Map<string, string[]>()
  for (const row of rows) {
    const list = byVendor.get(row.vendor_id) ?? []
    list.push(row.alias)
    byVendor.set(row.vendor_id, list)
  }
  return byVendor
}

/**
 * Payments a person has classified, as examples for the model. Anything about a person is left
 * out: a wage category, a vendor who is a person, or text carrying a member of staff's name.
 */
async function loadExamples(
  supabase: AdminClient,
  employees: readonly PayrollEmployee[],
  personVendorIds: ReadonlySet<string>
): Promise<AiExample[]> {
  const client = supabase as any
  const { data: logs, error } = await client
    .from('receipt_transaction_logs')
    .select('transaction_id, performed_at')
    .eq('action_type', 'manual_classification')
    .order('performed_at', { ascending: false })
    .limit(EXAMPLE_LIMIT * 3)

  // Examples only sharpen the answer. Without them the call still goes ahead.
  if (error || !logs?.length) return []

  const ids = [...new Set((logs as Array<{ transaction_id: string }>).map((log) => log.transaction_id))]
  const { data: rows, error: rowsError } = await client
    .from('receipt_transactions')
    .select('id, details, amount_in, amount_out, vendor_id, vendor_name, expense_category')
    .in('id', ids)

  if (rowsError || !rows?.length) return []

  return (rows as Array<Pick<ReceiptTransaction, 'details' | 'amount_in' | 'amount_out' | 'vendor_id' | 'vendor_name' | 'expense_category'>>)
    .filter(
      (row) =>
        Boolean(row.vendor_name) &&
        row.expense_category !== WAGES_CATEGORY &&
        !(row.vendor_id && personVendorIds.has(row.vendor_id)) &&
        !containsEmployeeName(row.details, employees) &&
        !containsEmployeeName(row.vendor_name, employees)
    )
    .slice(0, EXAMPLE_LIMIT)
    .map((row) => ({
      details: row.details,
      direction: directionOf(row),
      vendorName: row.vendor_name,
      expenseCategory: row.expense_category,
    }))
}

type ChangeOutcome = 'applied' | 'changed' | 'locked' | 'not_found' | 'failed'

type FieldLog = { action_type: string; note: string }

/**
 * Writes fields onto a payment through the same guarded function the rules use: only if the
 * payment is still at the version that was read, not behind the lock date, and together with
 * its history row.
 */
async function writeFields(
  supabase: AdminClient,
  payment: PaymentRow,
  after: Record<string, string | boolean | null>,
  logs: FieldLog[]
): Promise<ChangeOutcome> {
  const { data, error } = await (supabase as any).rpc('apply_receipt_rule_change', {
    p_transaction_id: payment.id,
    p_expected_updated_at: payment.updated_at,
    p_after: after,
    p_logs: logs,
    p_performed_by: null,
  })
  if (error) {
    console.error('Failed to write an AI classification', { transactionId: payment.id, error })
    return 'failed'
  }
  return (data as ChangeOutcome) ?? 'failed'
}

/** The payment as it is now, for one more try after someone else changed it. */
async function reloadPayment(supabase: AdminClient, id: string): Promise<PaymentRow | null> {
  const { data, error } = await (supabase as any).from('receipt_transactions').select(PAYMENT_COLUMNS).eq('id', id).maybeSingle()
  if (error) return null
  return (data as PaymentRow | null) ?? null
}

function emptySummary(): ReceiptAiRunSummary {
  return {
    considered: 0,
    payrollLocal: 0,
    payrollCheck: 0,
    sent: 0,
    vendorsWritten: 0,
    categoriesWritten: 0,
    categoriesProposed: 0,
    nothingIdentified: 0,
    lowConfidence: 0,
    skippedProtected: 0,
    failed: 0,
    locked: 0,
  }
}

export async function classifyReceiptTransactionsWithAI(
  supabase: AdminClient,
  transactionIds: string[],
  options: {
    /** Cancels the model call when the job is cancelled or times out. */
    signal?: AbortSignal
    /** Also ask again about payments whose last try failed for good (a person pressed retry). */
    retryFinalFailures?: boolean
  } = {}
): Promise<ReceiptAiRunSummary> {
  const summary = emptySummary()
  if (!transactionIds.length) return summary

  const client = supabase as any

  const { data: paymentRows, error: paymentsError } = await client
    .from('receipt_transactions')
    .select(PAYMENT_COLUMNS)
    .in('id', transactionIds)
  if (paymentsError) {
    throw new Error(`Failed to load transactions for AI classification: ${paymentsError.message}`)
  }

  const { data: attemptRows, error: attemptsError } = await client
    .from('receipt_ai_attempts')
    .select('transaction_id, outcome, tries')
    .eq('prompt_version', RECEIPT_AI_PROMPT_VERSION)
    .in('transaction_id', transactionIds)
  if (attemptsError) {
    throw new Error(`Failed to load AI attempts: ${attemptsError.message}`)
  }

  const settings = await loadReceiptSettings(supabase)
  const attemptsByPayment = new Map<string, AttemptRow>(
    ((attemptRows ?? []) as AttemptRow[]).map((attempt) => [attempt.transaction_id, attempt])
  )

  // Who still needs something, and has not been asked.
  const candidates: PaymentRow[] = []
  for (const payment of (paymentRows ?? []) as PaymentRow[]) {
    if (!needsVendor(payment) && !needsCategory(payment)) continue

    const previous = attemptsByPayment.get(payment.id)
    if (previous) {
      const retryable = previous.outcome === 'failed_retryable' && previous.tries < MAX_TRIES
      const retryFinal = previous.outcome === 'failed_final' && options.retryFinalFailures
      if (!retryable && !retryFinal) continue
    }

    if (settings.lockDate && payment.transaction_date <= settings.lockDate) {
      summary.locked += 1
      continue
    }
    candidates.push(payment)
  }

  summary.considered = candidates.length
  if (!candidates.length) return summary

  const now = new Date().toISOString()
  const attempts: AttemptWrite[] = []
  const attempt = (payment: PaymentRow, fields: Partial<AttemptWrite> & { outcome: ReceiptAiOutcome }): void => {
    attempts.push({
      transaction_id: payment.id,
      prompt_version: RECEIPT_AI_PROMPT_VERSION,
      vendor_id: null,
      vendor_written: false,
      proposed_expense_category: null,
      proposed_no_category: false,
      category_state: 'none',
      confidence: null,
      reasoning: null,
      model: null,
      error: null,
      tries: (attemptsByPayment.get(payment.id)?.tries ?? 0) + 1,
      updated_at: now,
      ...fields,
    })
  }

  const saveAttempts = async (): Promise<void> => {
    if (!attempts.length) return
    const { error } = await client
      .from('receipt_ai_attempts')
      .upsert(attempts, { onConflict: 'transaction_id,prompt_version' })
    if (error) {
      // Without the record the payments would be asked about again, so this is a failure.
      throw new Error(`Failed to record AI attempts: ${error.message}`)
    }
  }

  const [employees, vendors, aliases] = await Promise.all([
    loadPayrollEmployees(supabase),
    loadVendors(supabase),
    loadAliases(supabase),
  ])
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]))
  const personVendorIds = new Set(vendors.filter((vendor) => vendor.kind === 'person').map((vendor) => vendor.id))

  // ---- 1. Wage payments, recognised here ------------------------------------------------------
  const forModel: PaymentRow[] = []

  for (const payment of candidates) {
    const recognition = recognisePayrollPayment(
      payment.details,
      directionOf(payment),
      employees,
      settings.payrollReference
    )

    if (recognition.kind === 'none') {
      forModel.push(payment)
      continue
    }

    if (recognition.kind === 'check') {
      summary.payrollCheck += 1
      attempt(payment, { outcome: 'payroll_check', reasoning: PAYROLL_CHECK_NOTE[recognition.reason] })
      continue
    }

    const employeeName = `${recognition.employee.firstName} ${recognition.employee.lastName}`.replace(/\s+/g, ' ').trim()
    let vendor: ResolvedReceiptVendor | null
    try {
      vendor = await resolveReceiptVendor(
        supabase,
        { name: employeeName },
        { create: true, origin: 'payroll', kind: 'person' }
      )
      if (vendor && vendor.kind !== 'person') {
        // A vendor made before people were told apart from businesses.
        await client.from('receipt_vendors').update({ kind: 'person' }).eq('id', vendor.id)
      }
    } catch (vendorError) {
      console.error('Failed to resolve the vendor for a wage payment', vendorError)
      vendor = null
    }

    if (!vendor) {
      summary.failed += 1
      attempt(payment, { outcome: 'failed_retryable', error: 'The vendor for this wage payment could not be looked up' })
      continue
    }

    const after: Record<string, string | boolean | null> = {}
    if (needsVendor(payment)) {
      after.vendor_id = vendor.id
      after.vendor_name = vendor.canonicalName
      after.vendor_source = 'rule'
      after.vendor_rule_id = null
      after.vendor_updated_at = now
    }
    if (needsCategory(payment)) {
      after.expense_category = WAGES_CATEGORY
      after.expense_category_source = 'rule'
      after.expense_rule_id = null
      after.expense_updated_at = now
    }
    if (WAGE_MATCH_CLOSES_PAYMENT && canAutomationChangeStatus(payment)) {
      after.status = 'no_receipt_required'
      after.receipt_required = false
      after.marked_by = null
      after.marked_by_email = null
      after.marked_by_name = null
      after.marked_at = now
      after.marked_method = 'rule'
    }

    const outcome = await writeFields(supabase, payment, after, [
      { action_type: 'payroll_local', note: 'Recognised as a wage payment from the employee list' },
    ])

    if (outcome === 'applied') {
      summary.payrollLocal += 1
      attempt(payment, { outcome: 'payroll_local', vendor_id: vendor.id, vendor_written: Boolean(after.vendor_id) })
    } else if (outcome === 'locked') {
      summary.locked += 1
    } else if (outcome === 'failed') {
      summary.failed += 1
      attempt(payment, { outcome: 'failed_retryable', error: 'The wage classification could not be saved' })
    } else {
      summary.skippedProtected += 1
      attempt(payment, { outcome: 'skipped_protected', vendor_id: vendor.id })
    }
  }

  /**
   * Writes what the payment still needs and nothing else. Worked out from the payment as it is
   * at the moment of writing: a vendor or category that a rule or a person has set in the
   * meantime is left alone (5.0). If the payment changed while the model was answering, the
   * write is tried once more on the payment as it now is.
   */
  const writeWhatIsNeeded = async (
    payment: PaymentRow,
    wanted: {
      vendor: ResolvedReceiptVendor | null
      category: ReceiptExpenseCategory | null
      vendorNote: string
      categoryNote: string
    }
  ): Promise<{ outcome: ChangeOutcome | 'nothing'; vendorWritten: boolean; categoryWritten: boolean }> => {
    const plan = (target: PaymentRow) => {
      const after: Record<string, string | boolean | null> = {}
      const logs: FieldLog[] = []
      const vendor = wanted.vendor && needsVendor(target) ? wanted.vendor : null
      // The model's category went with its vendor. If something else has named a different
      // vendor in the meantime, the category is not written either.
      const vendorOverruled = Boolean(wanted.vendor) && !vendor && target.vendor_id !== wanted.vendor?.id
      const category = wanted.category && !vendorOverruled && needsCategory(target) ? wanted.category : null
      if (vendor) {
        after.vendor_id = vendor.id
        after.vendor_name = vendor.canonicalName
        after.vendor_source = 'ai'
        after.vendor_rule_id = null
        after.vendor_updated_at = now
        logs.push({ action_type: 'ai_vendor', note: wanted.vendorNote })
      }
      if (category) {
        after.expense_category = category
        after.expense_category_source = 'ai'
        after.expense_rule_id = null
        after.expense_updated_at = now
        logs.push({ action_type: 'ai_category', note: wanted.categoryNote })
      }
      return { after, logs, vendor: Boolean(vendor), category: Boolean(category) }
    }

    let step = plan(payment)
    if (!step.logs.length) return { outcome: 'nothing', vendorWritten: false, categoryWritten: false }

    let outcome = await writeFields(supabase, payment, step.after, step.logs)
    if (outcome === 'changed') {
      const fresh = await reloadPayment(supabase, payment.id)
      if (fresh) {
        step = plan(fresh)
        if (step.logs.length) outcome = await writeFields(supabase, fresh, step.after, step.logs)
      }
    }

    const applied = outcome === 'applied'
    return { outcome, vendorWritten: applied && step.vendor, categoryWritten: applied && step.category }
  }

  // ---- 2. A category from the vendor's own default, with no call ------------------------------
  const toSend: PaymentRow[] = []
  for (const payment of forModel) {
    const existingVendor = payment.vendor_id ? vendorById.get(payment.vendor_id) : undefined
    const defaultCategory = existingVendor?.default_expense_category
    if (!needsVendor(payment) && needsCategory(payment) && defaultCategory && EXPENSE_CATEGORY_OPTIONS.includes(defaultCategory as ReceiptExpenseCategory)) {
      const category = defaultCategory as ReceiptExpenseCategory
      const written = await writeWhatIsNeeded(payment, {
        vendor: null,
        category,
        vendorNote: '',
        categoryNote: `Category → ${category} (the default for this vendor)`,
      })

      if (written.categoryWritten) {
        summary.categoriesWritten += 1
        attempt(payment, {
          outcome: 'category_written',
          vendor_id: payment.vendor_id,
          proposed_expense_category: category,
          category_state: 'written',
          reasoning: 'The default category for this vendor',
        })
      } else if (written.outcome === 'locked') {
        summary.locked += 1
      } else if (written.outcome === 'failed') {
        summary.failed += 1
        attempt(payment, { outcome: 'failed_retryable', error: 'The category could not be saved' })
      } else {
        summary.skippedProtected += 1
        attempt(payment, { outcome: 'skipped_protected', vendor_id: payment.vendor_id })
      }
      continue
    }
    toSend.push(payment)
  }

  if (!toSend.length) {
    await saveAttempts()
    return summary
  }

  // ---- 3. The model ----------------------------------------------------------------------------
  // People are never on the list that is sent, and nor is any vendor whose name is a member of
  // staff's, whatever kind it was given.
  const vendorOptions: AiVendorOption[] = vendors
    .filter((vendor) => vendor.kind !== 'person' && !containsEmployeeName(vendor.canonical_name, employees))
    .map((vendor) => ({
      id: vendor.id,
      name: vendor.canonical_name,
      aliases: (aliases.get(vendor.id) ?? [])
        .filter((alias) => alias.trim().toLowerCase() !== vendor.canonical_name.trim().toLowerCase())
        .filter((alias) => !containsEmployeeName(alias, employees)),
    }))

  const examples = await loadExamples(supabase, employees, personVendorIds)

  const inputs: AiPaymentInput[] = toSend.map((payment) => ({
    id: payment.id,
    details: payment.details,
    amount: amountOf(payment),
    direction: directionOf(payment),
    transactionType: payment.transaction_type,
    merchantHint:
      payment.source_type === 'amex'
        ? [payment.merchant_category, payment.merchant_town].filter(Boolean).join(' · ') || null
        : null,
    needsVendor: needsVendor(payment),
    needsCategory: needsCategory(payment),
    existingVendor: needsVendor(payment) ? null : payment.vendor_name,
  }))

  summary.sent = toSend.length

  let results: AiPaymentResult[]
  let model: string
  try {
    const outcome = await classifyReceiptPayments({
      payments: inputs,
      vendors: vendorOptions,
      categories: EXPENSE_CATEGORY_OPTIONS,
      examples,
      signal: options.signal,
    })
    results = outcome.results
    model = outcome.model
    await recordAIUsage(supabase, outcome.usage, `receipt_classification:${toSend.length}`)
  } catch (error) {
    const retryable = error instanceof ReceiptAiError ? error.retryable : true
    const message = error instanceof Error ? error.message : 'The classification call failed'
    for (const payment of toSend) {
      const tries = (attemptsByPayment.get(payment.id)?.tries ?? 0) + 1
      attempt(payment, {
        // Out of tries: it stops being retried and is shown as needing attention.
        outcome: retryable && tries < MAX_TRIES ? 'failed_retryable' : 'failed_final',
        error: message,
      })
    }
    summary.failed += toSend.length
    await saveAttempts()
    if (retryable) {
      // Thrown so the queue tries again. What was done before the call is already saved.
      throw error
    }
    console.error('AI classification failed and will not be retried', error)
    return summary
  }

  const resultById = new Map(results.map((result) => [result.id, result]))
  const standingVendors = vendors.filter((vendor) => vendor.kind !== 'person')

  /** The vendor for a name the model gave that is not on the list it was sent. */
  const vendorForNewName = async (name: string): Promise<ResolvedReceiptVendor | null> => {
    if (containsEmployeeName(name, employees)) return null
    const existing = await resolveReceiptVendor(supabase, { name })
    if (existing) return existing.kind === 'person' ? null : existing

    // The same vendor under a different spelling ("Booker Ltd" for "Booker") is that vendor.
    const key = vendorMatchingKey(name)
    const sameKey = key ? standingVendors.find((vendor) => vendorMatchingKey(vendor.canonical_name) === key) : undefined
    if (sameKey) return resolveReceiptVendor(supabase, { vendorId: sameKey.id })

    return resolveReceiptVendor(supabase, { name }, { create: true, origin: 'ai', kind: 'business' })
  }

  for (const payment of toSend) {
    const result = resultById.get(payment.id)
    const tries = (attemptsByPayment.get(payment.id)?.tries ?? 0) + 1

    if (!result) {
      summary.failed += 1
      attempt(payment, {
        outcome: tries < MAX_TRIES ? 'failed_retryable' : 'failed_final',
        error: 'The model returned no answer for this payment',
        model,
      })
      continue
    }

    if (result.confidence === null || result.confidence < RECEIPT_AI_MIN_CONFIDENCE) {
      summary.lowConfidence += 1
      attempt(payment, { outcome: 'low_confidence', confidence: result.confidence, reasoning: result.reasoning, model })
      continue
    }

    let vendor: ResolvedReceiptVendor | null = null
    if (needsVendor(payment) && (result.vendorId || result.newVendorName)) {
      try {
        vendor = result.vendorId
          ? await resolveReceiptVendor(supabase, { vendorId: result.vendorId })
          : await vendorForNewName(result.newVendorName as string)
      } catch (vendorError) {
        console.error('Failed to resolve the vendor the model chose', vendorError)
        vendor = null
      }
    }

    // The category is written too (owner decision, 1 October 2026). A default a person set for
    // the vendor outranks the model. "No category applies" is the exception: it takes a payment
    // out of the figures, so it stays a suggestion for a person to accept.
    let category: ReceiptExpenseCategory | null = null
    let proposedNone = false
    if (needsCategory(payment)) {
      const vendorDefault = (vendor?.defaultExpenseCategory ??
        (payment.vendor_id ? vendorById.get(payment.vendor_id)?.default_expense_category : null) ??
        null) as ReceiptExpenseCategory | null
      const fromDefault = Boolean(vendorDefault && EXPENSE_CATEGORY_OPTIONS.includes(vendorDefault))
      category = fromDefault ? vendorDefault : result.expenseCategory
      proposedNone = !category && result.noCategoryApplies
    }

    const written = await writeWhatIsNeeded(payment, {
      vendor,
      category,
      vendorNote: vendor ? `Vendor → ${vendor.canonicalName} (AI, ${result.confidence}% sure)` : '',
      categoryNote: category ? `Category → ${category} (AI, ${result.confidence}% sure)` : '',
    })

    if (written.outcome === 'locked') {
      summary.locked += 1
      continue
    }

    if (written.outcome === 'failed') {
      summary.failed += 1
      attempt(payment, {
        outcome: tries < MAX_TRIES ? 'failed_retryable' : 'failed_final',
        error: 'The classification could not be saved',
        confidence: result.confidence,
        model,
      })
      continue
    }

    const { vendorWritten, categoryWritten } = written
    // Something was chosen, and a rule or a person had decided it by the time it was written.
    const blocked = written.outcome !== 'nothing' && written.outcome !== 'applied'

    if (vendorWritten) summary.vendorsWritten += 1
    if (categoryWritten) summary.categoriesWritten += 1
    if (proposedNone) summary.categoriesProposed += 1

    let outcome: ReceiptAiOutcome
    if (vendorWritten) outcome = 'vendor_written'
    else if (categoryWritten) outcome = 'category_written'
    else if (proposedNone) outcome = 'category_proposed'
    else if (blocked) outcome = 'skipped_protected'
    else outcome = 'nothing_identified'

    if (outcome === 'skipped_protected') summary.skippedProtected += 1
    if (outcome === 'nothing_identified') summary.nothingIdentified += 1

    attempt(payment, {
      outcome,
      vendor_id: vendor?.id ?? null,
      vendor_written: vendorWritten,
      proposed_expense_category: categoryWritten ? category : null,
      proposed_no_category: proposedNone,
      category_state: categoryWritten ? 'written' : proposedNone ? 'proposed' : 'none',
      confidence: result.confidence,
      reasoning: result.reasoning,
      model,
    })
  }

  await saveAttempts()
  return summary
}
