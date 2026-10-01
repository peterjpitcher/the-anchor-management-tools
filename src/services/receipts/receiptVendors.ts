/**
 * Vendors: the one resolver every writer uses, and the merge, rename and undo operations.
 *
 * A vendor's id is what a payment belongs to. Its name on the payment is always the surviving
 * vendor's current name, so a merge or rename is the only thing that changes it in bulk.
 *
 * @requires Callers must verify user auth and the permission for the action.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { findSimilarVendors, groupPossibleDuplicateVendors } from '@/lib/receipts/vendor-matching'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptExpenseCategory } from '@/types/database'
import type { AdminClient } from './types'

export type ReceiptVendorKind = 'business' | 'person'
export type ReceiptVendorOrigin = 'unknown' | 'manual' | 'rule' | 'invoice' | 'ai' | 'payroll'
export type ReceiptVendorLifecycle = 'unconfirmed' | 'confirmed' | 'merged' | 'inactive'

export type ResolvedReceiptVendor = {
  id: string
  canonicalName: string
  vendorKey: string
  status: ReceiptVendorLifecycle
  kind: ReceiptVendorKind
  defaultExpenseCategory: string | null
  /** True when this call created the vendor. */
  created: boolean
}

const MAX_VENDOR_NAME_LENGTH = 120
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Turns a name, an id, or both into the vendor that is standing now. A name is matched on its
 * exact key and then on the spellings the vendor answers to; a merged vendor leads to the one it
 * was merged into. Nothing is created unless `create` is set.
 *
 * Throws when the database cannot answer: a payment must not be saved with a guessed vendor.
 */
export async function resolveReceiptVendor(
  supabase: AdminClient,
  lookup: { name?: string | null; vendorId?: string | null },
  options: { create?: boolean; origin?: ReceiptVendorOrigin; kind?: ReceiptVendorKind } = {}
): Promise<ResolvedReceiptVendor | null> {
  const name = typeof lookup.name === 'string' ? lookup.name.trim() : ''
  const vendorId = lookup.vendorId ?? null
  if (!name && !vendorId) return null

  const { data, error } = await (supabase as any).rpc('resolve_receipt_vendor', {
    p_name: name || null,
    p_vendor_id: vendorId,
    p_create: Boolean(options.create),
    p_origin: options.origin ?? 'manual',
    p_kind: options.kind ?? 'business',
  })

  if (error) {
    throw new Error(`Failed to resolve receipt vendor: ${error.message}`)
  }
  if (!data || !data.vendor_id) return null

  return {
    id: data.vendor_id as string,
    canonicalName: data.canonical_name as string,
    vendorKey: data.vendor_key as string,
    status: data.status as ReceiptVendorLifecycle,
    kind: (data.kind as ReceiptVendorKind) ?? 'business',
    defaultExpenseCategory: (data.default_expense_category as string | null) ?? null,
    created: Boolean(data.created),
  }
}

export type SimilarVendor = { id: string; name: string }

/** Returned to the screen when a typed vendor name is not on the list. Nothing has been saved. */
export type VendorConfirmation = {
  name: string
  similar: SimilarVendor[]
}

export type VendorWriteResolution =
  | { outcome: 'resolved'; vendor: ResolvedReceiptVendor }
  | { outcome: 'unknown'; confirmation: VendorConfirmation }

async function loadActiveVendorNames(supabase: AdminClient): Promise<SimilarVendor[]> {
  const rows = await fetchAllRows<{ id: string; canonical_name: string }>(
    (from, to) =>
      supabase
        .from('receipt_vendors')
        .select('id, canonical_name')
        .in('status', ['unconfirmed', 'confirmed'])
        .order('canonical_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'receipt vendors for name matching' }
  )
  return rows.map((row) => ({ id: row.id, name: row.canonical_name }))
}

/**
 * For a name a person typed. A name already on the list resolves to that vendor. A new name
 * creates a vendor only when the person has confirmed it (`createVendor`); otherwise the
 * answer carries the existing vendors it might be, and the caller saves nothing.
 */
export async function resolveVendorForPersonWrite(
  supabase: AdminClient,
  name: string,
  options: { createVendor?: boolean; origin?: ReceiptVendorOrigin } = {}
): Promise<VendorWriteResolution> {
  const existing = await resolveReceiptVendor(supabase, { name })
  if (existing) return { outcome: 'resolved', vendor: existing }

  if (options.createVendor) {
    const created = await resolveReceiptVendor(supabase, { name }, { create: true, origin: options.origin ?? 'manual' })
    if (!created) {
      throw new Error('Failed to create receipt vendor')
    }
    return { outcome: 'resolved', vendor: created }
  }

  const vendors = await loadActiveVendorNames(supabase)
  const similar = findSimilarVendors(name, vendors).map(({ id, name: vendorName }) => ({ id, name: vendorName }))
  return { outcome: 'unknown', confirmation: { name: name.trim().replace(/\s+/g, ' '), similar } }
}

// ---------------------------------------------------------------------------
// The vendor list
// ---------------------------------------------------------------------------

export type ReceiptVendorDirectoryItem = {
  id: string
  name: string
  status: ReceiptVendorLifecycle
  kind: ReceiptVendorKind
  origin: ReceiptVendorOrigin
  defaultExpenseCategory: string | null
  mergedIntoVendorId: string | null
  mergedIntoName: string | null
  linkedToInvoicing: boolean
  createdAt: string
  paymentCount: number
  totalOutgoing: number
  totalIncome: number
  lastTransactionDate: string | null
  ruleCount: number
  aliases: string[]
}

export type ReceiptVendorOperation = {
  id: string
  operation: 'merge' | 'rename'
  vendorId: string
  sourceVendorId: string | null
  fromName: string
  toName: string
  transactions: number
  rules: number
  performedBy: string | null
  performedAt: string
  undoneAt: string | null
}

export type ReceiptVendorDirectory = {
  vendors: ReceiptVendorDirectoryItem[]
  /** Groups of standing vendors whose names look like one vendor. Suggestions only. */
  possibleDuplicates: Array<Array<{ id: string; name: string; paymentCount: number }>>
  recentOperations: ReceiptVendorOperation[]
}

type DirectoryRow = {
  id: string
  canonical_name: string
  vendor_key: string
  status: ReceiptVendorLifecycle
  kind: ReceiptVendorKind
  origin: ReceiptVendorOrigin
  default_expense_category: string | null
  merged_into_vendor_id: string | null
  invoice_vendor_id: string | null
  created_at: string
  payment_count: number | string
  total_outgoing: number | string
  total_income: number | string
  last_transaction_date: string | null
  rule_count: number | string
  aliases: string[] | null
}

type OperationRow = {
  id: string
  operation: 'merge' | 'rename'
  vendor_id: string
  source_vendor_id: string | null
  performed_by: string | null
  performed_at: string
  summary: Record<string, unknown> | null
  undone_at: string | null
}

function toOperation(row: OperationRow): ReceiptVendorOperation {
  const summary = row.summary ?? {}
  return {
    id: row.id,
    operation: row.operation,
    vendorId: row.vendor_id,
    sourceVendorId: row.source_vendor_id,
    fromName: String(summary.from_name ?? ''),
    toName: String((row.operation === 'merge' ? summary.into_name : summary.to_name) ?? ''),
    transactions: Number(summary.transactions ?? 0),
    rules: Number(summary.rules ?? 0),
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    undoneAt: row.undone_at,
  }
}

export async function queryReceiptVendorDirectory(): Promise<ReceiptVendorDirectory> {
  const supabase = createAdminClient()

  const [rows, operations] = await Promise.all([
    fetchAllRows<DirectoryRow>(
      (from, to) => (supabase as any).rpc('get_receipt_vendor_directory').range(from, to),
      { label: 'receipt vendor directory' }
    ),
    (supabase as any)
      .from('receipt_vendor_operations')
      .select('id, operation, vendor_id, source_vendor_id, performed_by, performed_at, summary, undone_at')
      .order('performed_at', { ascending: false })
      .limit(20),
  ])

  if (operations.error) {
    throw new Error(`Failed to load receipt vendor operations: ${operations.error.message}`)
  }

  const nameById = new Map(rows.map((row) => [row.id, row.canonical_name]))

  const vendors: ReceiptVendorDirectoryItem[] = rows.map((row) => ({
    id: row.id,
    name: row.canonical_name,
    status: row.status,
    kind: row.kind,
    origin: row.origin,
    defaultExpenseCategory: row.default_expense_category,
    mergedIntoVendorId: row.merged_into_vendor_id,
    mergedIntoName: row.merged_into_vendor_id ? nameById.get(row.merged_into_vendor_id) ?? null : null,
    linkedToInvoicing: Boolean(row.invoice_vendor_id),
    createdAt: row.created_at,
    paymentCount: Number(row.payment_count ?? 0),
    totalOutgoing: Number(row.total_outgoing ?? 0),
    totalIncome: Number(row.total_income ?? 0),
    lastTransactionDate: row.last_transaction_date,
    ruleCount: Number(row.rule_count ?? 0),
    aliases: row.aliases ?? [],
  }))

  const standing = vendors.filter((vendor) => vendor.status === 'unconfirmed' || vendor.status === 'confirmed')
  const possibleDuplicates = groupPossibleDuplicateVendors(
    standing.map((vendor) => ({ id: vendor.id, name: vendor.name, paymentCount: vendor.paymentCount }))
  )

  return {
    vendors,
    possibleDuplicates,
    recentOperations: ((operations.data ?? []) as OperationRow[]).map(toOperation),
  }
}

// ---------------------------------------------------------------------------
// Merge, rename, undo
// ---------------------------------------------------------------------------

export type VendorOperationResult = {
  success?: boolean
  error?: string
  operationId?: string
  fromName?: string
  toName?: string
  transactions?: number
  rules?: number
  /** Set when a rename was refused because another vendor has the name: offer a merge. */
  existingVendor?: SimilarVendor
}

const MERGE_REFUSALS: Record<string, string> = {
  not_found: 'One of those vendors no longer exists. Refresh the list and try again.',
  same_vendor: 'Choose two different vendors to merge.',
  already_merged: 'That vendor has already been merged into another.',
  target_merged: 'The vendor you are merging into has itself been merged. Choose the vendor it was merged into.',
}

export async function performMergeReceiptVendor(
  userId: string,
  input: { fromVendorId: string; intoVendorId: string }
): Promise<VendorOperationResult> {
  if (!UUID_PATTERN.test(input.fromVendorId) || !UUID_PATTERN.test(input.intoVendorId)) {
    return { error: 'Choose the vendors to merge.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('merge_receipt_vendor', {
    p_from: input.fromVendorId,
    p_into: input.intoVendorId,
    p_performed_by: userId,
  })

  if (error || !data) {
    console.error('Failed to merge receipt vendors:', error)
    return { error: 'The vendors could not be merged. Nothing was changed.' }
  }
  if (data.outcome !== 'merged') {
    return { error: MERGE_REFUSALS[data.outcome as string] ?? 'The vendors could not be merged.' }
  }

  return {
    success: true,
    operationId: data.operation_id as string,
    fromName: data.from_name as string,
    toName: data.into_name as string,
    transactions: Number(data.transactions ?? 0),
    rules: Number(data.rules ?? 0),
  }
}

export async function performRenameReceiptVendor(
  userId: string,
  input: { vendorId: string; name: string }
): Promise<VendorOperationResult> {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
  if (!UUID_PATTERN.test(input.vendorId)) {
    return { error: 'Choose the vendor to rename.' }
  }
  if (!name || name.length > MAX_VENDOR_NAME_LENGTH) {
    return { error: `A vendor name must be between 1 and ${MAX_VENDOR_NAME_LENGTH} characters.` }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('rename_receipt_vendor', {
    p_vendor_id: input.vendorId,
    p_name: name,
    p_performed_by: userId,
  })

  if (error || !data) {
    console.error('Failed to rename receipt vendor:', error)
    return { error: 'The vendor could not be renamed. Nothing was changed.' }
  }

  switch (data.outcome) {
    case 'renamed':
      return {
        success: true,
        operationId: data.operation_id as string,
        fromName: data.from_name as string,
        toName: data.to_name as string,
        transactions: Number(data.transactions ?? 0),
        rules: Number(data.rules ?? 0),
      }
    case 'unchanged':
      return { error: 'That is already the name of this vendor.' }
    case 'name_taken':
      return {
        error: data.canonical_name
          ? `"${data.canonical_name}" already uses that name. Merge the two vendors instead.`
          : 'Another vendor already uses that name.',
        existingVendor: data.vendor_id
          ? { id: data.vendor_id as string, name: (data.canonical_name as string) ?? name }
          : undefined,
      }
    case 'vendor_merged':
      return { error: 'That vendor has been merged into another and cannot be renamed.' }
    case 'invalid_name':
      return { error: 'Enter a vendor name.' }
    default:
      return { error: 'That vendor no longer exists. Refresh the list and try again.' }
  }
}

export type VendorUndoResult = {
  success?: boolean
  error?: string
  alreadyUndone?: boolean
  operation?: 'merge' | 'rename'
  transactionsRestored?: number
  transactionConflicts?: number
  rulesRestored?: number
  ruleConflicts?: number
}

export async function performUndoReceiptVendorOperation(userId: string, operationId: string): Promise<VendorUndoResult> {
  if (!UUID_PATTERN.test(operationId)) {
    return { error: 'Choose the change to undo.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('undo_receipt_vendor_operation', {
    p_operation_id: operationId,
    p_performed_by: userId,
  })

  if (error || !data) {
    console.error('Failed to undo receipt vendor operation:', error)
    return { error: 'The change could not be undone. Nothing was changed.' }
  }

  if (data.outcome === 'not_found') {
    return { error: 'That change no longer exists.' }
  }
  if (data.outcome === 'blocked') {
    return {
      error:
        data.reason === 'name_taken'
          ? 'The old name now belongs to another vendor, so this rename cannot be undone.'
          : 'This vendor has been merged or renamed since. Undo the later change first.',
    }
  }

  return {
    success: true,
    alreadyUndone: data.outcome === 'already_undone',
    operation: data.operation as 'merge' | 'rename',
    transactionsRestored: Number(data.transactions_restored ?? 0),
    transactionConflicts: Number(data.transaction_conflicts ?? 0),
    rulesRestored: Number(data.rules_restored ?? 0),
    ruleConflicts: Number(data.rule_conflicts ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Details a manager can set: confirm, deactivate, kind, default category
// ---------------------------------------------------------------------------

export type VendorDetailsInput = {
  vendorId: string
  status?: 'unconfirmed' | 'confirmed' | 'inactive'
  kind?: ReceiptVendorKind
  /** Null clears it. */
  defaultExpenseCategory?: ReceiptExpenseCategory | null
}

export type VendorDetailsResult = {
  success?: boolean
  error?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  name?: string
}

export async function performUpdateReceiptVendorDetails(input: VendorDetailsInput): Promise<VendorDetailsResult> {
  if (!UUID_PATTERN.test(input.vendorId)) {
    return { error: 'Choose a vendor.' }
  }

  const patch: Record<string, unknown> = {}
  if (input.status !== undefined) {
    if (!['unconfirmed', 'confirmed', 'inactive'].includes(input.status)) {
      return { error: 'That status is not recognised.' }
    }
    patch.status = input.status
  }
  if (input.kind !== undefined) {
    if (input.kind !== 'business' && input.kind !== 'person') {
      return { error: 'A vendor is either a business or a person.' }
    }
    patch.kind = input.kind
  }
  if (input.defaultExpenseCategory !== undefined) {
    if (input.defaultExpenseCategory !== null && !receiptExpenseCategorySchema.safeParse(input.defaultExpenseCategory).success) {
      return { error: 'That expense category is not recognised.' }
    }
    patch.default_expense_category = input.defaultExpenseCategory
  }
  if (!Object.keys(patch).length) {
    return { error: 'Nothing to update.' }
  }

  const supabase = createAdminClient()
  const { data: current, error: loadError } = await (supabase as any)
    .from('receipt_vendors')
    .select('id, canonical_name, status, kind, default_expense_category')
    .eq('id', input.vendorId)
    .maybeSingle()

  if (loadError) {
    console.error('Failed to load receipt vendor:', loadError)
    return { error: 'The vendor could not be loaded.' }
  }
  if (!current) {
    return { error: 'That vendor no longer exists.' }
  }
  if (current.status === 'merged') {
    return { error: 'That vendor has been merged into another. Change the vendor it was merged into.' }
  }

  // The status filter makes sure a merge that lands in between is not overwritten.
  const { data: updated, error: updateError } = await (supabase as any)
    .from('receipt_vendors')
    .update(patch)
    .eq('id', input.vendorId)
    .in('status', ['unconfirmed', 'confirmed', 'inactive'])
    .select('id, canonical_name, status, kind, default_expense_category')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to update receipt vendor:', updateError)
    return { error: 'The vendor could not be updated.' }
  }
  if (!updated) {
    return { error: 'That vendor was changed by someone else. Refresh the list and try again.' }
  }

  return {
    success: true,
    name: updated.canonical_name as string,
    before: { status: current.status, kind: current.kind, default_expense_category: current.default_expense_category },
    after: { status: updated.status, kind: updated.kind, default_expense_category: updated.default_expense_category },
  }
}
