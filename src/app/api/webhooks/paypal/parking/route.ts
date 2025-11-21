import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headers = Object.fromEntries(request.headers)
    const webhookId = process.env.PAYPAL_WEBHOOK_ID

    if (!webhookId) {
      console.error('PAYPAL_WEBHOOK_ID not configured')
      return NextResponse.json({ received: true }, { status: 200 })
    }

    const isValid = await verifyPayPalWebhook(headers, body, webhookId)
    if (!isValid) {
      console.error('Invalid PayPal webhook signature (parking)')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(body)
    const supabase = createAdminClient()

    await supabase.from('webhook_logs').insert({
      provider: 'paypal',
      event_type: event.event_type,
      webhook_id: event.id,
      payload: event,
      headers
    })

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCompleted(supabase, event)
        break
      case 'PAYMENT.CAPTURE.DENIED':
        await handlePaymentDenied(supabase, event)
        break
      case 'PAYMENT.CAPTURE.REFUNDED':
        await handleRefundCompleted(supabase, event)
        break
      default:
        console.log(`Unhandled PayPal parking event type: ${event.event_type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('PayPal parking webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function handlePaymentCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id
  const captureId = resource.id
  const amount = parseFloat(resource.amount?.value ?? '0')

  if (!bookingId) {
    console.error('Parking payment completed without booking ID')
    return
  }

  const { data: booking } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) {
    console.error(`Parking booking not found for payment webhook: ${bookingId}`)
    return
  }

  await supabase
    .from('parking_booking_payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: captureId,
      metadata: {
        capture_id: captureId,
        webhook_event_id: event.id,
        amount
      }
    })
    .eq('booking_id', bookingId)
    .eq('status', 'pending')

  await supabase
    .from('parking_bookings')
    .update({
      payment_status: 'paid',
      status: 'confirmed',
      confirmed_at: new Date().toISOString()
    })
    .eq('id', bookingId)

  await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_confirmed',
      entity_type: 'parking_booking',
      entity_id: bookingId,
      metadata: {
        amount,
        event_id: event.id,
        transaction_id: captureId,
        reference: booking.reference
      }
    })
}

async function handlePaymentDenied(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id

  if (!bookingId) return

  await supabase
    .from('parking_booking_payments')
    .update({
      status: 'failed',
      metadata: {
        webhook_event_id: event.id,
        failure_reason: resource.status_details?.reason || 'DENIED'
      }
    })
    .eq('booking_id', bookingId)
    .eq('status', 'pending')

  await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_denied',
      entity_type: 'parking_booking',
      entity_id: bookingId,
      metadata: {
        event_id: event.id,
        reason: resource.status_details?.reason
      }
    })
}

async function handleRefundCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const captureLink = resource.links?.find((link: any) => link.rel === 'up')?.href
  const captureId = captureLink ? captureLink.split('/').pop() : null
  const refundId = resource.id
  const amount = parseFloat(resource.amount?.value ?? '0')

  if (!captureId) {
    console.error('Refund event missing capture ID')
    return
  }

  const { data: payment } = await supabase
    .from('parking_booking_payments')
    .select('*')
    .eq('transaction_id', captureId)
    .maybeSingle()

  if (!payment) {
    console.error(`Parking payment not found for capture: ${captureId}`)
    return
  }

  await supabase
    .from('parking_booking_payments')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      metadata: {
        ...(payment.metadata || {}),
        refund_id: refundId,
        refund_amount: amount
      }
    })
    .eq('id', payment.id)

  await supabase
    .from('parking_bookings')
    .update({
      payment_status: 'refunded',
      status: 'cancelled'
    })
    .eq('id', payment.booking_id)

  await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_refunded',
      entity_type: 'parking_booking',
      entity_id: payment.booking_id,
      metadata: {
        refund_id: refundId,
        amount,
        event_id: event.id
      }
    })
}
