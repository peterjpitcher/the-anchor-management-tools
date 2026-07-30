import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohVoucherPermission } from '@/lib/foh/api-auth'
import {
  rpcResultResponse,
  validationError,
  serverError,
  getActiveEmployee,
  requireFullVoucherNumber
} from '../shared'

const UndoRedeemSchema = z.object({
  number: z.string().trim().min(4).max(20),
  employeeId: z.string().uuid(),
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

  const parsed = UndoRedeemSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message || 'Invalid undo details')
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

  // FOH undo is only valid inside the 60-second window (spec 2.5); after that the
  // RPC returns UNDO_WINDOW_CLOSED and the manager flow takes over.
  const { data, error } = await auth.supabase.rpc('voucher_undo_redeem', {
    p_voucher_number: voucherNumber,
    p_user_id: auth.userId,
    p_employee_id: employee.id,
    p_actor_name: employee.name,
    p_require_recent: true,
    p_reason: null,
    p_source: 'foh',
    p_idempotency_key: payload.idempotencyKey
  })

  if (error) {
    return serverError('Failed to undo. Please try again.')
  }

  return rpcResultResponse(data)
}
