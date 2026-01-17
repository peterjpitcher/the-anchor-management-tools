import { retry, RetryConfigs } from './retry';

type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type PayPalLink = { rel: string; href: string };

let cachedToken: { token: string; expiresAt: number } | null = null;

function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = process.env.PAYPAL_ENVIRONMENT === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured. Please check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.');
  }

  return { baseUrl, clientId, clientSecret };
}

function extractApproveUrl(links?: PayPalLink[]) {
  if (!links) return undefined;
  const candidate = links.find((link) => link.rel === 'payer-action') || links.find((link) => link.rel === 'approve');
  return candidate?.href;
}

function cacheAccessToken(token: string, expiresInSeconds?: number) {
  const safeExpires = typeof expiresInSeconds === 'number' && expiresInSeconds > 0
    ? Date.now() + expiresInSeconds * 1000
    : Date.now() + 5 * 60 * 1000; // fallback 5 minutes
  cachedToken = { token, expiresAt: safeExpires - 60_000 }; // refresh one minute early
}

async function getAccessToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getPayPalConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await retry(
    async () => fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('PayPal access token error:', errorText);
    throw new Error(`Failed to get PayPal access token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cacheAccessToken(data.access_token, data.expires_in);
  return data.access_token;
}

type CheckoutOrderOptions = {
  customId: string;
  reference: string;
  description: string;
  amount: number;
  currency?: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  requestId?: string;
};

function buildCheckoutPayload(options: CheckoutOrderOptions) {
  const {
    customId,
    reference,
    description,
    amount,
    currency = 'GBP',
    returnUrl,
    cancelUrl,
    brandName = 'The Anchor Pub',
  } = options;

  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: reference,
        custom_id: customId,
        description,
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: brandName,
          locale: 'en-GB',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
}

async function createCheckoutOrder(options: CheckoutOrderOptions) {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();
  const payload = buildCheckoutPayload(options);
  const requestId = options.requestId || `order-${options.customId}`;

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'PayPal-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Failed to create PayPal order';

    try {
      const errorJson = JSON.parse(errorText);
      console.error('PayPal order creation error:', errorJson);

      if (errorJson.details && errorJson.details.length > 0) {
        errorMessage = errorJson.details[0].description || errorJson.message || errorMessage;
      } else if (errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      console.error('PayPal order creation error (raw):', errorText);
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const approveUrl = extractApproveUrl(data.links);

  if (!approveUrl) {
    throw new Error('PayPal did not return an approval URL');
  }

  return {
    orderId: data.id,
    approveUrl,
  };
}

export interface PayPalOrderOptions {
  customId: string;
  reference: string;
  description: string;
  amount: number;
  returnUrl: string;
  cancelUrl: string;
  currency?: string;
  brandName?: string;
  requestId?: string;
}

export async function createSimplePayPalOrder(options: PayPalOrderOptions) {
  return createCheckoutOrder({
    ...options,
    requestId: options.requestId || `parking-${options.customId}`,
  });
}

// Capture PayPal payment
export async function capturePayPalPayment(orderId: string) {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    RetryConfigs.api
  );

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
  const { baseUrl } = getPayPalConfig();

  const refundData: any = {
    amount: {
      value: amount.toFixed(2),
      currency_code: 'GBP',
    },
  };

  if (reason) {
    refundData.note_to_payer = reason;
  }

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(refundData),
    }),
    RetryConfigs.api
  );

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
  const { baseUrl } = getPayPalConfig();

  const verificationData = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  };

  const response = await retry(
    async () => fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(verificationData),
    }),
    RetryConfigs.api
  );

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
  const { baseUrl } = getPayPalConfig();

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    throw new Error('Failed to get PayPal order details');
  }

  return response.json();
}
