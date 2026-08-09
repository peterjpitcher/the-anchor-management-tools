// Shared helpers for the FOH voucher API family (spec section 4, F29/F32).
// Not a route file: Next.js only routes files named route.ts.

import { NextResponse } from 'next/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import { mapVoucherRow } from '@/types/vouchers'
import type { VoucherErrorCode, VoucherRow, VoucherStatus } from '@/types/vouchers'
import { UNDO_WINDOW_SECONDS } from '@/lib/vouchers/constants'
import { normaliseVoucherNumberInput, isFullVoucherNumber } from '@/lib/vouchers/numbering'
import { displayName } from '@/lib/employees/display-name'

type AdminClient = ReturnType<typeof createAdminClient>

// jsonb payload returned by every voucher lifecycle RPC (migration 20260802000002):
// {success: true, voucher} or {success: false, error_code, current_status, message?}
export interface VoucherRpcResult {
  success: boolean
  voucher?: VoucherRow
  error_code?: VoucherErrorCode
  current_status?: VoucherStatus | null
  message?: string
}

const ERROR_MESSAGES: Partial<Record<VoucherErrorCode, string>> = {
  ALREADY_REDEEMED: 'This voucher has already been used',
  EXPIRED: 'This voucher has expired - only a manager can override an expired voucher',
  NOT_ISSUED: 'This voucher has not been handed out yet',
  CANCELLED: 'This voucher has been cancelled',
  REPLACED: 'This voucher has been replaced',
  NOT_FOUND: 'No voucher found with that number',
  UNDO_WINDOW_CLOSED: `More than ${UNDO_WINDOW_SECONDS} seconds ago - ask a manager`,
  ALREADY_ISSUED: 'This voucher has already been handed out',
  NOT_REDEEMED: 'This voucher has not been marked as used',
  BATCH_NOT_READY: 'This batch is not ready to hand out yet - ask a manager',
  VALIDATION_ERROR: 'Invalid request',
  FORBIDDEN: 'You do not have permission to do that'
}

function httpStatusForErrorCode(code: VoucherErrorCode | undefined): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    default:
      return 409
  }
}

// Turns the RPC jsonb result into the FOH mutation response contract:
// success: {success: true, voucher} (200)
// failure: {success: false, errorCode, currentStatus, message} (mapped status)
export function rpcResultResponse(raw: unknown): NextResponse {
  const result = (raw ?? {}) as VoucherRpcResult

  if (result.success && result.voucher) {
    return NextResponse.json({ success: true, voucher: mapVoucherRow(result.voucher) })
  }

  if (result.success) {
    return NextResponse.json({ success: true })
  }

  const errorCode: VoucherErrorCode = result.error_code ?? 'VALIDATION_ERROR'
  const message =
    (errorCode === 'VALIDATION_ERROR' && result.message) ||
    ERROR_MESSAGES[errorCode] ||
    'This action is not allowed for this voucher'

  return NextResponse.json(
    {
      success: false,
      errorCode,
      currentStatus: result.current_status ?? null,
      message
    },
    { status: httpStatusForErrorCode(errorCode) }
  )
}

export function validationError(message: string): NextResponse {
  return NextResponse.json(
    { success: false, errorCode: 'VALIDATION_ERROR', currentStatus: null, message },
    { status: 400 }
  )
}

export function serverError(message: string): NextResponse {
  return NextResponse.json({ success: false, message }, { status: 500 })
}

// F29: the employee is referenced by UUID only; the display name is always derived
// server-side from an active employee row, never trusted from the client.
export async function getActiveEmployee(
  supabase: AdminClient,
  employeeId: string
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, preferred_name')
    .eq('employee_id', employeeId)
    .in('status', ['Active', 'Started Separation'])
    .maybeSingle()

  if (error || !data) {
    return null
  }

  // Stamped on the voucher as who handed it out or took it, and only ever read
  // by staff, so it shows the name the team uses. The empty fallback keeps the
  // old behaviour of treating a nameless row as no employee at all.
  const name = displayName(data, '')

  return name ? { id: data.employee_id as string, name } : null
}

// Normalises client input to the canonical AN-YYMM-NNNN form; returns null when the
// input is not a complete voucher number (mutations always need the full number).
export function requireFullVoucherNumber(raw: string): string | null {
  const normalised = normaliseVoucherNumberInput(raw)
  return isFullVoucherNumber(normalised) ? normalised : null
}

export function buildCustomerName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string {
  const parts = [firstName ?? '', lastName ?? ''].map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown customer'
}
