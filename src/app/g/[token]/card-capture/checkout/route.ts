import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashGuestToken } from '@/lib/guest/tokens'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import {
  createStripeCustomer,
  createStripeSetupCheckoutSession,
  isStripeConfigured
} from '@/lib/payments/stripe'
import { getTableCardCapturePreviewByRawToken } from '@/lib/table-bookings/bookings'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_card_capture_checkout',
    maxAttempts: 8
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=rate_limited`, request.url), 303)
  }

  if (!isStripeConfigured()) {
    return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=stripe_unavailable`, request.url), 303)
  }

  const supabase = createAdminClient()

  let preview
  try {
    preview = await getTableCardCapturePreviewByRawToken(supabase, token)
  } catch {
    return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=invalid`, request.url), 303)
  }

  if (preview.state !== 'ready' || !preview.table_booking_id || !preview.customer_id) {
    return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=unavailable`, request.url), 303)
  }

  const tokenHash = hashGuestToken(token)
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const successUrl = `${appBaseUrl}/g/${token}/card-capture?status=return`
  const cancelUrl = `${appBaseUrl}/g/${token}/card-capture?status=cancelled`

  const expiresAtUnix = preview.hold_expires_at
    ? Math.floor(Date.parse(preview.hold_expires_at) / 1000)
    : undefined

  try {
    const { data: customerRecord, error: customerLookupError } = await (supabase.from('customers') as any)
      .select('id, first_name, last_name, mobile_number, mobile_e164, stripe_customer_id')
      .eq('id', preview.customer_id)
      .maybeSingle()

    if (customerLookupError) {
      logger.warn('Failed to load customer for card-capture checkout', {
        metadata: {
          customerId: preview.customer_id,
          tableBookingId: preview.table_booking_id,
          error: customerLookupError.message
        }
      })
      return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=error`, request.url), 303)
    }

    let stripeCustomerId: string | undefined =
      typeof customerRecord?.stripe_customer_id === 'string'
        ? customerRecord.stripe_customer_id
        : undefined

    if (!stripeCustomerId) {
      const fullName = `${customerRecord?.first_name || ''} ${customerRecord?.last_name || ''}`.trim()
      const createdCustomer = await createStripeCustomer({
        idempotencyKey: `table_card_capture_customer_${preview.customer_id}`,
        name: fullName || null,
        phone: customerRecord?.mobile_e164 || customerRecord?.mobile_number || null,
        metadata: {
          customer_id: preview.customer_id
        }
      })

      stripeCustomerId = createdCustomer.id

      const { error: customerUpdateError } = await supabase
        .from('customers')
        .update({
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString()
        })
        .eq('id', preview.customer_id)
        .is('stripe_customer_id', null)

      if (customerUpdateError) {
        logger.warn('Failed to persist stripe_customer_id after card-capture checkout customer create', {
          metadata: {
            customerId: preview.customer_id,
            tableBookingId: preview.table_booking_id,
            stripeCustomerId,
            error: customerUpdateError.message
          }
        })
      }
    }

    const session = await createStripeSetupCheckoutSession({
      idempotencyKey: `table_card_capture_checkout_${preview.table_booking_id}_${tokenHash}`,
      successUrl,
      cancelUrl,
      tableBookingId: preview.table_booking_id,
      customerId: preview.customer_id,
      stripeCustomerId,
      tokenHash,
      expiresAtUnix: Number.isFinite(expiresAtUnix) ? expiresAtUnix : undefined,
      metadata: {
        booking_reference: preview.booking_reference || ''
      }
    })

    if (!session.url) {
      return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=error`, request.url), 303)
    }

    return NextResponse.redirect(session.url, 303)
  } catch (error) {
    logger.error('Failed to create card-capture checkout session', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        customerId: preview.customer_id,
        tableBookingId: preview.table_booking_id
      }
    })
    return NextResponse.redirect(new URL(`/g/${token}/card-capture?status=error`, request.url), 303)
  }
}
