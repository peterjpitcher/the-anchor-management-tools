'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { fromZonedTime } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { generatePhoneVariants } from '@/lib/utils'
import {
  MAX_PER_TYPE_PER_BATCH,
  MAX_CARDS_PER_BATCH,
  LOW_STOCK_THRESHOLD,
  EVENT_DAY_CUTOVER_HOUR,
  LOOKUP_MAX_RESULTS,
} from '@/lib/vouchers/constants'
import { normaliseVoucherNumberInput, isFullVoucherNumber } from '@/lib/vouchers/numbering'
import { quickAddVoucherCustomer, QuickAddCustomerError } from '@/lib/vouchers/customer-quick-add'
import { completedLondonDaysSince, ageBucket, humaniseAge } from '@/lib/vouchers/age'
import {
  mapVoucherRow,
  mapVoucherBatchRow,
  mapVoucherTypeRow,
  mapTermsVersionRow,
  mapVoucherEventRow,
  mapVoucherReminderRow,
} from '@/types/vouchers'
import type {
  Voucher,
  VoucherRow,
  VoucherBatch,
  VoucherBatchRow,
  VoucherType,
  VoucherTypeRow,
  TermsVersion,
  TermsVersionRow,
  VoucherEvent,
  VoucherEventRow,
  VoucherReminder,
  VoucherReminderRow,
  VoucherStatus,
  VoucherAgeBucket,
  BatchPdfStatus,
} from '@/types/vouchers'

const LONDON_TZ = 'Europe/London'
const ACTIVE_BOOKING_STATUSES = ['confirmed', 'pending_payment']

// ---------------------------------------------------------------------------
// Shared result and view types (type-only exports are allowed in a
// 'use server' module; runtime exports must all be async functions)
// ---------------------------------------------------------------------------

export interface VoucherMutationData {
  voucher: Voucher
  replacement?: Voucher
  idempotentReplay?: boolean
}

export interface VoucherStockRow {
  typeId: string
  displayTitle: string
  valuePence: number | null
  inStock: number
  issued: number
  redeemed: number
  expired: number
  cancelled: number
  lowStock: boolean
}

export interface VoucherNotPrintableBatch {
  batchId: string
  createdAt: string
  createdByName: string
  note: string | null
  totalCount: number
  pdfStatus: BatchPdfStatus
  renderError: string | null
}

export interface VoucherSummary {
  stock: VoucherStockRow[]
  totals: { inStock: number; issued: number; redeemed: number; expired: number; cancelled: number }
  tiles: {
    totalInStock: number
    totalOutstanding: number
    redeemedThisMonth: number
    outstandingValuePence: number
  }
  ageBuckets: { bucket: VoucherAgeBucket; count: number }[]
  expiringSoon: number
  todayIso: string
  monthStartIso: string
  notPrintable: VoucherNotPrintableBatch[]
}

export interface VoucherLedgerFilters {
  status?: VoucherStatus[]
  typeIds?: string[]
  batchId?: string
  eventId?: string
  customerId?: string
  generatedFrom?: string
  generatedTo?: string
  issuedFrom?: string
  issuedTo?: string
  redeemedFrom?: string
  redeemedTo?: string
  expiringWithinDays?: number
  batchReady?: boolean
  q?: string
  page?: number
  pageSize?: number
}

export interface VoucherLedgerRow {
  voucher: Voucher
  typeTitle: string
  customerName: string | null
  eventName: string | null
  batchReady: boolean
  ageDays: number | null
  ageLabel: string | null
}

export interface VoucherLedgerResult {
  rows: VoucherLedgerRow[]
  total: number
  page: number
  pageSize: number
}

export interface VoucherDetail {
  voucher: Voucher
  // The stored status with the expiry applied, exactly as the FOH lookup derives
  // it: the nightly sweep can be up to a day behind, and a voucher that is still
  // stored as 'issued' past its expiry must be treated as expired everywhere.
  effectiveStatus: VoucherStatus
  type: VoucherType | null
  entitlementHtml: string | null
  batchPdfStatus: BatchPdfStatus | null
  batchCreatedAt: string | null
  events: VoucherEvent[]
  reminders: VoucherReminder[]
  customer: { id: string; name: string; mobile: string | null } | null
  eventName: string | null
  replacedByNumber: string | null
  replacesNumber: string | null
  ageDays: number | null
  ageLabel: string | null
}

export interface HandoutEventOption {
  id: string
  name: string
  date: string
  time: string | null
}

export interface HandoutStaffOption {
  employeeId: string
  name: string
  clockedIn: boolean
}

export interface HandoutContextData {
  events: HandoutEventOption[]
  staff: HandoutStaffOption[]
  todayIso: string
}

export interface VoucherBatchProgress {
  batch: VoucherBatch
  countsByType: { typeId: string; displayTitle: string; count: number }[]
  firstNumber: string | null
  lastNumber: string | null
  deadCount: number
}

export interface VoucherCustomerHit {
  id: string
  name: string
  mobile: string | null
}

export interface EventBookerChip {
  customerId: string
  name: string
  seats: number
}

export interface ReplacementCandidate {
  id: string
  voucherNumber: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface VoucherRpcResult {
  success: boolean
  error_code?: string
  current_status?: VoucherStatus | null
  message?: string
  which?: string
  voucher?: VoucherRow
  replacement?: VoucherRow
  idempotent_replay?: boolean
  no_change?: boolean
  batch_id?: string
  total_count?: number
  first_number?: string
  last_number?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_REDEEMED: 'This voucher has already been redeemed.',
  ALREADY_ISSUED: 'This voucher has already been handed out.',
  EXPIRED: 'This voucher has expired. A manager can redeem it despite expiry from the voucher page.',
  NOT_ISSUED: 'This voucher has not been handed out yet.',
  NOT_REDEEMED: 'This voucher has not been redeemed, so there is nothing to undo.',
  NOT_EXPIRED: 'This voucher has not expired, so an override redemption is not needed.',
  CANCELLED: 'This voucher has been cancelled and can no longer be used.',
  REPLACED: 'This voucher has been replaced and can no longer be used.',
  NOT_FOUND: 'No voucher with that number was found.',
  UNDO_WINDOW_CLOSED: 'The undo window has closed. A manager can still undo the redemption with a reason.',
  BATCH_NOT_READY: 'The print run for this voucher is not marked ready yet, so it cannot be handed out.',
  REPLACEMENT_NOT_AVAILABLE: 'That replacement card is not available. Pick another card from stock of the same type.',
  VALIDATION_ERROR: 'Some of the details entered are not valid.',
  FORBIDDEN: 'You do not have permission to do that.',
  RENDER_FAILED: 'The PDF for this batch could not be rendered.',
}

function rpcErrorMessage(result: VoucherRpcResult): string {
  const prefix = result.which === 'replacement' ? 'Replacement card: ' : ''
  if (result.error_code === 'VALIDATION_ERROR' && result.message) {
    return `${prefix}${result.message}`
  }
  const base = result.error_code ? ERROR_MESSAGES[result.error_code] : undefined
  if (base) return `${prefix}${base}`
  return result.message ?? 'The voucher operation was refused.'
}

interface ActorContext {
  userId: string
  actorName: string
}

async function requireVouchersManage(): Promise<ActorContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const allowed = await checkUserPermission('vouchers', 'manage', user.id)
  if (!allowed) return null
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const fullName = typeof meta.full_name === 'string' && meta.full_name.trim().length > 0
    ? meta.full_name.trim()
    : null
  return { userId: user.id, actorName: fullName ?? user.email ?? 'Manager' }
}

async function lookupActiveEmployee(
  employeeId: string
): Promise<{ name: string } | { error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, status')
    .eq('employee_id', employeeId)
    .single()
  if (error || !data) return { error: 'Staff member not found.' }
  const row = data as { first_name: string | null; last_name: string | null; status: string | null }
  if (row.status !== 'Active') return { error: 'Choose an active staff member.' }
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return { name: name || 'Unknown' }
}

async function callVoucherRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<{ result: VoucherRpcResult } | { error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc(fn, args)
  if (error) {
    console.error(`Voucher RPC ${fn} failed`, error)
    return { error: 'Something went wrong talking to the database. Please try again.' }
  }
  return { result: data as VoucherRpcResult }
}

function requireFullNumber(raw: string): { number: string } | { error: string } {
  const normalised = normaliseVoucherNumberInput(raw)
  if (!isFullVoucherNumber(normalised)) {
    return { error: 'Enter the full voucher number, for example AN-2607-0148.' }
  }
  return { number: normalised }
}

function londonHourNow(): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date())
  )
}

function londonDayStartIso(isoDate: string): string {
  return fromZonedTime(`${isoDate}T00:00:00`, LONDON_TZ).toISOString()
}

function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

function previousIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function voucherAge(voucher: Voucher): { ageDays: number | null; ageLabel: string | null } {
  if (!voucher.issuedAt || !['issued', 'redeemed', 'expired'].includes(voucher.status)) {
    return { ageDays: null, ageLabel: null }
  }
  const days = completedLondonDaysSince(voucher.issuedAt)
  return { ageDays: days, ageLabel: humaniseAge(days) }
}

async function auditVoucherMutation(
  ctx: ActorContext,
  operation: string,
  resourceId: string,
  info: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    user_id: ctx.userId,
    operation_type: operation,
    resource_type: 'voucher',
    resource_id: resourceId,
    operation_status: 'success',
    additional_info: info,
  })
}

function revalidateVoucherPaths(voucherNumber?: string): void {
  revalidatePath('/vouchers')
  revalidatePath('/vouchers/all')
  if (voucherNumber) revalidatePath(`/vouchers/${voucherNumber}`)
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
const idempotencyKeySchema = z.string().min(8).max(64)
const reasonSchema = z.string().trim().min(3, 'Give a short reason').max(500)
const voucherNumberSchema = z.string().trim().min(1, 'Enter a voucher number')

const createBatchSchema = z.object({
  items: z
    .array(
      z.object({
        typeId: z.string().min(1),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(MAX_PER_TYPE_PER_BATCH, `Maximum ${MAX_PER_TYPE_PER_BATCH} per type in one batch`),
      })
    )
    .min(1, 'Choose at least one voucher'),
  note: z.string().trim().max(500).optional(),
})

const issueSchema = z.object({
  voucherNumber: voucherNumberSchema,
  employeeId: z.string().uuid('Choose the staff member handing the card out'),
  eventId: z.string().uuid().nullable().optional(),
  wonAtLabel: z.string().trim().min(1, 'Say where the voucher was won').max(200),
  expiryDate: isoDateSchema,
  customerId: z.string().uuid().nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
})

const redeemSchema = z.object({
  voucherNumber: voucherNumberSchema,
  employeeId: z.string().uuid('Choose the staff member taking the card'),
  transactionRef: z.string().trim().max(100).optional(),
  bookingRef: z.string().trim().max(100).optional(),
  idempotencyKey: idempotencyKeySchema,
})

const undoRedeemSchema = z.object({
  voucherNumber: voucherNumberSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
})

const cancelSchema = z.object({
  voucherNumber: voucherNumberSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
})

const replaceSchema = z.object({
  originalNumber: voucherNumberSchema,
  replacementNumber: voucherNumberSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema,
})

const editHandoutSchema = z.object({
  voucherNumber: voucherNumberSchema,
  reason: reasonSchema,
  patch: z
    .object({
      employeeId: z.string().uuid().optional(),
      eventId: z.string().uuid().nullable().optional(),
      wonAtLabel: z.string().trim().min(1).max(200).optional(),
      expiryDate: isoDateSchema.optional(),
    })
    .refine(
      (value) => Object.values(value).some((entry) => entry !== undefined),
      'Change at least one hand-out detail'
    ),
})

const assignCustomerSchema = z.object({
  voucherNumber: voucherNumberSchema,
  customerId: z.string().uuid().nullable(),
})

const overrideRedeemSchema = z.object({
  voucherNumber: voucherNumberSchema,
  reason: reasonSchema,
  employeeId: z.string().uuid('Choose the staff member taking the card'),
  transactionRef: z.string().trim().max(100).optional(),
  bookingRef: z.string().trim().max(100).optional(),
  idempotencyKey: idempotencyKeySchema,
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createVoucherBatch(input: {
  items: { typeId: string; quantity: number }[]
  note?: string
}): Promise<{ success?: boolean; error?: string; data?: { batchId: string; totalCount: number; firstNumber: string | null; lastNumber: string | null } }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to generate vouchers.' }

  const parsed = createBatchSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const total = parsed.data.items.reduce((sum, item) => sum + item.quantity, 0)
  if (total > MAX_CARDS_PER_BATCH) {
    return {
      error: `A batch can hold at most ${MAX_CARDS_PER_BATCH} cards. Split larger runs into separate batches.`,
    }
  }

  const rpc = await callVoucherRpc('voucher_generate_batch', {
    p_items: parsed.data.items.map((item) => ({ type_id: item.typeId, quantity: item.quantity })),
    p_note: parsed.data.note?.trim() ? parsed.data.note.trim() : null,
    p_created_by: ctx.userId,
    p_created_by_name: ctx.actorName,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success) return { error: rpcErrorMessage(rpc.result) }

  const batchId = rpc.result.batch_id as string
  await logAuditEvent({
    user_id: ctx.userId,
    operation_type: 'create',
    resource_type: 'voucher_batch',
    resource_id: batchId,
    operation_status: 'success',
    additional_info: { total_count: rpc.result.total_count, items: parsed.data.items },
  })
  revalidateVoucherPaths()

  return {
    success: true,
    data: {
      batchId,
      totalCount: rpc.result.total_count ?? total,
      firstNumber: rpc.result.first_number ?? null,
      lastNumber: rpc.result.last_number ?? null,
    },
  }
}

export async function issueVoucher(input: {
  voucherNumber: string
  employeeId: string
  eventId?: string | null
  wonAtLabel: string
  expiryDate: string
  customerId?: string | null
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to hand out vouchers.' }

  const parsed = issueSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  if (parsed.data.expiryDate < getTodayIsoDate()) {
    return { error: 'The expiry date cannot be in the past.' }
  }

  const employee = await lookupActiveEmployee(parsed.data.employeeId)
  if ('error' in employee) return { error: employee.error }

  const rpc = await callVoucherRpc('voucher_issue', {
    p_voucher_number: numberCheck.number,
    p_employee_id: parsed.data.employeeId,
    p_employee_name: employee.name,
    p_user_id: ctx.userId,
    p_event_id: parsed.data.eventId ?? null,
    p_won_at_label: parsed.data.wonAtLabel,
    p_expiry_date: parsed.data.expiryDate,
    p_customer_id: parsed.data.customerId ?? null,
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'issue', voucher.id, {
      voucher_number: voucher.voucherNumber,
      employee_id: parsed.data.employeeId,
      expiry_date: parsed.data.expiryDate,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return {
    success: true,
    data: { voucher, idempotentReplay: rpc.result.idempotent_replay },
  }
}

export async function redeemVoucher(input: {
  voucherNumber: string
  employeeId: string
  transactionRef?: string
  bookingRef?: string
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to redeem vouchers.' }

  const parsed = redeemSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const employee = await lookupActiveEmployee(parsed.data.employeeId)
  if ('error' in employee) return { error: employee.error }

  const rpc = await callVoucherRpc('voucher_redeem', {
    p_voucher_number: numberCheck.number,
    p_employee_id: parsed.data.employeeId,
    p_employee_name: employee.name,
    p_user_id: ctx.userId,
    p_transaction_ref: parsed.data.transactionRef?.trim() ? parsed.data.transactionRef.trim() : null,
    p_booking_ref: parsed.data.bookingRef?.trim() ? parsed.data.bookingRef.trim() : null,
    p_customer_id: null,
    p_london_today: getTodayIsoDate(),
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'redeem', voucher.id, {
      voucher_number: voucher.voucherNumber,
      employee_id: parsed.data.employeeId,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher, idempotentReplay: rpc.result.idempotent_replay } }
}

export async function undoVoucherRedeem(input: {
  voucherNumber: string
  reason: string
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to undo redemptions.' }

  const parsed = undoRedeemSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const rpc = await callVoucherRpc('voucher_undo_redeem', {
    p_voucher_number: numberCheck.number,
    p_user_id: ctx.userId,
    p_employee_id: null,
    p_actor_name: ctx.actorName,
    p_require_recent: false,
    p_reason: parsed.data.reason,
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'undo_redeem', voucher.id, {
      voucher_number: voucher.voucherNumber,
      reason: parsed.data.reason,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher, idempotentReplay: rpc.result.idempotent_replay } }
}

export async function cancelVoucher(input: {
  voucherNumber: string
  reason: string
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to cancel vouchers.' }

  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const rpc = await callVoucherRpc('voucher_cancel', {
    p_voucher_number: numberCheck.number,
    p_reason: parsed.data.reason,
    p_user_id: ctx.userId,
    p_employee_id: null,
    p_actor_name: ctx.actorName,
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'cancel', voucher.id, {
      voucher_number: voucher.voucherNumber,
      reason: parsed.data.reason,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher, idempotentReplay: rpc.result.idempotent_replay } }
}

export async function replaceVoucher(input: {
  originalNumber: string
  replacementNumber: string
  reason: string
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to replace vouchers.' }

  const parsed = replaceSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const originalCheck = requireFullNumber(parsed.data.originalNumber)
  if ('error' in originalCheck) return { error: originalCheck.error }
  const replacementCheck = requireFullNumber(parsed.data.replacementNumber)
  if ('error' in replacementCheck) return { error: replacementCheck.error }

  const rpc = await callVoucherRpc('voucher_replace', {
    p_original_number: originalCheck.number,
    p_replacement_number: replacementCheck.number,
    p_reason: parsed.data.reason,
    p_user_id: ctx.userId,
    p_employee_id: null,
    p_actor_name: ctx.actorName,
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  const replacement = rpc.result.replacement ? mapVoucherRow(rpc.result.replacement) : undefined
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'replace', voucher.id, {
      voucher_number: voucher.voucherNumber,
      replacement_number: replacement?.voucherNumber,
      reason: parsed.data.reason,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  if (replacement) revalidatePath(`/vouchers/${replacement.voucherNumber}`)
  return {
    success: true,
    data: { voucher, replacement, idempotentReplay: rpc.result.idempotent_replay },
  }
}

export async function editVoucherHandout(input: {
  voucherNumber: string
  reason: string
  patch: {
    employeeId?: string
    eventId?: string | null
    wonAtLabel?: string
    expiryDate?: string
  }
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to edit hand-out details.' }

  const parsed = editHandoutSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const patch: Record<string, string> = {}
  if (parsed.data.patch.employeeId !== undefined) {
    const employee = await lookupActiveEmployee(parsed.data.patch.employeeId)
    if ('error' in employee) return { error: employee.error }
    patch.issued_by = parsed.data.patch.employeeId
    patch.issued_by_name = employee.name
  }
  if (parsed.data.patch.eventId !== undefined) {
    patch.event_id = parsed.data.patch.eventId ?? ''
  }
  if (parsed.data.patch.wonAtLabel !== undefined) {
    patch.won_at_label = parsed.data.patch.wonAtLabel
  }
  if (parsed.data.patch.expiryDate !== undefined) {
    patch.expiry_date = parsed.data.patch.expiryDate
  }

  const rpc = await callVoucherRpc('voucher_edit_handout', {
    p_voucher_number: numberCheck.number,
    p_patch: patch,
    p_reason: parsed.data.reason,
    p_user_id: ctx.userId,
    p_employee_id: null,
    p_actor_name: ctx.actorName,
    p_source: 'management',
    p_london_today: getTodayIsoDate(),
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  await auditVoucherMutation(ctx, 'edit_handout', voucher.id, {
    voucher_number: voucher.voucherNumber,
    patch,
    reason: parsed.data.reason,
  })
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher } }
}

export async function assignVoucherCustomer(input: {
  voucherNumber: string
  customerId: string | null
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to change voucher customers.' }

  const parsed = assignCustomerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const rpc = await callVoucherRpc('voucher_assign_customer', {
    p_voucher_number: numberCheck.number,
    p_customer_id: parsed.data.customerId,
    p_user_id: ctx.userId,
    p_employee_id: null,
    p_actor_name: ctx.actorName,
    p_source: 'management',
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.no_change) {
    await auditVoucherMutation(
      ctx,
      parsed.data.customerId ? 'assign_customer' : 'remove_customer',
      voucher.id,
      { voucher_number: voucher.voucherNumber, customer_id: parsed.data.customerId }
    )
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher } }
}

export async function overrideRedeemVoucher(input: {
  voucherNumber: string
  reason: string
  employeeId: string
  transactionRef?: string
  bookingRef?: string
  idempotencyKey: string
}): Promise<{ success?: boolean; error?: string; data?: VoucherMutationData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to redeem despite expiry.' }

  const parsed = overrideRedeemSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const numberCheck = requireFullNumber(parsed.data.voucherNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const employee = await lookupActiveEmployee(parsed.data.employeeId)
  if ('error' in employee) return { error: employee.error }

  const rpc = await callVoucherRpc('voucher_override_redeem', {
    p_voucher_number: numberCheck.number,
    p_reason: parsed.data.reason,
    p_manager_user_id: ctx.userId,
    p_employee_id: parsed.data.employeeId,
    p_employee_name: employee.name,
    p_transaction_ref: parsed.data.transactionRef?.trim() ? parsed.data.transactionRef.trim() : null,
    p_booking_ref: parsed.data.bookingRef?.trim() ? parsed.data.bookingRef.trim() : null,
    p_london_today: getTodayIsoDate(),
    p_source: 'management',
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if ('error' in rpc) return { error: rpc.error }
  if (!rpc.result.success || !rpc.result.voucher) return { error: rpcErrorMessage(rpc.result) }

  const voucher = mapVoucherRow(rpc.result.voucher)
  if (!rpc.result.idempotent_replay) {
    await auditVoucherMutation(ctx, 'override_redeem', voucher.id, {
      voucher_number: voucher.voucherNumber,
      reason: parsed.data.reason,
      employee_id: parsed.data.employeeId,
    })
  }
  revalidateVoucherPaths(voucher.voucherNumber)
  return { success: true, data: { voucher, idempotentReplay: rpc.result.idempotent_replay } }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listVoucherTypes(): Promise<{ success?: boolean; error?: string; data?: VoucherType[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view vouchers.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('voucher_types')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) return { error: 'Could not load voucher types.' }
  return { success: true, data: ((data ?? []) as VoucherTypeRow[]).map(mapVoucherTypeRow) }
}

export async function getTermsVersions(): Promise<{ success?: boolean; error?: string; data?: TermsVersion[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view voucher terms.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('terms_versions')
    .select('*')
    .order('effective_from', { ascending: false })
  if (error) return { error: 'Could not load terms versions.' }
  return { success: true, data: ((data ?? []) as TermsVersionRow[]).map(mapTermsVersionRow) }
}

interface SummaryVoucherRow {
  status: VoucherStatus
  type_id: string
  value_pence: number | null
  issued_at: string | null
  expiry_date: string | null
  redeemed_at: string | null
  batch_id: string
}

export async function getVoucherSummary(): Promise<{ success?: boolean; error?: string; data?: VoucherSummary }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view vouchers.' }

  const admin = createAdminClient()

  const [typesResult, batchesResult] = await Promise.all([
    admin.from('voucher_types').select('*').order('sort_order', { ascending: true }),
    admin.from('voucher_batches').select('*').order('created_at', { ascending: false }),
  ])
  if (typesResult.error) return { error: 'Could not load voucher types.' }
  if (batchesResult.error) return { error: 'Could not load voucher batches.' }

  const types = ((typesResult.data ?? []) as VoucherTypeRow[]).map(mapVoucherTypeRow)
  const batches = ((batchesResult.data ?? []) as VoucherBatchRow[]).map(mapVoucherBatchRow)
  const readyBatchIds = new Set(batches.filter((b) => b.pdfStatus === 'ready').map((b) => b.id))

  const vouchers: SummaryVoucherRow[] = []
  const pageSize = 1000
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from('vouchers')
      .select('status, type_id, value_pence, issued_at, expiry_date, redeemed_at, batch_id')
      .range(from, from + pageSize - 1)
    if (error) return { error: 'Could not load vouchers.' }
    const chunk = (data ?? []) as SummaryVoucherRow[]
    vouchers.push(...chunk)
    if (chunk.length < pageSize) break
  }

  const todayIso = getTodayIsoDate()
  const monthStartIso = `${todayIso.slice(0, 7)}-01`
  const expiryHorizon = addDaysIso(todayIso, 14)

  const stockByType = new Map<string, VoucherStockRow>()
  for (const type of types) {
    stockByType.set(type.id, {
      typeId: type.id,
      displayTitle: type.displayTitle,
      valuePence: type.valuePence,
      inStock: 0,
      issued: 0,
      redeemed: 0,
      expired: 0,
      cancelled: 0,
      lowStock: false,
    })
  }

  const bucketCounts: Record<VoucherAgeBucket, number> = {
    '0-30': 0,
    '31-90': 0,
    '91-180': 0,
    '181+': 0,
  }
  let redeemedThisMonth = 0
  let outstandingValuePence = 0
  let expiringSoon = 0

  for (const row of vouchers) {
    const stock = stockByType.get(row.type_id)
    if (stock) {
      if (row.status === 'generated' && readyBatchIds.has(row.batch_id)) stock.inStock += 1
      if (row.status === 'issued') stock.issued += 1
      if (row.status === 'redeemed') stock.redeemed += 1
      if (row.status === 'expired') stock.expired += 1
      if (row.status === 'cancelled') stock.cancelled += 1
    }

    if (row.status === 'issued') {
      outstandingValuePence += row.value_pence ?? 0
      if (row.issued_at) {
        bucketCounts[ageBucket(completedLondonDaysSince(row.issued_at))] += 1
      }
      if (row.expiry_date && row.expiry_date >= todayIso && row.expiry_date <= expiryHorizon) {
        expiringSoon += 1
      }
    }

    if (row.status === 'redeemed' && row.redeemed_at) {
      const redeemedLondon = toLocalIsoDate(new Date(row.redeemed_at))
      if (redeemedLondon >= monthStartIso && redeemedLondon <= todayIso) redeemedThisMonth += 1
    }
  }

  const stock = Array.from(stockByType.values()).map((row) => ({
    ...row,
    lowStock: row.inStock <= LOW_STOCK_THRESHOLD,
  }))
  const totals = stock.reduce(
    (acc, row) => ({
      inStock: acc.inStock + row.inStock,
      issued: acc.issued + row.issued,
      redeemed: acc.redeemed + row.redeemed,
      expired: acc.expired + row.expired,
      cancelled: acc.cancelled + row.cancelled,
    }),
    { inStock: 0, issued: 0, redeemed: 0, expired: 0, cancelled: 0 }
  )

  const notPrintable: VoucherNotPrintableBatch[] = batches
    .filter((batch) => batch.pdfStatus !== 'ready')
    .map((batch) => ({
      batchId: batch.id,
      createdAt: batch.createdAt,
      createdByName: batch.createdByName,
      note: batch.note,
      totalCount: batch.totalCount,
      pdfStatus: batch.pdfStatus,
      renderError: batch.renderError,
    }))

  return {
    success: true,
    data: {
      stock,
      totals,
      tiles: {
        totalInStock: totals.inStock,
        totalOutstanding: totals.issued,
        redeemedThisMonth,
        outstandingValuePence,
      },
      ageBuckets: (Object.keys(bucketCounts) as VoucherAgeBucket[]).map((bucket) => ({
        bucket,
        count: bucketCounts[bucket],
      })),
      expiringSoon,
      todayIso,
      monthStartIso,
      notPrintable,
    },
  }
}

interface LedgerJoinRow extends VoucherRow {
  type: { display_title: string } | null
  customer: { id: string; first_name: string | null; last_name: string | null } | null
  event: { id: string; name: string | null } | null
  batch: { pdf_status: BatchPdfStatus } | null
}

export async function getVoucherLedger(
  filters: VoucherLedgerFilters
): Promise<{ success?: boolean; error?: string; data?: VoucherLedgerResult }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view vouchers.' }

  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50))

  const admin = createAdminClient()
  const batchEmbed = filters.batchReady
    ? 'batch:voucher_batches!inner(pdf_status)'
    : 'batch:voucher_batches(pdf_status)'
  let query = admin
    .from('vouchers')
    .select(
      `*, type:voucher_types(display_title), customer:customers(id, first_name, last_name), event:events(id, name), ${batchEmbed}`,
      { count: 'exact' }
    )

  if (filters.status && filters.status.length > 0) query = query.in('status', filters.status)
  if (filters.typeIds && filters.typeIds.length > 0) query = query.in('type_id', filters.typeIds)
  if (filters.batchId) query = query.eq('batch_id', filters.batchId)
  if (filters.eventId) query = query.eq('event_id', filters.eventId)
  if (filters.customerId) query = query.eq('customer_id', filters.customerId)
  if (filters.batchReady) query = query.eq('batch.pdf_status', 'ready')

  if (filters.generatedFrom) query = query.gte('created_at', londonDayStartIso(filters.generatedFrom))
  if (filters.generatedTo) query = query.lt('created_at', londonDayStartIso(nextIsoDate(filters.generatedTo)))
  if (filters.issuedFrom) query = query.gte('issued_at', londonDayStartIso(filters.issuedFrom))
  if (filters.issuedTo) query = query.lt('issued_at', londonDayStartIso(nextIsoDate(filters.issuedTo)))
  if (filters.redeemedFrom) query = query.gte('redeemed_at', londonDayStartIso(filters.redeemedFrom))
  if (filters.redeemedTo) query = query.lt('redeemed_at', londonDayStartIso(nextIsoDate(filters.redeemedTo)))

  if (filters.expiringWithinDays !== undefined && filters.expiringWithinDays !== null) {
    const todayIso = getTodayIsoDate()
    query = query
      .gte('expiry_date', todayIso)
      .lte('expiry_date', addDaysIso(todayIso, filters.expiringWithinDays))
  }

  if (filters.q && filters.q.trim()) {
    const normalised = normaliseVoucherNumberInput(filters.q)
    if (isFullVoucherNumber(normalised)) {
      query = query.eq('voucher_number', normalised)
    } else if (normalised.length >= 2) {
      const safe = normalised.replace(/[%_,()]/g, '')
      if (safe) query = query.ilike('voucher_number', `%${safe}%`)
    }
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('voucher_number', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (error) {
    console.error('Voucher ledger query failed', error)
    return { error: 'Could not load the voucher ledger.' }
  }

  const rows: VoucherLedgerRow[] = ((data ?? []) as unknown as LedgerJoinRow[]).map((row) => {
    const voucher = mapVoucherRow(row)
    const { ageDays, ageLabel } = voucherAge(voucher)
    const customerName = row.customer
      ? [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ').trim() || null
      : null
    return {
      voucher,
      typeTitle: row.type?.display_title ?? row.type_id,
      customerName,
      eventName: row.event?.name ?? null,
      batchReady: row.batch?.pdf_status === 'ready',
      ageDays,
      ageLabel,
    }
  })

  return { success: true, data: { rows, total: count ?? rows.length, page, pageSize } }
}

interface DetailJoinRow extends VoucherRow {
  type: VoucherTypeRow | null
  batch: {
    id: string
    pdf_status: BatchPdfStatus
    created_at: string
    type_definitions: Record<string, unknown> | null
  } | null
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    mobile_e164: string | null
  } | null
  event: { id: string; name: string | null } | null
}

export async function getVoucherDetail(
  rawNumber: string
): Promise<{ success?: boolean; error?: string; data?: VoucherDetail }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view vouchers.' }

  const numberCheck = requireFullNumber(rawNumber)
  if ('error' in numberCheck) return { error: numberCheck.error }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('vouchers')
    .select(
      '*, type:voucher_types(*), batch:voucher_batches(id, pdf_status, created_at, type_definitions), customer:customers(id, first_name, last_name, mobile_number, mobile_e164), event:events(id, name)'
    )
    .eq('voucher_number', numberCheck.number)
    .maybeSingle()

  if (error) {
    console.error('Voucher detail query failed', error)
    return { error: 'Could not load the voucher.' }
  }
  if (!data) return { error: 'No voucher with that number was found.' }

  const row = data as unknown as DetailJoinRow
  const voucher = mapVoucherRow(row)

  const [eventsResult, remindersResult] = await Promise.all([
    admin.from('voucher_events').select('*').eq('voucher_id', voucher.id).order('at', { ascending: true }),
    admin
      .from('voucher_reminders')
      .select('*')
      .eq('voucher_id', voucher.id)
      .order('scheduled_for', { ascending: true }),
  ])
  if (eventsResult.error) return { error: 'Could not load the voucher timeline.' }
  if (remindersResult.error) return { error: 'Could not load the reminder history.' }

  const linkedIds = [voucher.replacedById, voucher.replacesId].filter(Boolean) as string[]
  let replacedByNumber: string | null = null
  let replacesNumber: string | null = null
  if (linkedIds.length > 0) {
    const { data: linked } = await admin
      .from('vouchers')
      .select('id, voucher_number')
      .in('id', linkedIds)
    for (const linkedRow of (linked ?? []) as { id: string; voucher_number: string }[]) {
      if (linkedRow.id === voucher.replacedById) replacedByNumber = linkedRow.voucher_number
      if (linkedRow.id === voucher.replacesId) replacesNumber = linkedRow.voucher_number
    }
  }

  const snapshot = row.batch?.type_definitions as
    | Record<string, { entitlement_html?: string }>
    | null
    | undefined
  const entitlementHtml =
    snapshot?.[voucher.typeId]?.entitlement_html ?? row.type?.entitlement_html ?? null

  const customerName = row.customer
    ? [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ').trim()
    : null
  const { ageDays, ageLabel } = voucherAge(voucher)

  // Same rule as the FOH lookup and voucher_override_redeem: past the London
  // expiry date an issued voucher is expired, sweep or no sweep.
  const effectiveStatus: VoucherStatus =
    voucher.status === 'issued' && voucher.expiryDate && voucher.expiryDate < getTodayIsoDate()
      ? 'expired'
      : voucher.status

  return {
    success: true,
    data: {
      voucher,
      effectiveStatus,
      type: row.type ? mapVoucherTypeRow(row.type) : null,
      entitlementHtml,
      batchPdfStatus: row.batch?.pdf_status ?? null,
      batchCreatedAt: row.batch?.created_at ?? null,
      events: ((eventsResult.data ?? []) as VoucherEventRow[]).map(mapVoucherEventRow),
      reminders: ((remindersResult.data ?? []) as VoucherReminderRow[]).map(mapVoucherReminderRow),
      customer: row.customer
        ? {
            id: row.customer.id,
            name: customerName || 'Unnamed customer',
            mobile: row.customer.mobile_number ?? row.customer.mobile_e164,
          }
        : null,
      eventName: row.event?.name ?? null,
      replacedByNumber,
      replacesNumber,
      ageDays,
      ageLabel,
    },
  }
}

export async function listVoucherBatches(): Promise<{ success?: boolean; error?: string; data?: VoucherBatch[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view voucher batches.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('voucher_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return { error: 'Could not load voucher batches.' }
  return { success: true, data: ((data ?? []) as VoucherBatchRow[]).map(mapVoucherBatchRow) }
}

export async function getVoucherBatchProgress(
  batchId: string
): Promise<{ success?: boolean; error?: string; data?: VoucherBatchProgress }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view voucher batches.' }

  const parsedId = z.string().uuid().safeParse(batchId)
  if (!parsedId.success) return { error: 'Invalid batch reference.' }

  const admin = createAdminClient()
  const [batchResult, vouchersResult, typesResult] = await Promise.all([
    admin.from('voucher_batches').select('*').eq('id', parsedId.data).maybeSingle(),
    admin
      .from('vouchers')
      .select('voucher_number, type_id, status')
      .eq('batch_id', parsedId.data)
      .order('voucher_number', { ascending: true }),
    admin.from('voucher_types').select('id, display_title').order('sort_order', { ascending: true }),
  ])
  if (batchResult.error || !batchResult.data) return { error: 'Batch not found.' }
  if (vouchersResult.error) return { error: 'Could not load the vouchers in this batch.' }

  const batch = mapVoucherBatchRow(batchResult.data as VoucherBatchRow)
  const voucherRows = (vouchersResult.data ?? []) as {
    voucher_number: string
    type_id: string
    status: VoucherStatus
  }[]
  const typeTitles = new Map(
    ((typesResult.data ?? []) as { id: string; display_title: string }[]).map((t) => [
      t.id,
      t.display_title,
    ])
  )

  const countsMap = new Map<string, number>()
  let deadCount = 0
  for (const row of voucherRows) {
    countsMap.set(row.type_id, (countsMap.get(row.type_id) ?? 0) + 1)
    if (row.status !== 'generated') deadCount += 1
  }

  return {
    success: true,
    data: {
      batch,
      countsByType: Array.from(countsMap.entries()).map(([typeId, countValue]) => ({
        typeId,
        displayTitle: typeTitles.get(typeId) ?? typeId,
        count: countValue,
      })),
      firstNumber: voucherRows[0]?.voucher_number ?? null,
      lastNumber: voucherRows[voucherRows.length - 1]?.voucher_number ?? null,
      deadCount,
    },
  }
}

export async function getHandoutContext(): Promise<{ success?: boolean; error?: string; data?: HandoutContextData }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to hand out vouchers.' }

  const admin = createAdminClient()
  const todayIso = getTodayIsoDate()
  const dates =
    londonHourNow() < EVENT_DAY_CUTOVER_HOUR ? [previousIsoDate(todayIso), todayIso] : [todayIso]

  const [eventsResult, sessionsResult, employeesResult] = await Promise.all([
    admin
      .from('events')
      .select('id, name, date, time, event_status')
      .in('date', dates)
      .neq('event_status', 'cancelled')
      .order('date', { ascending: true })
      .order('time', { ascending: true }),
    admin.from('timeclock_sessions').select('employee_id').is('clock_out_at', null),
    admin
      .from('employees')
      .select('employee_id, first_name, last_name')
      .eq('status', 'Active')
      .order('first_name', { ascending: true }),
  ])
  if (eventsResult.error) return { error: 'Could not load today\'s events.' }
  if (employeesResult.error) return { error: 'Could not load the staff list.' }

  const clockedIn = new Set(
    ((sessionsResult.data ?? []) as { employee_id: string }[]).map((row) => row.employee_id)
  )

  const staff: HandoutStaffOption[] = (
    (employeesResult.data ?? []) as { employee_id: string; first_name: string | null; last_name: string | null }[]
  ).map((row) => ({
    employeeId: row.employee_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
    clockedIn: clockedIn.has(row.employee_id),
  }))
  staff.sort((a, b) => {
    if (a.clockedIn !== b.clockedIn) return a.clockedIn ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const events: HandoutEventOption[] = (
    (eventsResult.data ?? []) as { id: string; name: string; date: string; time: string | null }[]
  ).map((row) => ({ id: row.id, name: row.name, date: row.date, time: row.time }))

  return { success: true, data: { events, staff, todayIso } }
}

export async function getEventBookers(
  eventId: string
): Promise<{ success?: boolean; error?: string; data?: EventBookerChip[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view event bookings.' }

  const parsedId = z.string().uuid().safeParse(eventId)
  if (!parsedId.success) return { error: 'Invalid event reference.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select('customer_id, seats, status, customer:customers(id, first_name, last_name)')
    .eq('event_id', parsedId.data)
    .gt('seats', 0)
    .in('status', ACTIVE_BOOKING_STATUSES)
  if (error) {
    console.error('Event bookers query failed', error)
    return { error: 'Could not load bookings for that event.' }
  }

  const byCustomer = new Map<string, EventBookerChip>()
  for (const row of (data ?? []) as unknown as {
    customer_id: string | null
    seats: number | null
    customer: { id: string; first_name: string | null; last_name: string | null } | null
  }[]) {
    if (!row.customer_id || !row.customer) continue
    const existing = byCustomer.get(row.customer_id)
    const seats = row.seats ?? 0
    if (existing) {
      existing.seats += seats
    } else {
      byCustomer.set(row.customer_id, {
        customerId: row.customer_id,
        name:
          [row.customer.first_name, row.customer.last_name].filter(Boolean).join(' ').trim() ||
          'Unnamed customer',
        seats,
      })
    }
  }

  return {
    success: true,
    data: Array.from(byCustomer.values()).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// Quick-add for a winner who is not on file yet (spec 5.1). Shares its
// behaviour and consent rules with the FOH endpoint via the common module, so a
// customer added at the bar and one added in Hand-out mode are treated the same.
const QuickAddCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(120),
  mobile: z.string().trim().min(7, 'Enter a valid mobile number').max(32),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(255).optional().or(z.literal('')),
})

export async function quickAddCustomerForVoucher(input: {
  name: string
  mobile: string
  email?: string
}): Promise<{ success?: boolean; error?: string; data?: { id: string; name: string; existing: boolean } }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to add a customer.' }

  const parsed = QuickAddCustomerSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Invalid customer details' }

  try {
    const result = await quickAddVoucherCustomer(createAdminClient(), {
      name: parsed.data.name,
      mobile: parsed.data.mobile,
      email: parsed.data.email || null,
    })
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof QuickAddCustomerError) return { error: error.message }
    return { error: 'Failed to add the customer' }
  }
}

export async function searchCustomersForVoucher(
  rawQuery: string
): Promise<{ success?: boolean; error?: string; data?: VoucherCustomerHit[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to search customers.' }

  const q = rawQuery.trim()
  if (q.length < 2) return { success: true, data: [] }

  const admin = createAdminClient()
  const digits = q.replace(/\D/g, '')
  const hits = new Map<string, VoucherCustomerHit>()

  const pushRows = (
    rows: { id: string; first_name: string | null; last_name: string | null; mobile_number: string | null; mobile_e164: string | null }[]
  ) => {
    for (const row of rows) {
      if (hits.has(row.id)) continue
      hits.set(row.id, {
        id: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Unnamed customer',
        mobile: row.mobile_number ?? row.mobile_e164,
      })
    }
  }

  if (digits.length >= 4) {
    const variants = generatePhoneVariants(q, { defaultCountryCode: '44' })
    if (variants.length > 0) {
      const { data } = await admin
        .from('customers')
        .select('id, first_name, last_name, mobile_number, mobile_e164')
        .or(`mobile_e164.in.(${variants.map((v) => `"${v}"`).join(',')}),mobile_number.in.(${variants.map((v) => `"${v}"`).join(',')})`)
        .limit(LOOKUP_MAX_RESULTS)
      pushRows((data ?? []) as VoucherCustomerJoinRow[])
    }
    if (hits.size < LOOKUP_MAX_RESULTS) {
      const { data } = await admin
        .from('customers')
        .select('id, first_name, last_name, mobile_number, mobile_e164')
        .ilike('mobile_number', `%${digits}%`)
        .limit(LOOKUP_MAX_RESULTS)
      pushRows((data ?? []) as VoucherCustomerJoinRow[])
    }
  } else {
    const safe = q.replace(/[%_,()]/g, ' ').trim()
    if (safe) {
      const { data, error } = await admin
        .from('customers')
        .select('id, first_name, last_name, mobile_number, mobile_e164')
        .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
        .order('first_name', { ascending: true })
        .limit(LOOKUP_MAX_RESULTS)
      if (error) {
        console.error('Customer name search failed', error)
        return { error: 'Could not search customers.' }
      }
      pushRows((data ?? []) as VoucherCustomerJoinRow[])
    }
  }

  return { success: true, data: Array.from(hits.values()).slice(0, LOOKUP_MAX_RESULTS) }
}

interface VoucherCustomerJoinRow {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
}

export async function listReplacementCandidates(
  typeId: string
): Promise<{ success?: boolean; error?: string; data?: ReplacementCandidate[] }> {
  const ctx = await requireVouchersManage()
  if (!ctx) return { error: 'You do not have permission to view voucher stock.' }

  if (!typeId) return { error: 'Voucher type is required.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('vouchers')
    .select('id, voucher_number, created_at, batch:voucher_batches!inner(pdf_status)')
    .eq('type_id', typeId)
    .eq('status', 'generated')
    .eq('batch.pdf_status', 'ready')
    .order('voucher_number', { ascending: true })
    .limit(100)
  if (error) {
    console.error('Replacement candidates query failed', error)
    return { error: 'Could not load available stock cards.' }
  }

  return {
    success: true,
    data: ((data ?? []) as unknown as { id: string; voucher_number: string; created_at: string }[]).map(
      (row) => ({ id: row.id, voucherNumber: row.voucher_number, createdAt: row.created_at })
    ),
  }
}
