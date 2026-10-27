import { NextRequest, NextResponse } from 'next/server'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { createGuestToken } from '@/lib/guest/tokens'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long a fresh link gives the guest once a manager has re-opened a lapsed hold. */
const REOPENED_HOLD_MS = 24 * 60 * 60 * 1000

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const { data: booking } = await auth.supabase.from('table_bookings')
    .select('id, customer_id, status, payment_status, hold_expires_at, start_datetime')
    .eq('id', id)
    .maybeSingle()

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (!booking.customer_id) {
    return NextResponse.json({ error: 'Booking has no customer' }, { status: 422 })
  }

  const closed = ['cancelled', 'no_show', 'completed'].includes(String(booking.status || ''))
  const awaitingPayment =
    !closed && (booking.status === 'pending_payment' || booking.payment_status === 'pending')
  if (!awaitingPayment) {
    return NextResponse.json({ error: 'Booking is not awaiting payment' }, { status: 422 })
  }

  const nowMs = Date.now()
  const holdMs = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) : Number.NaN
  const holdIsLive = Number.isFinite(holdMs) && holdMs > nowMs

  let linkExpiry: Date
  if (holdIsLive) {
    // The link lasts exactly as long as the hold the guest is paying against.
    linkExpiry = new Date(holdMs)
  } else {
    // A lapsed or missing hold. The link used to be given 24 more hours while the hold stayed
    // lapsed, so the payment page refused it and the timeout cron cancelled the booking anyway
    // (BK-045). Re-opening it moves the hold, which only a manager may do (owner decision D18).
    const canManage = await checkUserPermission('table_bookings', 'manage', auth.userId)
    if (!canManage) {
      return NextResponse.json(
        { error: 'The payment hold has run out. Ask a manager to give the guest longer to pay.' },
        { status: 403 }
      )
    }
    const startMs = booking.start_datetime ? Date.parse(booking.start_datetime) : Number.NaN
    const untilMs = Number.isFinite(startMs) ? Math.min(nowMs + REOPENED_HOLD_MS, startMs) : nowMs + REOPENED_HOLD_MS
    if (untilMs <= nowMs) {
      return NextResponse.json({ error: 'The booking has already started, so there is no time left to pay online.' }, { status: 409 })
    }
    linkExpiry = new Date(untilMs)
    const { error: holdError } = await auth.supabase.from('table_bookings')
      .update({ hold_expires_at: linkExpiry.toISOString(), updated_at: new Date(nowMs).toISOString() })
      .eq('id', id)
      .is('paypal_deposit_capture_id', null)
    if (holdError) {
      logger.error('Could not re-open a lapsed table deposit hold for a new link', {
        error: new Error(holdError.message),
        metadata: { tableBookingId: id },
      })
      return NextResponse.json({ error: 'The hold could not be re-opened. Please try again.' }, { status: 500 })
    }
    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'table_booking.deposit_hold_extended',
      resource_type: 'table_booking',
      resource_id: id,
      operation_status: 'success',
      old_values: { hold_expires_at: booking.hold_expires_at },
      new_values: { hold_expires_at: linkExpiry.toISOString() },
      additional_info: { note: 'New deposit link after the hold had run out' },
    }).catch(() => {})
  }

  // Guest token creation requires admin client to bypass RLS
  const admin = createAdminClient()
  const { rawToken } = await createGuestToken(admin, {
    customerId: booking.customer_id,
    actionType: 'payment',
    tableBookingId: id,
    expiresAt: linkExpiry.toISOString(),
  })

  const url = `${getAppUrl()}/g/${rawToken}/table-payment`

  return NextResponse.json({ url, expiresAt: linkExpiry.toISOString() })
}
