import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { expireStripeCheckoutSession, isStripeConfigured } from '@/lib/payments/stripe'
import { logAuditEvent } from '@/app/actions/audit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^\d{2}:\d{2}$/

const UpdateBookingSchema = z.object({
  booking_date: z.string().regex(DATE_REGEX, 'Enter a valid booking date'),
  booking_time: z.string().regex(TIME_REGEX, 'Enter a valid booking time'),
  duration_minutes: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(30).max(360)
  ),
  customer_id: z.string().uuid().nullable().optional(),
  special_requirements: z.string().max(2000).nullable().optional(),
  dietary_requirements: z.array(z.string().min(1).max(100)).max(30).optional(),
  allergies: z.array(z.string().min(1).max(100)).max(30).optional(),
  celebration_type: z.string().max(100).nullable().optional(),
  internal_notes: z.string().max(4000).nullable().optional(),
})

function computeBookingWindow(bookingDate: string, bookingTime: string, durationMinutes: number) {
  const start = fromZonedTime(`${bookingDate}T${bookingTime}:00`, 'Europe/London')
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}

function isAssignmentConflict(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return code === '23P01' || message.includes('table_assignment_overlap') || message.includes('table_assignment_private_blocked')
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) {
    return auth.response
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

  const parsed = UpdateBookingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid booking details',
        issues: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const { data: existing, error: loadError } = await auth.supabase.from('table_bookings')
    .select('id, status, booking_date, booking_time, duration_minutes, customer_id, special_requirements, dietary_requirements, allergies, celebration_type, internal_notes')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }
  if (['cancelled', 'completed', 'no_show'].includes(existing.status)) {
    return NextResponse.json(
      { error: `Booking cannot be edited because it is ${existing.status.replace('_', ' ')}` },
      { status: 409 }
    )
  }

  const window = computeBookingWindow(
    parsed.data.booking_date,
    parsed.data.booking_time,
    parsed.data.duration_minutes
  )
  if (!window) {
    return NextResponse.json({ error: 'Invalid booking window' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const updatePayload = {
    booking_date: parsed.data.booking_date,
    booking_time: parsed.data.booking_time,
    duration_minutes: parsed.data.duration_minutes,
    start_datetime: window.startIso,
    end_datetime: window.endIso,
    customer_id: parsed.data.customer_id ?? null,
    special_requirements: parsed.data.special_requirements ?? null,
    dietary_requirements: parsed.data.dietary_requirements ?? [],
    allergies: parsed.data.allergies ?? [],
    celebration_type: parsed.data.celebration_type ?? null,
    internal_notes: parsed.data.internal_notes ?? null,
    updated_at: nowIso,
  }

  const { error: assignmentError } = await auth.supabase.from('booking_table_assignments')
    .update({
      start_datetime: window.startIso,
      end_datetime: window.endIso,
    })
    .eq('table_booking_id', id)

  if (assignmentError) {
    if (isAssignmentConflict(assignmentError)) {
      return NextResponse.json(
        { error: 'The current table is not available at the new date or time.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Failed to update table assignment window' }, { status: 500 })
  }

  const { data: updated, error: updateError } = await auth.supabase.from('table_bookings')
    .update(updatePayload)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    old_values: existing,
    new_values: updatePayload,
    additional_info: { action: 'admin_booking_edit' },
  }).catch(() => {})

  revalidatePath('/table-bookings')
  revalidatePath(`/table-bookings/${id}`)

  return NextResponse.json({ success: true, data: { id } })
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('manage')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const { data: existing, error: loadError } = await auth.supabase.from('table_bookings')
    .select('id, customer_id, booking_reference, booking_date, status, payment_status, cancelled_at, cancellation_reason')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()

  if (existing.status === 'cancelled') {
    const { data: deletedBooking, error: deleteError } = await auth.supabase.from('table_bookings')
      .delete()
      .eq('id', id)
      .select('id, booking_reference, status, cancelled_at, cancellation_reason')
      .maybeSingle()

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to delete booking' }, { status: 500 })
    }

    if (!deletedBooking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        id,
        booking_reference: deletedBooking.booking_reference || existing.booking_reference || null,
        status: deletedBooking.status || existing.status,
        deleted_at: nowIso,
        cancelled_at: deletedBooking.cancelled_at || existing.cancelled_at || nowIso,
        cancellation_reason: deletedBooking.cancellation_reason || existing.cancellation_reason || 'boh_soft_delete',
        hard_deleted: true,
        soft_deleted: false
      }
    })
  }

  const closedStatuses = ['completed', 'no_show']
  if (closedStatuses.includes(existing.status)) {
    return NextResponse.json(
      { error: `Booking cannot be deleted because it is already ${existing.status.replace('_', ' ')}` },
      { status: 409 }
    )
  }

  // Expire any pending Stripe checkout session to prevent the guest completing
  // payment after cancellation (orphaned charge risk).
  const isPendingPayment =
    existing.status === 'pending_payment' || existing.payment_status === 'pending'
  if (isPendingPayment && isStripeConfigured()) {
    try {
      const { data: pendingPayment } = await auth.supabase.from('payments')
        .select('stripe_checkout_session_id')
        .eq('table_booking_id', id)
        .eq('charge_type', 'table_deposit')
        .eq('status', 'pending')
        .not('stripe_checkout_session_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const sessionId = (pendingPayment as any)?.stripe_checkout_session_id
      if (sessionId) {
        await expireStripeCheckoutSession(sessionId)
      }
    } catch (stripeErr) {
      // Log but do not block the cancellation
      console.error('[boh-table-booking-delete] Failed to expire Stripe checkout session:', stripeErr)
    }
  }

  const cancellationReason = 'boh_soft_delete'
  const { data: cancelledBooking, error: cancelError } = await auth.supabase.from('table_bookings')
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancelled_by: 'staff',
      cancellation_reason: cancellationReason,
      paypal_deposit_order_id: null,
      hold_expires_at: null,
      updated_at: nowIso
    })
    .eq('id', id)
    .select('id, booking_reference, status, cancelled_at, cancellation_reason')
    .maybeSingle()

  if (cancelError) {
    return NextResponse.json({ error: 'Failed to delete booking' }, { status: 500 })
  }

  if (!cancelledBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Tiered deposit refund + cancellation SMS (never fail the delete)
  try {
    const bookingDate = new Date(`${existing.booking_date}T12:00:00`)
    const refundResult = await refundTableBookingDeposit(existing.id, bookingDate)
    await sendTableBookingCancelledSmsIfAllowed(auth.supabase, {
      customerId: existing.customer_id,
      bookingReference: existing.booking_reference || id,
      bookingDate: existing.booking_date,
      refundResult,
      tableBookingId: existing.id,
    })
  } catch (err) {
    console.error('[table-booking-delete] refund/SMS error:', err)
  }

  return NextResponse.json({
    success: true,
    data: {
      id,
      booking_reference: cancelledBooking.booking_reference || existing.booking_reference || null,
      status: cancelledBooking.status || existing.status || null,
      deleted_at: nowIso,
      cancelled_at: cancelledBooking.cancelled_at || nowIso,
      cancellation_reason: cancelledBooking.cancellation_reason || cancellationReason,
      soft_deleted: true
    }
  })
}
