import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'
import { sendStaffOneOffEmail } from '@/lib/email/staff-one-off-email'
import { isCustomerEmailUsable, isStaffEmailOptionOn } from '@/lib/messaging/staff-email-option'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SendBookingEmailSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
})

/** Per-booking cooldown, as for the text: at most three staff messages an hour. */
const MAX_EMAILS_PER_HOUR = 3

function normalizeCustomer(customer: unknown): {
  id: string | null
  email: string | null
  email_status: string | null
  email_deactivated_at: string | null
} | null {
  const source = Array.isArray(customer) ? customer[0] : customer
  if (!source || typeof source !== 'object') return null
  const record = source as Record<string, unknown>
  return {
    id: typeof record.id === 'string' ? record.id : null,
    email: typeof record.email === 'string' ? record.email : null,
    email_status: typeof record.email_status === 'string' ? record.email_status : null,
    email_deactivated_at: typeof record.email_deactivated_at === 'string' ? record.email_deactivated_at : null,
  }
}

/**
 * The email sibling of the single-guest "Send SMS" card (P7, flag staff_message_email_option).
 * Same permission as the text route: table_bookings edit.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  if (!(await isStaffEmailOptionOn())) {
    return NextResponse.json({ error: 'Emailing guests from here is switched off' }, { status: 409 })
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendBookingEmailSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid email payload' }, { status: 400 })
  }

  // email_messages is service-role only; the route has already checked the caller may edit bookings.
  const admin = createAdminClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentEmailCount, error: countError } = await (admin.from('email_messages') as any)
    .select('id', { count: 'exact', head: true })
    .eq('table_booking_id', id)
    .eq('comm_type', 'boh_manual_booking_email')
    .gte('created_at', oneHourAgo)

  if (!countError && (recentEmailCount ?? 0) >= MAX_EMAILS_PER_HOUR) {
    return NextResponse.json(
      { error: 'Too many emails sent for this booking recently. Please wait before sending another.' },
      { status: 429 }
    )
  }

  const { data: booking, error: bookingError } = await admin
    .from('table_bookings')
    .select('id, booking_reference, customer:customers!table_bookings_customer_id_fkey(id, email, email_status, email_deactivated_at)')
    .eq('id', id)
    .maybeSingle()

  if (bookingError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const customer = normalizeCustomer((booking as { customer?: unknown }).customer)
  if (!customer?.id || !customer.email || !(await isCustomerEmailUsable(customer))) {
    return NextResponse.json({ error: 'This guest has no usable email address' }, { status: 409 })
  }

  const result = await sendStaffOneOffEmail({
    to: customer.email,
    subject: parsed.data.subject,
    body: parsed.data.message,
    customerId: customer.id,
    commType: 'boh_manual_booking_email',
    tableBookingId: booking.id,
    withBookingSignature: true,
    metadata: { booking_reference: booking.booking_reference ?? null, source: 'boh_manual_booking_email' },
  })

  await AuditService.logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.manual_email_sent',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: result.success ? 'success' : 'failure',
    error_message: result.success ? undefined : result.error,
    additional_info: { customer_id: customer.id, subject_length: parsed.data.subject.length, message_length: parsed.data.message.length },
  })

  if (!result.success) {
    logger.warn('BOH table booking email failed', {
      metadata: { tableBookingId: booking.id, customerId: customer.id, error: result.error },
    })
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({
    success: true,
    data: { booking_id: booking.id, customer_id: customer.id, channel: 'email', message_id: result.messageId },
  })
}
