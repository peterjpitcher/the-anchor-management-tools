import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPayPalWebhook } from '@/lib/paypal';
import { checkRateLimit, getClientIp, rateLimitConfigs } from '@/lib/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    // Check rate limit for webhooks
    const clientIp = await getClientIp();
    const rateLimitResult = await checkRateLimit(clientIp, rateLimitConfigs.webhook);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { 
          status: 429,
          headers: {
            'Retry-After': Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000).toString()
          }
        }
      );
    }

    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    
    // Verify webhook signature
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      console.error('PayPal webhook ID not configured');
      return NextResponse.json({ received: true }, { status: 200 });
    }
    
    const isValid = await verifyPayPalWebhook(headers, body, webhookId);
    if (!isValid) {
      console.error('Invalid PayPal webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    const event = JSON.parse(body);
    const supabase = createAdminClient();
    
    // Log webhook
    await supabase.from('webhook_logs').insert({
      provider: 'paypal',
      event_type: event.event_type,
      webhook_id: event.id,
      payload: event,
      headers,
    });
    
    // Process based on event type
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCompleted(supabase, event);
        break;
        
      case 'PAYMENT.CAPTURE.DENIED':
        await handlePaymentDenied(supabase, event);
        break;
        
      case 'PAYMENT.CAPTURE.REFUNDED':
        await handleRefundCompleted(supabase, event);
        break;
        
      default:
        console.log(`Unhandled PayPal event type: ${event.event_type}`);
    }
    
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handlePaymentCompleted(supabase: any, event: any) {
  const resource = event.resource;
  const customId = resource.custom_id; // booking_id
  const captureId = resource.id;
  const amount = resource.amount.value;
  
  if (!customId) {
    console.error('No booking ID in PayPal payment');
    return;
  }
  
  // Get booking
  const { data: booking } = await supabase
    .from('table_bookings')
    .select('*')
    .eq('id', customId)
    .single();
    
  if (!booking) {
    console.error(`Booking not found: ${customId}`);
    return;
  }
  
  // Update payment record
  const { data: payment } = await supabase
    .from('table_booking_payments')
    .update({
      status: 'completed',
      transaction_id: captureId,
      paid_at: new Date().toISOString(),
      payment_metadata: {
        webhook_event_id: event.id,
        capture_id: captureId,
      },
    })
    .eq('booking_id', customId)
    .eq('status', 'pending')
    .select()
    .single();
    
  if (payment) {
    // Update booking status
    await supabase
      .from('table_bookings')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', customId);
      
    // Log audit event
    await supabase
      .from('audit_logs')
      .insert({
        action: 'payment_webhook_confirmed',
        entity_type: 'table_booking',
        entity_id: customId,
        metadata: {
          booking_reference: booking.booking_reference,
          transaction_id: captureId,
          amount,
          event_id: event.id,
        },
      });
  }
}

async function handlePaymentDenied(supabase: any, event: any) {
  const resource = event.resource;
  const customId = resource.custom_id;
  
  if (!customId) return;
  
  // Update payment record
  await supabase
    .from('table_booking_payments')
    .update({
      status: 'failed',
      payment_metadata: {
        webhook_event_id: event.id,
        failure_reason: resource.status_details?.reason || 'DENIED',
      },
    })
    .eq('booking_id', customId)
    .eq('status', 'pending');
    
  // Log audit event
  await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_denied',
      entity_type: 'table_booking',
      entity_id: customId,
      metadata: {
        event_id: event.id,
        reason: resource.status_details?.reason,
      },
    });
}

async function handleRefundCompleted(supabase: any, event: any) {
  const resource = event.resource;
  const captureId = resource.links?.find((link: any) => link.rel === 'up')?.href?.split('/').pop();
  const refundId = resource.id;
  const amount = resource.amount.value;
  
  if (!captureId) {
    console.error('No capture ID in refund event');
    return;
  }
  
  // Find payment by capture ID
  const { data: payment } = await supabase
    .from('table_booking_payments')
    .select('*')
    .eq('transaction_id', captureId)
    .single();
    
  if (!payment) {
    console.error(`Payment not found for capture: ${captureId}`);
    return;
  }
  
  // Update payment record
  await supabase
    .from('table_booking_payments')
    .update({
      status: parseFloat(amount) === payment.amount ? 'refunded' : 'partial_refund',
      refund_amount: amount,
      refund_transaction_id: refundId,
      refunded_at: new Date().toISOString(),
      payment_metadata: {
        ...payment.payment_metadata,
        refund_event_id: event.id,
      },
    })
    .eq('id', payment.id);
    
  // Update booking status
  await supabase
    .from('table_bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Refund processed',
    })
    .eq('id', payment.booking_id);
    
  // Log audit event
  await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_webhook_refunded',
      entity_type: 'table_booking',
      entity_id: payment.booking_id,
      metadata: {
        payment_id: payment.id,
        refund_id: refundId,
        amount,
        event_id: event.id,
      },
    });
}