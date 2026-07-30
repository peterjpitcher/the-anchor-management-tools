import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import {
  rpcResultResponse,
  validationError,
  serverError,
  getActiveEmployee,
  requireFullVoucherNumber
} from '../shared'

const RedeemSchema = z.object({
  number: z.string().trim().min(4).max(20),
  employeeId: z.string().uuid(),
  transactionRef: z.string().trim().max(60).optional(),
  bookingRef: z.string().trim().max(60).optional(),
  customerId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(64)
})

export async function POST(request: NextRequest) {
  const auth = await requireFohVoucherPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RedeemSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message || 'Invalid redeem details')
  }

  const payload = parsed.data

  const voucherNumber = requireFullVoucherNumber(payload.number)
  if (!voucherNumber) {
    return validationError('Enter the full voucher number (AN-YYMM-NNNN)')
  }

  const employee = await getActiveEmployee(auth.supabase, payload.employeeId)
  if (!employee) {
    return validationError('Select a current staff member')
  }

  // Friendly pre-check for booking-linked types; the RPC enforces the same rule
  // atomically, this just produces a clearer message before the confirm step.
  const { data: voucherRow, error: voucherError } = await auth.supabase
    .from('vouchers')
    .select('type_id, voucher_type:voucher_types!vouchers_type_id_fkey(requires_booking)')
    .eq('voucher_number', voucherNumber)
    .maybeSingle()

  if (voucherError) {
    return serverError('Failed to check the voucher. Please try again.')
  }

  const requiresBooking = Boolean(
    (voucherRow as { voucher_type: { requires_booking: boolean } | null } | null)?.voucher_type
      ?.requires_booking
  )
  if (requiresBooking && !payload.bookingRef?.trim()) {
    return validationError('This voucher needs a booking reference before it can be marked as used')
  }

  const { data, error } = await auth.supabase.rpc('voucher_redeem', {
    p_voucher_number: voucherNumber,
    p_employee_id: employee.id,
    p_employee_name: employee.name,
    p_user_id: auth.userId,
    p_transaction_ref: payload.transactionRef?.trim() || null,
    p_booking_ref: payload.bookingRef?.trim() || null,
    p_customer_id: payload.customerId ?? null,
    p_london_today: getLondonDateIso(),
    p_source: 'foh',
    p_idempotency_key: payload.idempotencyKey
  })

  if (error) {
    return serverError('Failed to mark the voucher as used. Please try again.')
  }

  return rpcResultResponse(data)
}
