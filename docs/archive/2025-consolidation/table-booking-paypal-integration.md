# PayPal Integration Guide for Table Bookings

## Overview

This guide covers the complete PayPal integration for the table booking system, focusing on security, webhook verification, and payment processing for Sunday lunch pre-payments.

## PayPal Setup

### 1. Environment Variables

```bash
# PayPal API Credentials
PAYPAL_CLIENT_ID=your_client_id_here
PAYPAL_CLIENT_SECRET=your_client_secret_here
PAYPAL_MODE=sandbox # or 'live' for production

# Webhook Configuration
PAYPAL_WEBHOOK_ID=your_webhook_id_here

# URLs
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com # or https://api-m.paypal.com for live
```

### 2. NPM Dependencies

```json
{
  "dependencies": {
    "@paypal/paypal-server-sdk": "^1.0.0",
    "node-fetch": "^3.3.2"
  }
}
```

## Implementation

### 1. PayPal Client Setup

```typescript
// /lib/paypal/client.ts
import { Client, Environment } from '@paypal/paypal-server-sdk';

export function getPayPalClient() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }
  
  return new Client({
    clientId,
    clientSecret,
    environment: process.env.PAYPAL_MODE === 'live' 
      ? Environment.Production 
      : Environment.Sandbox,
    logging: {
      logLevel: process.env.NODE_ENV === 'production' ? 'ERROR' : 'INFO',
      logRequest: process.env.NODE_ENV !== 'production',
      logResponse: process.env.NODE_ENV !== 'production',
    }
  });
}
```

### 2. OAuth Token Management

```typescript
// /lib/paypal/auth.ts
import { cache } from '@/lib/cache';

interface PayPalToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  created_at: number;
}

export async function getPayPalAccessToken(): Promise<string> {
  // Check cache first
  const cachedToken = await cache.get<PayPalToken>('paypal_access_token');
  
  if (cachedToken && isTokenValid(cachedToken)) {
    return cachedToken.access_token;
  }
  
  // Get new token
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  
  const response = await fetch(`${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  
  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${response.statusText}`);
  }
  
  const token: PayPalToken = await response.json();
  token.created_at = Date.now();
  
  // Cache for slightly less than expiry time
  await cache.set('paypal_access_token', token, token.expires_in - 300);
  
  return token.access_token;
}

function isTokenValid(token: PayPalToken): boolean {
  const expiresAt = token.created_at + (token.expires_in * 1000);
  return Date.now() < expiresAt - 300000; // 5 minute buffer
}
```

### 3. Create Payment Order

```typescript
// /lib/paypal/orders.ts
export async function createPayPalOrder(booking: {
  id: string;
  reference: string;
  totalAmount: number;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
}): Promise<{ id: string; approveUrl: string }> {
  const accessToken = await getPayPalAccessToken();
  
  const order = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: booking.reference,
      custom_id: booking.id, // Used to match webhook events
      description: `Sunday Lunch Booking - ${booking.reference}`,
      amount: {
        currency_code: 'GBP',
        value: booking.totalAmount.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: 'GBP',
            value: booking.totalAmount.toFixed(2),
          },
        },
      },
      items: booking.items.map(item => ({
        name: item.name,
        quantity: item.quantity.toString(),
        unit_amount: {
          currency_code: 'GBP',
          value: item.price.toFixed(2),
        },
      })),
    }],
    application_context: {
      brand_name: 'The Anchor Pub',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment-success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/booking/${booking.reference}?payment=cancelled`,
    },
  };
  
  const response = await fetch(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': booking.id, // Idempotency key
    },
    body: JSON.stringify(order),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`PayPal order creation failed: ${error.message || response.statusText}`);
  }
  
  const result = await response.json();
  const approveUrl = result.links.find((link: any) => link.rel === 'approve')?.href;
  
  if (!approveUrl) {
    throw new Error('No approval URL in PayPal response');
  }
  
  return {
    id: result.id,
    approveUrl,
  };
}
```

### 4. Capture Payment

```typescript
// /lib/paypal/capture.ts
export async function capturePayPalPayment(orderId: string): Promise<{
  transactionId: string;
  status: string;
  amount: number;
}> {
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`PayPal capture failed: ${error.message || response.statusText}`);
  }
  
  const result = await response.json();
  const capture = result.purchase_units[0].payments.captures[0];
  
  return {
    transactionId: capture.id,
    status: capture.status,
    amount: parseFloat(capture.amount.value),
  };
}
```

### 5. Webhook Verification

```typescript
// /lib/paypal/webhooks.ts
import crypto from 'crypto';

export async function verifyPayPalWebhook(
  headers: Record<string, string>,
  body: string
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const transmissionId = headers['paypal-transmission-id'];
  const transmissionTime = headers['paypal-transmission-time'];
  const certUrl = headers['paypal-cert-url'];
  const authAlgo = headers['paypal-auth-algo'];
  const transmissionSig = headers['paypal-transmission-sig'];
  
  if (!webhookId || !transmissionId || !transmissionTime || !certUrl || !transmissionSig) {
    return false;
  }
  
  // Fetch the certificate
  const certResponse = await fetch(certUrl);
  if (!certResponse.ok) {
    return false;
  }
  const cert = await certResponse.text();
  
  // Build the verification string
  const verificationString = [
    transmissionId,
    transmissionTime,
    webhookId,
    crypto.createHash('sha256').update(body).digest('hex')
  ].join('|');
  
  // Verify the signature
  try {
    const verify = crypto.createVerify(authAlgo);
    verify.update(verificationString);
    verify.end();
    
    return verify.verify(cert, transmissionSig, 'base64');
  } catch (error) {
    console.error('PayPal webhook verification error:', error);
    return false;
  }
}

// Alternative: Use PayPal API to verify
export async function verifyPayPalWebhookViaAPI(
  headers: Record<string, string>,
  body: any
): Promise<boolean> {
  const accessToken = await getPayPalAccessToken();
  
  const verificationRequest = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: body,
  };
  
  const response = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verificationRequest),
    }
  );
  
  if (!response.ok) {
    return false;
  }
  
  const result = await response.json();
  return result.verification_status === 'SUCCESS';
}
```

### 6. Process Refunds

```typescript
// /lib/paypal/refunds.ts
export async function refundPayPalPayment(
  captureId: string,
  amount: number,
  reason: string
): Promise<{
  refundId: string;
  status: string;
}> {
  const accessToken = await getPayPalAccessToken();
  
  const refundRequest = {
    amount: {
      value: amount.toFixed(2),
      currency_code: 'GBP',
    },
    note_to_payer: reason,
  };
  
  const response = await fetch(
    `${process.env.PAYPAL_BASE_URL}/v2/payments/captures/${captureId}/refund`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refundRequest),
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`PayPal refund failed: ${error.message || response.statusText}`);
  }
  
  const result = await response.json();
  
  return {
    refundId: result.id,
    status: result.status,
  };
}
```

### 7. Webhook Handler

```typescript
// /app/api/webhooks/paypal/table-bookings/route.ts
import { NextRequest } from 'next/server';
import { verifyPayPalWebhook } from '@/lib/paypal/webhooks';
import { createAdminClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/app/actions/audit';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);
  
  // Verify webhook signature
  const isValid = await verifyPayPalWebhook(headers, body);
  if (!isValid) {
    console.error('Invalid PayPal webhook signature');
    return new Response('Unauthorized', { status: 401 });
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
    verified: true,
  });
  
  try {
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCompleted(event, supabase);
        break;
        
      case 'PAYMENT.CAPTURE.REFUNDED':
        await handleRefundCompleted(event, supabase);
        break;
        
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.PENDING':
        await handlePaymentFailed(event, supabase);
        break;
        
      default:
        console.log(`Unhandled PayPal event type: ${event.event_type}`);
    }
    
    return Response.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook processing error:', error);
    // Return 200 to prevent PayPal retries for processing errors
    return Response.json({ received: true, error: 'Processing error' });
  }
}

async function handlePaymentCompleted(event: any, supabase: any) {
  const capture = event.resource;
  const bookingId = capture.custom_id;
  const transactionId = capture.id;
  const amount = parseFloat(capture.amount.value);
  
  // Update payment record
  const { error: paymentError } = await supabase
    .from('table_booking_payments')
    .update({
      status: 'completed',
      transaction_id: transactionId,
      paid_at: new Date().toISOString(),
      payment_metadata: {
        paypal_capture_id: capture.id,
        paypal_order_id: capture.supplementary_data?.related_ids?.order_id,
        payer_email: event.resource.payer?.email_address,
      },
    })
    .eq('booking_id', bookingId)
    .eq('status', 'pending');
    
  if (paymentError) {
    throw new Error(`Failed to update payment: ${paymentError.message}`);
  }
  
  // Update booking status
  const { error: bookingError } = await supabase
    .from('table_bookings')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('status', 'pending_payment');
    
  if (bookingError) {
    throw new Error(`Failed to confirm booking: ${bookingError.message}`);
  }
  
  // Get booking details for notifications
  const { data: booking } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customer:customers(*),
      items:table_booking_items(*)
    `)
    .eq('id', bookingId)
    .single();
    
  if (booking) {
    // Queue confirmation SMS and email
    await queueBookingConfirmation(booking, supabase);
    
    // Log audit event
    await logAuditEvent(supabase, {
      action: 'table_booking.payment_completed',
      entity_type: 'table_booking',
      entity_id: bookingId,
      metadata: {
        transaction_id: transactionId,
        amount,
        booking_reference: booking.booking_reference,
      },
    });
  }
}

async function handleRefundCompleted(event: any, supabase: any) {
  const refund = event.resource;
  const captureId = refund.links?.find((l: any) => l.rel === 'up')?.href?.split('/').pop();
  
  // Find the payment by capture ID
  const { data: payment } = await supabase
    .from('table_booking_payments')
    .select('*, booking:table_bookings(*)')
    .eq('transaction_id', captureId)
    .single();
    
  if (!payment) {
    console.error('Payment not found for refund:', captureId);
    return;
  }
  
  // Update payment record
  await supabase
    .from('table_booking_payments')
    .update({
      status: refund.amount.value === payment.amount ? 'refunded' : 'partial_refund',
      refund_amount: parseFloat(refund.amount.value),
      refund_transaction_id: refund.id,
      refunded_at: new Date().toISOString(),
    })
    .eq('id', payment.id);
    
  // Log audit event
  await logAuditEvent(supabase, {
    action: 'table_booking.refund_completed',
    entity_type: 'table_booking',
    entity_id: payment.booking_id,
    metadata: {
      refund_id: refund.id,
      refund_amount: refund.amount.value,
      booking_reference: payment.booking.booking_reference,
    },
  });
}

async function handlePaymentFailed(event: any, supabase: any) {
  const capture = event.resource;
  const bookingId = capture.custom_id;
  
  // Update payment as failed
  await supabase
    .from('table_booking_payments')
    .update({
      status: 'failed',
      payment_metadata: {
        failure_reason: capture.status_details?.reason || 'Unknown',
        paypal_debug_id: event.debug_id,
      },
    })
    .eq('booking_id', bookingId);
    
  // Log for manual review
  console.error('Payment failed for booking:', bookingId, capture.status_details);
}
```

## API Integration

### 1. Create Booking with Payment

```typescript
// /app/api/table-bookings/route.ts (excerpt)
export async function POST(request: NextRequest) {
  // ... validation and booking creation ...
  
  if (booking.booking_type === 'sunday_lunch') {
    // Calculate total from menu selections
    const totalAmount = calculateBookingTotal(booking.items);
    
    // Create payment record
    const { data: payment } = await supabase
      .from('table_booking_payments')
      .insert({
        booking_id: booking.id,
        amount: totalAmount,
        status: 'pending',
      })
      .select()
      .single();
      
    // Create PayPal order
    const paypalOrder = await createPayPalOrder({
      id: booking.id,
      reference: booking.booking_reference,
      totalAmount,
      items: booking.items.map(item => ({
        name: item.menu_item_name,
        quantity: item.quantity,
        price: item.price_at_booking,
      })),
    });
    
    // Update payment with PayPal order ID
    await supabase
      .from('table_booking_payments')
      .update({
        payment_metadata: { paypal_order_id: paypalOrder.id }
      })
      .eq('id', payment.id);
      
    return createApiResponse({
      booking_id: booking.id,
      booking_reference: booking.booking_reference,
      status: 'pending_payment',
      payment_required: true,
      payment_details: {
        amount: totalAmount,
        currency: 'GBP',
        payment_url: paypalOrder.approveUrl,
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      },
    });
  }
  
  // Regular booking - no payment needed
  return createApiResponse({
    booking_id: booking.id,
    booking_reference: booking.booking_reference,
    status: 'confirmed',
  });
}
```

### 2. Payment Success Handler

```typescript
// /app/api/table-bookings/payment-success/route.ts
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token'); // PayPal order ID
  
  if (!token) {
    return NextResponse.redirect('/booking/error?reason=missing_token');
  }
  
  try {
    // Capture the payment
    const capture = await capturePayPalPayment(token);
    
    // Find booking by PayPal order ID
    const { data: payment } = await supabase
      .from('table_booking_payments')
      .select('booking_id, booking:table_bookings(booking_reference)')
      .eq('payment_metadata->>paypal_order_id', token)
      .single();
      
    if (!payment) {
      return NextResponse.redirect('/booking/error?reason=booking_not_found');
    }
    
    // Redirect to success page
    return NextResponse.redirect(
      `/booking/${payment.booking.booking_reference}/success`
    );
  } catch (error) {
    console.error('Payment capture error:', error);
    return NextResponse.redirect('/booking/error?reason=payment_failed');
  }
}
```

## Security Best Practices

### 1. Environment Variable Validation

```typescript
// Run on startup
function validatePayPalConfig() {
  const required = [
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_WEBHOOK_ID',
    'PAYPAL_MODE',
    'PAYPAL_BASE_URL',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing PayPal configuration: ${missing.join(', ')}`);
  }
  
  // Validate mode
  if (!['sandbox', 'live'].includes(process.env.PAYPAL_MODE!)) {
    throw new Error('PAYPAL_MODE must be either "sandbox" or "live"');
  }
}
```

### 2. Webhook Security

- Always verify webhook signatures
- Use HTTPS for webhook endpoints
- Implement idempotency to handle duplicate events
- Log all webhook events for audit trail
- Return 200 OK even for processing errors to prevent retries

### 3. Payment Security

- Never store sensitive payment data
- Use PayPal's hosted checkout
- Implement proper error handling
- Set reasonable payment expiration times
- Monitor for suspicious patterns

## Testing

### 1. Sandbox Testing

```typescript
// Test accounts for sandbox
const testBuyer = {
  email: 'buyer@example.com',
  password: 'test123',
};

// Test card numbers
const testCards = {
  valid: '4111111111111111',
  declined: '4000000000000002',
  insufficient: '4000000000000341',
};
```

### 2. Webhook Testing

```bash
# Use ngrok for local testing
ngrok http 3000

# Configure webhook URL in PayPal dashboard
https://your-ngrok-url.ngrok.io/api/webhooks/paypal/table-bookings
```

### 3. Integration Tests

```typescript
// /tests/paypal-integration.test.ts
describe('PayPal Integration', () => {
  it('should create payment order', async () => {
    const order = await createPayPalOrder({
      id: 'test-booking-id',
      reference: 'TB-2024-TEST',
      totalAmount: 50.00,
      items: [
        { name: 'Sunday Roast', quantity: 2, price: 25.00 }
      ],
    });
    
    expect(order).toHaveProperty('id');
    expect(order).toHaveProperty('approveUrl');
  });
  
  it('should verify webhook signature', async () => {
    const isValid = await verifyPayPalWebhook(
      mockHeaders,
      mockBody
    );
    
    expect(isValid).toBe(true);
  });
});
```

## Error Handling

### Common PayPal Errors

```typescript
const PAYPAL_ERROR_CODES = {
  'INVALID_RESOURCE_ID': 'The specified resource ID is invalid',
  'PERMISSION_DENIED': 'You do not have permission to access this resource',
  'RESOURCE_NOT_FOUND': 'The specified resource does not exist',
  'DUPLICATE_INVOICE_ID': 'Invoice ID already exists',
  'INSTRUMENT_DECLINED': 'Payment method was declined',
  'PAYER_CANNOT_PAY': 'Payer cannot pay for this transaction',
  'TRANSACTION_REFUSED': 'Transaction was refused',
  'INTERNAL_SERVER_ERROR': 'PayPal server error - please retry',
};

export function getPayPalErrorMessage(code: string): string {
  return PAYPAL_ERROR_CODES[code] || 'An unexpected PayPal error occurred';
}
```

## Monitoring

### Key Metrics

- Payment success rate
- Average payment completion time
- Webhook delivery success
- Refund processing time
- Failed payment reasons

### Alerts

```typescript
// Set up alerts for:
if (paymentSuccessRate < 0.95) {
  sendAlert('Payment success rate below 95%');
}

if (webhookFailures > 5) {
  sendAlert('Multiple webhook failures detected');
}

if (refundProcessingTime > 300000) { // 5 minutes
  sendAlert('Refund processing delayed');
}
```