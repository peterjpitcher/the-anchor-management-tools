import { TableBooking, TableBookingItem } from '@/types/table-bookings';

// PayPal configuration
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!;

// Get PayPal access token
async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  
  if (!response.ok) {
    throw new Error('Failed to get PayPal access token');
  }
  
  const data = await response.json();
  return data.access_token;
}

// Create PayPal order
export async function createPayPalOrder(
  booking: TableBooking & { table_booking_items?: TableBookingItem[] },
  returnUrl: string,
  cancelUrl: string
) {
  const accessToken = await getAccessToken();
  
  // Calculate total from booking items
  const items = booking.table_booking_items || [];
  const totalAmount = items.reduce(
    (sum, item) => sum + (item.price_at_booking * item.quantity), 
    0
  );
  
  // Build line items
  const lineItems = items.map(item => ({
    name: item.custom_item_name || 'Menu Item',
    quantity: item.quantity.toString(),
    unit_amount: {
      currency_code: 'GBP',
      value: item.price_at_booking.toFixed(2),
    },
  }));
  
  const order = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: booking.booking_reference,
      custom_id: booking.id,
      description: `Sunday Lunch Booking - ${booking.booking_reference}`,
      amount: {
        currency_code: 'GBP',
        value: totalAmount.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: 'GBP',
            value: totalAmount.toFixed(2),
          },
        },
      },
      items: lineItems,
    }],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: 'The Anchor Pub',
          locale: 'en-GB',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'PayPal-Request-Id': `booking-${booking.id}`,
    },
    body: JSON.stringify(order),
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal order creation error:', error);
    throw new Error('Failed to create PayPal order');
  }
  
  const data = await response.json();
  return {
    orderId: data.id,
    approveUrl: data.links.find((link: any) => link.rel === 'payer-action')?.href,
  };
}

// Capture PayPal payment
export async function capturePayPalPayment(orderId: string) {
  const accessToken = await getAccessToken();
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal capture error:', error);
    throw new Error('Failed to capture PayPal payment');
  }
  
  const data = await response.json();
  return {
    transactionId: data.purchase_units[0].payments.captures[0].id,
    status: data.status,
    payerId: data.payer.payer_id,
    amount: data.purchase_units[0].payments.captures[0].amount.value,
  };
}

// Process refund
export async function refundPayPalPayment(
  captureId: string,
  amount: number,
  reason?: string
) {
  const accessToken = await getAccessToken();
  
  const refundData: any = {
    amount: {
      value: amount.toFixed(2),
      currency_code: 'GBP',
    },
  };
  
  if (reason) {
    refundData.note_to_payer = reason;
  }
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(refundData),
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal refund error:', error);
    throw new Error('Failed to process PayPal refund');
  }
  
  const data = await response.json();
  return {
    refundId: data.id,
    status: data.status,
    amount: data.amount.value,
  };
}

// Verify webhook signature
export async function verifyPayPalWebhook(
  headers: Record<string, string>,
  body: string,
  webhookId: string
): Promise<boolean> {
  const accessToken = await getAccessToken();
  
  const verificationData = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  };
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(verificationData),
  });
  
  if (!response.ok) {
    console.error('PayPal webhook verification failed');
    return false;
  }
  
  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}

// Get order details
export async function getPayPalOrder(orderId: string) {
  const accessToken = await getAccessToken();
  
  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to get PayPal order details');
  }
  
  return response.json();
}