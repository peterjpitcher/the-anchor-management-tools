/**
 * Bulk apply: one vendor or category for the payments of a group on the bulk page.
 *
 * It used to send the group's description to the database, which changed every payment with
 * exactly that text. A fuzzy group is built on a tidied description, so its payments did not
 * match and "Apply" reported success for none; and a group that did match overwrote payments a
 * person had already classified by hand, with no way back.
 *
 * It now sends the payments themselves. What it does with them follows the protection policy
 * (spec 5.0): a value a person entered, accepted from the AI, or that came with the Amex import
 * is left alone unless the person asks for those to be included; the status is never touched; a
 * payment on or before the lock date is left alone. The caller is first told how many will
 * change and how many will not, and the change itself is a recorded run that can be undone.
 *
 * @requires Callers must verify user auth and 'receipts.manage'.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NO_CATEGORY_LABEL } from '@/lib/receipts/no-category'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'
import { normalizeVendorInput } from './receiptHelpers'
import { performRecordedRun, type RecordedRunChange } from './receiptRuleRuns'
import { loadReceiptSettings } from './receiptSettings'
import { resolveVendorForPersonWrite, type VendorConfirmation } from './receiptVendors'
import type { AdminClient } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A group on the bulk page holds at most a few hundred payments. This is a ceiling, not a target. */
const MAX_BULK_PAYMENTS = 2000
const READ_CHUNK = 200

/** Sources a person or the import decided. Bulk apply leaves these unless told to include them. */
const DECIDED_SOURCES = new Set(['manual', 'ai_accepted', 'import'])

export type BulkApplyPreview = {
  /** Payments the request named that still exist. */
  total: number
  willChange: number
  /** Already hold what was asked for. */
  unchanged: number
  /** Decided by a person (or the import), so left as they are. */
  decidedByPerson: number
  /** On or before the lock date. */
  locked: number
  /** Money in: it takes no expense category, so that part does not apply. */
  incomingSkipped: number
}

export type BulkApplyResult = {
  success?: boolean
  error?: string
  /** What would happen. Returned on its own when `confirm` is not set: nothing has been written. */
  preview?: BulkApplyPreview
  /** Set once the change has been made. Listed under Recent runs, where it can be undone. */
  runId?: string
  applied?: number
  /** Changed by someone else between the preview and the apply, so left alone. */
  skippedChanged?: number
  skippedLocked?: number
  /** The name is not on the vendor list. Nothing was saved; ask, then send again. */
  vendorConfirmation?: VendorConfirmation
}

type PaymentRow = Pick<
  ReceiptTransaction,
  | 'id'
  | 'transaction_date'
  | 'amount_in'
  | 'amount_out'
  | 'vendor_id'
  | 'vendor_name'
  | 'vendor_source'
  | 'expense_category'
  | 'expense_category_source'
  | 'updated_at'
> & { no_category_applies?: boolean | null }

const PAYMENT_COLUMNS =
  'id, transaction_date, amount_in, amount_out, vendor_id, vendor_name, vendor_source, expense_category, no_category_applies, expense_category_source, updated_at'

async function loadPayments(supabase: AdminClient, ids: string[]): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = []
  for (let index = 0; index < ids.length; index += READ_CHUNK) {
    const { data, error } = await (supabase as any)
      .from('receipt_transactions')
      .select(PAYMENT_COLUMNS)
      .in('id', ids.slice(index, index + READ_CHUNK))
    if (error) {
      throw new Error(`Failed to load transactions for bulk apply: ${error.message}`)
    }
    rows.push(...((data ?? []) as PaymentRow[]))
  }
  return rows
}

function isIncomingOnly(payment: PaymentRow): boolean {
  return Number(payment.amount_in ?? 0) > 0 && !(Number(payment.amount_out ?? 0) > 0)
}

type Target = {
  vendor?: { id: string | null; name: string | null }
  expense?: { category: ReceiptExpenseCategory | null; none: boolean }
}

/** What bulk apply would write on one payment, and why it would not. Pure. */
export function planBulkChange(
  payment: PaymentRow,
  target: Target,
  options: { includeDecided: boolean; lockDate: string | null; now: string }
): {
  after: Record<string, string | boolean | null>
  locked: boolean
  decided: boolean
  incomingSkipped: boolean
  notes: string[]
} {
  const after: Record<string, string | boolean | null> = {}
  const notes: string[] = []
  let decided = false
  let incomingSkipped = false

  if (options.lockDate && payment.transaction_date <= options.lockDate) {
    return { after, locked: true, decided: false, incomingSkipped: false, notes }
  }

  if (target.vendor) {
    const same = (payment.vendor_id ?? null) === target.vendor.id && (payment.vendor_name || null) === target.vendor.name
    if (!same) {
      if (!options.includeDecided && DECIDED_SOURCES.has(payment.vendor_source ?? '')) {
        decided = true
      } else {
        after.vendor_id = target.vendor.id
        after.vendor_name = target.vendor.name
        // A person chose it, here, for the whole group. A deliberate blank is a decision too.
        after.vendor_source = 'manual'
        after.vendor_rule_id = null
        after.vendor_updated_at = options.now
        notes.push(target.vendor.name ? `Vendor → ${target.vendor.name}` : 'Vendor cleared')
      }
    }
  }

  if (target.expense) {
    if (isIncomingOnly(payment) && (target.expense.category || target.expense.none)) {
      incomingSkipped = true
    } else {
      const same =
        (payment.expense_category ?? null) === target.expense.category &&
        Boolean(payment.no_category_applies) === target.expense.none
      if (!same) {
        if (!options.includeDecided && DECIDED_SOURCES.has(payment.expense_category_source ?? '')) {
          decided = true
        } else {
          after.expense_category = target.expense.category
          after.no_category_applies = target.expense.none
          after.expense_category_source = 'manual'
          after.expense_rule_id = null
          after.expense_updated_at = options.now
          notes.push(
            target.expense.category
              ? `Expense → ${target.expense.category}`
              : target.expense.none
                ? `Expense → ${NO_CATEGORY_LABEL.toLowerCase()}`
                : 'Expense cleared'
          )
        }
      }
    }
  }

  return { after, locked: false, decided, incomingSkipped, notes }
}

export async function performApplyReceiptBulkClassification(
  userId: string,
  input: {
    transactionIds: string[]
    /** Present (even as null, to clear) when the vendor is to be set. */
    vendorName?: string | null
    /** Present (even as null, to clear) when the category is to be set. */
    expenseCategory?: string | null
    /** With no category: these payments take none. */
    noCategoryApplies?: boolean
    /** The person has confirmed that a name not on the vendor list is a new vendor. */
    createVendor?: boolean
    /** Also change the payments a person, or the import, decided. */
    includeDecided?: boolean
    /** Make the change. Without it, only the preview is returned. */
    confirm?: boolean
    /** What the run is called under Recent runs. */
    label?: string
  }
): Promise<BulkApplyResult> {
  const vendorProvided = Object.prototype.hasOwnProperty.call(input, 'vendorName')
  const expenseProvided = Object.prototype.hasOwnProperty.call(input, 'expenseCategory')
  if (!vendorProvided && !expenseProvided) {
    return { error: 'Nothing to update' }
  }

  const ids = [...new Set((Array.isArray(input.transactionIds) ? input.transactionIds : []).filter((id) => typeof id === 'string'))]
  if (!ids.length) {
    return { error: 'This group has no transactions to change.' }
  }
  if (ids.length > MAX_BULK_PAYMENTS || ids.some((id) => !UUID_PATTERN.test(id))) {
    return { error: 'The group could not be read. Reload the page and try again.' }
  }

  const target: Target = {}

  if (expenseProvided) {
    const none = !input.expenseCategory && Boolean(input.noCategoryApplies)
    let category: ReceiptExpenseCategory | null = null
    if (input.expenseCategory) {
      const parsed = receiptExpenseCategorySchema.safeParse(input.expenseCategory)
      if (!parsed.success) {
        return { error: 'Expense category is not recognised' }
      }
      category = parsed.data
    }
    target.expense = { category, none }
  }

  const supabase = createAdminClient()

  if (vendorProvided) {
    const typed = typeof input.vendorName === 'string' ? input.vendorName : null
    const normalized = normalizeVendorInput(typed)
    // A name that is too long is refused, not cut: a cut name is not the one the person typed.
    if (typed && typed.trim() && (!normalized || typed.trim().length > 120)) {
      return { error: 'Vendor name must be between 1 and 120 characters' }
    }
    if (normalized) {
      try {
        const resolution = await resolveVendorForPersonWrite(supabase, normalized, { createVendor: input.createVendor })
        if (resolution.outcome === 'unknown') {
          return { vendorConfirmation: resolution.confirmation }
        }
        target.vendor = { id: resolution.vendor.id, name: resolution.vendor.canonicalName }
      } catch (vendorError) {
        console.error('Failed to resolve vendor for a bulk classification', vendorError)
        return { error: 'The vendor could not be looked up. Nothing was changed.' }
      }
    } else {
      target.vendor = { id: null, name: null }
    }
  }

  let payments: PaymentRow[]
  let lockDate: string | null
  try {
    ;[payments, lockDate] = await Promise.all([
      loadPayments(supabase, ids),
      loadReceiptSettings(supabase).then((settings) => settings.lockDate),
    ])
  } catch (error) {
    console.error('Failed to prepare a bulk classification', error)
    return { error: 'The transactions could not be loaded. Nothing was changed.' }
  }

  const now = new Date().toISOString()
  const preview: BulkApplyPreview = {
    total: payments.length,
    willChange: 0,
    unchanged: 0,
    decidedByPerson: 0,
    locked: 0,
    incomingSkipped: 0,
  }
  const changes: RecordedRunChange[] = []

  for (const payment of payments) {
    const plan = planBulkChange(payment, target, { includeDecided: Boolean(input.includeDecided), lockDate, now })
    if (plan.locked) {
      preview.locked += 1
      continue
    }
    if (plan.incomingSkipped) preview.incomingSkipped += 1
    if (Object.keys(plan.after).length === 0) {
      if (plan.decided) preview.decidedByPerson += 1
      else preview.unchanged += 1
      continue
    }
    if (plan.decided) preview.decidedByPerson += 1
    preview.willChange += 1
    changes.push({
      transaction_id: payment.id,
      expected_updated_at: payment.updated_at,
      after: plan.after,
      logs: [{ action_type: 'bulk_classification', note: `Bulk classification: ${plan.notes.join(' | ')}` }],
    })
  }

  if (!input.confirm) {
    return { success: true, preview }
  }

  if (!changes.length) {
    return { success: true, preview, applied: 0, skippedChanged: 0, skippedLocked: 0 }
  }

  const run = await performRecordedRun(supabase, userId, {
    kind: 'bulk_apply',
    label: (input.label ?? '').trim().slice(0, 120) || 'Bulk classification',
    lockDate,
    reviewed: payments.length,
    changes,
  })

  if (run.failure === 'not_recorded' || !run.runId) {
    return { error: 'The change could not be made. Nothing was changed.' }
  }
  if (run.failure) {
    return {
      error:
        run.failure === 'stale'
          ? 'The lock date changed while this was running. What was changed is recorded under Recent runs and can be undone.'
          : 'This stopped part-way. What was changed is recorded under Recent runs and can be undone.',
      preview,
      runId: run.runId,
      applied: run.applied,
      skippedChanged: run.skippedChanged,
      skippedLocked: run.skippedLocked,
    }
  }

  return {
    success: true,
    preview,
    runId: run.runId,
    applied: run.applied,
    skippedChanged: run.skippedChanged,
    skippedLocked: run.skippedLocked,
  }
}
