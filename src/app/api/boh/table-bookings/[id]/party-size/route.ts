import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import { createAdminClient } from '@/lib/supabase/admin'
import { createGuestToken } from '@/lib/guest/tokens'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEPOSIT_THRESHOLD = 7
const DEPOSIT_PER_PERSON_GBP = 10

const UpdatePartySizeSchema = z.object({
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  send_sms: z.boolean().optional().default(true)
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
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

  const parsed = UpdatePartySizeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid party size',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const newPartySize = parsed.data.party_size
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/+$/, '')

  // Read current booking state before the update so we can detect threshold crossings
  const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
    .select('id, party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const previousPartySize = Math.max(1, Number(currentBooking.party_size || 1))
  const currentStatus: string = currentBooking.status || ''
  const currentPaymentStatus: string | null = currentBooking.payment_status || null

  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: newPartySize,
      actor: 'boh',
      sendSms: parsed.data.send_sms,
      appBaseUrl
    })

    if (result.state === 'blocked') {
      return NextResponse.json(
        {
          error: mapSeatUpdateBlockedReason(result.reason),
          reason: result.reason || null
        },
        { status: 409 }
      )
    }

    // ── Threshold crossing detection ──────────────────────────────────────────

    const wasDepositRequired = previousPartySize >= DEPOSIT_THRESHOLD
    const isNowDepositRequired = newPartySize >= DEPOSIT_THRESHOLD
    const depositAlreadyHandled = ['completed', 'refunded'].includes(currentPaymentStatus ?? '')

    // Case 1: Party increased past the deposit threshold — request deposit
    if (!wasDepositRequired && isNowDepositRequired && !depositAlreadyHandled) {
      const depositAmount = newPartySize * DEPOSIT_PER_PERSON_GBP
      const depositLabel = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
      const isSundayLunch = currentBooking.booking_type === 'sunday_lunch'

      // 1. Move booking to pending_payment
      await auth.supabase.from('table_bookings')
        .update({ status: 'pending_payment', payment_status: 'pending' })
        .eq('id', id)

      // 2. Generate deposit payment link (admin client to bypass RLS for guest token creation)
      let depositUrl: string | null = null
      try {
        if (currentBooking.customer_id) {
          const holdExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
          const admin = createAdminClient()
          const { rawToken } = await createGuestToken(admin, {
            customerId: currentBooking.customer_id,
            actionType: 'payment',
            tableBookingId: id,
            expiresAt: holdExpiry.toISOString(),
          })
          depositUrl = `${appBaseUrl}/g/${rawToken}/table-payment`
        }
      } catch (tokenError) {
        logger.error('Failed to generate deposit payment token after party-size threshold crossing', {
          error: tokenError instanceof Error ? tokenError : new Error(String(tokenError)),
          metadata: { tableBookingId: id },
        })
      }

      // 3. Send SMS to customer with the deposit link
      let smsSent = false
      if (parsed.data.send_sms && currentBooking.customer_id && depositUrl) {
        try {
          const { data: customer } = await auth.supabase
            .from('customers')
            .select('id, first_name, mobile_number, sms_status')
            .eq('id', currentBooking.customer_id)
            .maybeSingle()

          if (customer && customer.sms_status === 'active' && customer.mobile_number) {
            const firstName = getSmartFirstName(customer.first_name)
            const seatWord = newPartySize === 1 ? 'person' : 'people'
            const depositKindLabel = isSundayLunch ? 'Sunday lunch deposit' : 'table deposit'
            const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
            const smsBody = `The Anchor: Hi ${firstName}, your party size has been updated to ${newPartySize} ${seatWord}. A ${depositKindLabel} of ${depositLabel} (${newPartySize} x £${DEPOSIT_PER_PERSON_GBP}) is now required to secure your booking. Pay now: ${depositUrl}`
            await sendSMS(
              customer.mobile_number,
              ensureReplyInstruction(smsBody, supportPhone),
              {
                customerId: currentBooking.customer_id,
                metadata: {
                  table_booking_id: id,
                  template_key: 'table_booking_pending_payment',
                  trigger: 'party_size_threshold_crossed',
                }
              }
            )
            smsSent = true
          }
        } catch (smsError) {
          logger.warn('Failed to send deposit SMS after party-size threshold crossing', {
            metadata: {
              tableBookingId: id,
              customerId: currentBooking.customer_id,
              error: smsError instanceof Error ? smsError.message : String(smsError),
            },
          })
        }
      }

      return NextResponse.json({
        success: true,
        data: result,
        depositRequired: true,
        depositUrl,
        depositAmount,
        smsSent,
      })
    }

    // Case 2: Party size decreased below threshold while booking is pending_payment — confirm it
    if (wasDepositRequired && !isNowDepositRequired && currentStatus === 'pending_payment') {
      await auth.supabase.from('table_bookings')
        .update({ status: 'confirmed', payment_status: null })
        .eq('id', id)
    }

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error('BOH table-booking party-size update failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: id },
    })
    return NextResponse.json(
      {
        error: 'Failed to update booking party size'
      },
      { status: 500 }
    )
  }
}
