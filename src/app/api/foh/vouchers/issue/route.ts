import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  rpcResultResponse,
  validationError,
  serverError,
  getActiveEmployee,
  requireFullVoucherNumber
} from '../shared'

const IssueSchema = z
  .object({
    number: z.string().trim().min(4).max(20),
    employeeId: z.string().uuid(),
    eventId: z.string().uuid().optional(),
    wonAtLabel: z.string().trim().max(120).optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid expiry date'),
    customerId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(8).max(64)
  })
  .superRefine((value, context) => {
    if (!value.eventId && !value.wonAtLabel?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pick an event or type where the voucher was won'
      })
    }
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

  const parsed = IssueSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message || 'Invalid hand-out details')
  }

  const payload = parsed.data

  const voucherNumber = requireFullVoucherNumber(payload.number)
  if (!voucherNumber) {
    return validationError('Enter the full voucher number (AN-YYMM-NNNN)')
  }

  if (payload.expiryDate < getLondonDateIso()) {
    return validationError('The expiry date must be today or later')
  }

  const employee = await getActiveEmployee(auth.supabase, payload.employeeId)
  if (!employee) {
    return validationError('Select a current staff member')
  }

  // Derive the won-at label server-side when an event is picked (spec 3.3/4):
  // "<event name>, <London date>". Free-text labels only apply without an event.
  let wonAtLabel = payload.wonAtLabel?.trim() ?? ''
  if (payload.eventId) {
    const { data: eventRow, error: eventError } = await auth.supabase
      .from('events')
      .select('id, name, date')
      .eq('id', payload.eventId)
      .maybeSingle()

    if (eventError) {
      return serverError('Failed to load the selected event')
    }

    if (!eventRow) {
      return validationError('The selected event could not be found')
    }

    const eventDateLabel = eventRow.date
      ? formatDateInLondon(eventRow.date as string, { day: 'numeric', month: 'long', year: 'numeric' })
      : null
    wonAtLabel = eventDateLabel ? `${eventRow.name}, ${eventDateLabel}` : (eventRow.name as string)
  }

  const { data, error } = await auth.supabase.rpc('voucher_issue', {
    p_voucher_number: voucherNumber,
    p_employee_id: employee.id,
    p_employee_name: employee.name,
    p_user_id: auth.userId,
    p_event_id: payload.eventId ?? null,
    p_won_at_label: wonAtLabel,
    p_expiry_date: payload.expiryDate,
    p_customer_id: payload.customerId ?? null,
    p_source: 'foh',
    p_idempotency_key: payload.idempotencyKey
  })

  if (error) {
    return serverError('Failed to hand out the voucher. Please try again.')
  }

  return rpcResultResponse(data)
}
