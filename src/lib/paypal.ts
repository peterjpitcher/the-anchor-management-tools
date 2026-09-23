import { retry, RetryConfigs } from './retry';

type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type PayPalLink = { rel: string; href: string };

export const PAYPAL_DEFAULT_CURRENCY = 'GBP';

let cachedToken: { token: string; expiresAt: number } | null = null;

type PayPalErrorBody = {
  name?: string;
  message?: string;
  details?: Array<{ issue?: string; description?: string }>;
  [key: string]: unknown;
};

export class PayPalApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly details: unknown;

  constructor(action: string, response: Response, details: unknown) {
    const body = details as PayPalErrorBody;
    const remoteMessage = typeof body?.message === 'string'
      ? body.message
      : typeof details === 'string' && details.trim()
        ? details.trim()
        : response.statusText;

    super(`Failed to ${action}: ${response.status} ${remoteMessage}`);
    this.name = 'PayPalApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.details = details;
  }
}

async function readPayPalErrorBody(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function getPayPalErrorIssues(details: unknown): string[] {
  const body = details as PayPalErrorBody | null;
  if (!body || !Array.isArray(body.details)) {
    return [];
  }

  return body.details
    .map((detail) => detail.issue)
    .filter((issue): issue is string => typeof issue === 'string')
    .map((issue) => issue.toUpperCase());
}

export function isPayPalOrderNotFoundError(error: unknown): error is PayPalApiError {
  if (!(error instanceof PayPalApiError)) {
    return false;
  }

  if (error.status === 404) {
    return true;
  }

  const body = error.details as PayPalErrorBody | null;
  const errorName = typeof body?.name === 'string' ? body.name.toUpperCase() : '';
  const issues = getPayPalErrorIssues(error.details);

  return errorName === 'RESOURCE_NOT_FOUND' ||
    issues.includes('INVALID_RESOURCE_ID') ||
    issues.includes('ORDER_NOT_FOUND');
}

/**
 * Detect a capture failure that means the PayPal order was already captured —
 * e.g. a duplicate browser onApprove submit, or a capture racing another
 * capture/confirmation for the same order. PayPal returns HTTP 422 with an
 * ORDER_ALREADY_CAPTURED issue in that case. Callers should recover by
 * re-reading their own payment record instead of surfacing a 500 to a customer
 * whose payment has in fact gone through.
 */
export function isPayPalOrderAlreadyCapturedError(error: unknown): error is PayPalApiError {
  if (!(error instanceof PayPalApiError)) {
    return false;
  }

  return getPayPalErrorIssues(error.details).includes('ORDER_ALREADY_CAPTURED');
}

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

function normalizePayPalCurrencyCode(currency?: string | null): string {
  const normalized = (currency || PAYPAL_DEFAULT_CURRENCY).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid PayPal currency code: ${currency || ''}`);
  }
  return normalized;
}

function cacheAccessToken(token: string, expiresInSeconds?: number) {
  const safeExpires = typeof expiresInSeconds === 'number' && expiresInSeconds > 0
    ? Date.now() + expiresInSeconds * 1000
    : Date.now() + 5 * 60 * 1000; // fallback 5 minutes
  cachedToken = { token, expiresAt: safeExpires - 60_000 }; // refresh one minute early
}

/**
 * `fetch` with a hard deadline. Without one a hanging PayPal dependency holds the serverless
 * function open until the platform kills it, and the webhook then produces no diagnostic at
 * all: the caller cannot tell an outage from a rejected signature.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = PAYPAL_VERIFY_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`PayPal request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getPayPalConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await retry(
    async () => fetchWithTimeout(`${baseUrl}/v1/oauth2/token`, {
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
    currency = PAYPAL_DEFAULT_CURRENCY,
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
          currency_code: normalizePayPalCurrencyCode(currency),
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

export interface InlinePayPalOrderOptions {
  customId: string;
  reference: string;
  description: string;
  amount: number;
  currency?: string;
  requestId?: string;
}

/**
 * Creates a PayPal order for use with inline/popup PayPal buttons.
 * Unlike createSimplePayPalOrder, this does NOT set payment_source with redirect URLs —
 * those cause the popup to immediately close by triggering the redirect flow.
 */
export async function createInlinePayPalOrder(options: InlinePayPalOrderOptions) {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: options.reference,
        custom_id: options.customId,
        description: options.description,
        amount: {
          currency_code: normalizePayPalCurrencyCode(options.currency),
          value: options.amount.toFixed(2),
        },
      },
    ],
  };

  const requestId = options.requestId || `inline-${options.customId}`;

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
  return { orderId: data.id as string };
}

// Capture PayPal payment
export async function capturePayPalPayment(orderId: string, expectedCurrency?: string) {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();
  const normalizedExpectedCurrency = expectedCurrency
    ? normalizePayPalCurrencyCode(expectedCurrency)
    : null;

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
    const error = await readPayPalErrorBody(response);
    console.error('PayPal capture error:', error);
    throw new PayPalApiError('capture PayPal payment', response, error);
  }

  const data = await response.json();
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  const captureCurrency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.trim().toUpperCase()
    : null;

  if (normalizedExpectedCurrency && captureCurrency !== normalizedExpectedCurrency) {
    throw new Error(
      `PayPal capture currency mismatch: expected ${normalizedExpectedCurrency}, got ${captureCurrency || 'missing'}`
    );
  }

  return {
    transactionId: capture.id,
    status: data.status,
    payerId: data.payer?.payer_id,
    amount: capture.amount.value,
    currency: captureCurrency,
    customId: data.purchase_units[0].custom_id || null,
  };
}

// Process refund
export async function refundPayPalPayment(
  captureId: string,
  amount: number,
  requestId: string,
  currency?: string
): Promise<{
  refundId: string;
  status: string;
  statusDetails?: string;
  amount: string;
  currency: string | null;
}> {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();
  const normalizedCurrency = normalizePayPalCurrencyCode(currency);

  const refundData = {
    amount: {
      value: amount.toFixed(2),
      currency_code: normalizedCurrency,
    },
  };

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'PayPal-Request-Id': requestId,
      },
      body: JSON.stringify(refundData),
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal refund error:', error);
    throw new Error(
      error?.details?.[0]?.description || error?.message || 'Failed to process PayPal refund'
    );
  }

  const data = await response.json();
  return {
    refundId: data.id,
    status: data.status,
    statusDetails: data.status_details?.reason,
    amount: data.amount?.value ?? amount.toFixed(2),
    currency: typeof data.amount?.currency_code === 'string'
      ? data.amount.currency_code.trim().toUpperCase()
      : normalizedCurrency,
  };
}

// Fetch the current status of a PayPal refund (used to reconcile refunds that
// PayPal accepted as PENDING and later completed/failed asynchronously).
export async function getPayPalRefund(refundId: string): Promise<{
  refundId: string;
  status: string;
  statusDetails?: string;
  amount: string | null;
  currency: string | null;
}> {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/payments/refunds/${refundId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.details?.[0]?.description || error?.message || `Failed to fetch PayPal refund ${refundId}`
    );
  }

  const data = await response.json();
  return {
    refundId: data.id ?? refundId,
    status: data.status,
    statusDetails: data.status_details?.reason,
    amount: typeof data.amount?.value === 'string' ? data.amount.value : null,
    currency: typeof data.amount?.currency_code === 'string'
      ? data.amount.currency_code.trim().toUpperCase()
      : null,
  };
}

// Verify webhook signature
//
// PayPal reuses the ORIGINAL transmission time on every retry of an event, and it retries
// for about three days. A tight window either side therefore rejects every retry before the
// signature is even checked, which is what killed the private-bookings endpoint between
// 25 June and 23 September 2026. Past age and future skew are separate bounds for that
// reason: a message four days old is a retry we still want, a message four days in the
// future is a broken clock or a forgery.
export const PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS = 4 * 24 * 60 * 60 * 1000
export const PAYPAL_WEBHOOK_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

// A hanging PayPal dependency must still be able to produce a diagnostic and a 500 inside the
// serverless function budget, so every call in the verification path is bounded.
const PAYPAL_VERIFY_TIMEOUT_MS = 8_000

export type PayPalTransmissionTimeCheck =
  | { state: 'ok'; ageSeconds: number }
  | { state: 'missing'; ageSeconds: null }
  | { state: 'unparseable'; ageSeconds: null }
  | { state: 'too_old'; ageSeconds: number }
  | { state: 'future'; ageSeconds: number }

/**
 * Classifies a `paypal-transmission-time` header. Age is positive for a message from the
 * past and negative for one dated in the future, so a diagnostic can say which.
 */
export function evaluatePayPalTransmissionTime(
  transmissionTime: string | undefined,
  nowMs = Date.now(),
  maxAgeMs = PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS,
  maxFutureSkewMs = PAYPAL_WEBHOOK_MAX_FUTURE_SKEW_MS
): PayPalTransmissionTimeCheck {
  if (!transmissionTime) {
    return { state: 'missing', ageSeconds: null }
  }

  const transmittedMs = Date.parse(transmissionTime)
  if (!Number.isFinite(transmittedMs)) {
    return { state: 'unparseable', ageSeconds: null }
  }

  const ageMs = nowMs - transmittedMs
  const ageSeconds = Math.round(ageMs / 1000)

  if (ageMs < -maxFutureSkewMs) {
    return { state: 'future', ageSeconds }
  }

  if (ageMs > maxAgeMs) {
    return { state: 'too_old', ageSeconds }
  }

  return { state: 'ok', ageSeconds }
}

/**
 * Kept for callers that only need a yes or no. Prefer
 * `evaluatePayPalTransmissionTime`, which says why.
 */
export function isPayPalTransmissionTimeFresh(
  transmissionTime: string | undefined,
  nowMs = Date.now(),
  maxAgeMs = PAYPAL_WEBHOOK_MAX_TRANSMISSION_AGE_MS
): boolean {
  return evaluatePayPalTransmissionTime(transmissionTime, nowMs, maxAgeMs).state === 'ok'
}

export type PayPalWebhookVerification =
  | { outcome: 'verified'; verificationStatus: 'SUCCESS'; transmissionAgeSeconds: number | null }
  | { outcome: 'missing_signature_headers'; missingHeaders: string[]; transmissionAgeSeconds: null }
  | {
      outcome: 'stale_transmission'
      reason: PayPalTransmissionTimeCheck['state']
      transmissionAgeSeconds: number | null
    }
  | { outcome: 'invalid_payload'; message: string; transmissionAgeSeconds: number | null }
  | {
      outcome: 'signature_rejected'
      verificationStatus: string
      transmissionAgeSeconds: number | null
    }
  | { outcome: 'verification_unavailable'; message: string; transmissionAgeSeconds: number | null }

const REQUIRED_VERIFICATION_HEADERS = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time',
] as const

/**
 * Verifies a PayPal webhook signature and says exactly what happened.
 *
 * Validation order matters: anything we can reject locally is rejected before a remote call,
 * so a malformed body or a missing header never costs a PayPal request and never comes back
 * disguised as a signature failure. Only an explicit remote `SUCCESS` authorises processing;
 * an unreachable or unexpected verify response is `verification_unavailable`, which callers
 * answer with a 500 so PayPal retries.
 */
export async function verifyPayPalWebhookDetailed(
  headers: Record<string, string>,
  body: string,
  webhookId: string,
  nowMs = Date.now()
): Promise<PayPalWebhookVerification> {
  const missingHeaders = REQUIRED_VERIFICATION_HEADERS.filter((header) => !headers[header])
  if (missingHeaders.length > 0) {
    return { outcome: 'missing_signature_headers', missingHeaders: [...missingHeaders], transmissionAgeSeconds: null }
  }

  const transmission = evaluatePayPalTransmissionTime(headers['paypal-transmission-time'], nowMs)
  if (transmission.state !== 'ok') {
    return {
      outcome: 'stale_transmission',
      reason: transmission.state,
      transmissionAgeSeconds: transmission.ageSeconds,
    }
  }

  const transmissionAgeSeconds = transmission.ageSeconds

  let webhookEvent: unknown
  try {
    webhookEvent = JSON.parse(body)
  } catch (parseError) {
    return {
      outcome: 'invalid_payload',
      message: parseError instanceof Error ? parseError.message : 'Body is not valid JSON',
      transmissionAgeSeconds,
    }
  }

  let response: Response
  try {
    const accessToken = await getAccessToken()
    const { baseUrl } = getPayPalConfig()

    const verificationData = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }

    response = await retry(
      async () => fetchWithTimeout(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(verificationData),
      }),
      RetryConfigs.api
    )
  } catch (requestError) {
    return {
      outcome: 'verification_unavailable',
      message: requestError instanceof Error ? requestError.message : String(requestError),
      transmissionAgeSeconds,
    }
  }

  if (!response.ok) {
    return {
      outcome: 'verification_unavailable',
      message: `PayPal verify-webhook-signature returned ${response.status}`,
      transmissionAgeSeconds,
    }
  }

  let data: { verification_status?: unknown }
  try {
    data = await response.json()
  } catch (parseError) {
    return {
      outcome: 'verification_unavailable',
      message: parseError instanceof Error
        ? `PayPal verify-webhook-signature returned an unreadable body: ${parseError.message}`
        : 'PayPal verify-webhook-signature returned an unreadable body',
      transmissionAgeSeconds,
    }
  }

  const status = typeof data?.verification_status === 'string' ? data.verification_status : null

  if (status === 'SUCCESS') {
    return { outcome: 'verified', verificationStatus: 'SUCCESS', transmissionAgeSeconds }
  }

  if (status === 'FAILURE') {
    return { outcome: 'signature_rejected', verificationStatus: status, transmissionAgeSeconds }
  }

  // Anything other than an explicit SUCCESS or FAILURE is PayPal behaving unexpectedly. It
  // must never authorise processing, and it must not be recorded as a rejected signature.
  return {
    outcome: 'verification_unavailable',
    message: `PayPal verify-webhook-signature returned an unexpected verification_status: ${status ?? 'absent'}`,
    transmissionAgeSeconds,
  }
}

/**
 * Boolean wrapper. The legacy `/api/webhooks/paypal` route still checks `!isValid`, and a
 * diagnostic object would be truthy there, so this shape is deliberately preserved.
 */
export async function verifyPayPalWebhook(
  headers: Record<string, string>,
  body: string,
  webhookId: string
): Promise<boolean> {
  const result = await verifyPayPalWebhookDetailed(headers, body, webhookId)
  return result.outcome === 'verified'
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
    const error = await readPayPalErrorBody(response);
    throw new PayPalApiError('get PayPal order details', response, error);
  }

  return response.json();
}

/**
 * Finds the webhook id PayPal assigned to a given endpoint URL.
 *
 * Signature verification needs the id of the webhook that received the event,
 * and each endpoint has its own. Rather than requiring a new environment
 * variable and a redeploy every time an endpoint is added, this looks the id up
 * from the account and caches it.
 *
 * It also self-heals: if a webhook is deleted and recreated in the PayPal
 * dashboard, its id changes, and a hardcoded env var would then silently reject
 * every delivery. This picks the new one up within the cache window.
 *
 * Returns null when no webhook is registered for that URL, which is the honest
 * answer: the caller must then fail closed rather than verify against some
 * other endpoint's id.
 */
const webhookIdCache = new Map<string, { id: string | null; expiresAt: number }>();
const WEBHOOK_ID_CACHE_MS = 10 * 60 * 1000;

export type PayPalWebhookRegistryLookup =
  | { state: 'matched'; webhookId: string; fromCache: boolean }
  | { state: 'no_match'; webhookId: null; fromCache: boolean }
  | { state: 'unavailable'; webhookId: string | null; fromCache: boolean; message: string };

function normaliseWebhookUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Asks PayPal which webhook is registered for a URL, and says whether it got an answer.
 *
 * The distinction matters: "PayPal says nothing is registered here" is a configuration
 * problem to fail closed on, while "PayPal did not answer" is an outage. Collapsing the two
 * into a null, as the previous helper did, made a stale cached id indistinguishable from a
 * fresh one and hid the real cause.
 */
export async function lookupPayPalWebhookRegistration(url: string): Promise<PayPalWebhookRegistryLookup> {
  const wanted = normaliseWebhookUrl(url);

  const cached = webhookIdCache.get(wanted);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id
      ? { state: 'matched', webhookId: cached.id, fromCache: true }
      : { state: 'no_match', webhookId: null, fromCache: true };
  }

  try {
    const { baseUrl } = getPayPalConfig();
    const accessToken = await getAccessToken();

    const response = await fetchWithTimeout(`${baseUrl}/v1/notifications/webhooks`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Do not cache a lookup failure: the next delivery should try again rather than being
      // locked out for the whole cache window. An expired cached id may still be offered,
      // but it is reported as coming from a stale cache, never as a fresh match.
      return {
        state: 'unavailable',
        webhookId: cached?.id ?? null,
        fromCache: Boolean(cached?.id),
        message: `PayPal webhook registry returned ${response.status}`,
      };
    }

    const data = await response.json();
    const match = (data?.webhooks ?? []).find(
      (webhook: { url?: string }) => typeof webhook?.url === 'string' && normaliseWebhookUrl(webhook.url) === wanted,
    );
    const id = typeof match?.id === 'string' ? match.id : null;

    webhookIdCache.set(wanted, { id, expiresAt: Date.now() + WEBHOOK_ID_CACHE_MS });
    return id
      ? { state: 'matched', webhookId: id, fromCache: false }
      : { state: 'no_match', webhookId: null, fromCache: false };
  } catch (error) {
    return {
      state: 'unavailable',
      webhookId: cached?.id ?? null,
      fromCache: Boolean(cached?.id),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveWebhookIdForUrl(url: string): Promise<string | null> {
  const lookup = await lookupPayPalWebhookRegistration(url);
  return lookup.webhookId;
}

export type PayPalWebhookRegistration = {
  id: string;
  url: string;
  eventTypes: string[];
};

export type PayPalWebhookRegistryListing =
  | { state: 'ok'; webhooks: PayPalWebhookRegistration[] }
  | { state: 'unavailable'; webhooks: PayPalWebhookRegistration[]; message: string };

/**
 * Lists every webhook registered to this PayPal app, for the health check.
 *
 * Read-only and uncached: the health check runs once a day and must see the real registry,
 * not whatever the verification cache happens to hold.
 */
export async function listPayPalWebhookRegistrations(): Promise<PayPalWebhookRegistryListing> {
  try {
    const { baseUrl } = getPayPalConfig();
    const accessToken = await getAccessToken();

    const response = await fetchWithTimeout(`${baseUrl}/v1/notifications/webhooks`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        state: 'unavailable',
        webhooks: [],
        message: `PayPal webhook registry returned ${response.status}`,
      };
    }

    const data = await response.json();
    const webhooks: PayPalWebhookRegistration[] = (data?.webhooks ?? [])
      .filter((webhook: { id?: unknown; url?: unknown }) =>
        typeof webhook?.id === 'string' && typeof webhook?.url === 'string')
      .map((webhook: { id: string; url: string; event_types?: Array<{ name?: unknown }> }) => ({
        id: webhook.id,
        url: webhook.url,
        eventTypes: (webhook.event_types ?? [])
          .map((eventType) => eventType?.name)
          .filter((name): name is string => typeof name === 'string'),
      }));

    return { state: 'ok', webhooks };
  } catch (error) {
    return {
      state: 'unavailable',
      webhooks: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type PayPalWebhookIdSource = 'resolved' | 'stale_cache' | 'env' | 'none';

export type PayPalWebhookIdResolution = {
  webhookId: string | null;
  source: PayPalWebhookIdSource;
  lookupState: PayPalWebhookRegistryLookup['state'];
  lookupMessage: string | null;
  url: string;
};

/**
 * The one rule every PayPal webhook route uses to find the id it verifies against.
 *
 * 1. A webhook registered for this exact URL wins outright. A configured id can never
 *    override it: a webhook recreated in the dashboard gets a new id, and a stale env var
 *    then rejects every genuine delivery, which is precisely what happened to private
 *    bookings for six months.
 * 2. If PayPal cannot be reached, the endpoint's OWN env var is used as an emergency
 *    override, and the result records that it did.
 * 3. A clean "nothing is registered for this URL" is NOT patched over with the env var. That
 *    answer is trustworthy, and honouring a stale override there would revive the same bug.
 *    The route fails closed, PayPal retries for three days, and the health cron alerts.
 * 4. It never falls back to PAYPAL_WEBHOOK_ID, which belongs to another endpoint.
 */
export async function resolvePayPalWebhookId(
  endpointUrl: string,
  envOverride?: string | null | undefined
): Promise<PayPalWebhookIdResolution> {
  const lookup = await lookupPayPalWebhookRegistration(endpointUrl);
  const configured = typeof envOverride === 'string' && envOverride.trim() ? envOverride.trim() : null;

  if (lookup.state === 'matched') {
    return {
      webhookId: lookup.webhookId,
      source: 'resolved',
      lookupState: lookup.state,
      lookupMessage: null,
      url: endpointUrl,
    };
  }

  if (lookup.state === 'unavailable') {
    if (lookup.webhookId) {
      return {
        webhookId: lookup.webhookId,
        source: 'stale_cache',
        lookupState: lookup.state,
        lookupMessage: lookup.message,
        url: endpointUrl,
      };
    }

    if (configured) {
      return {
        webhookId: configured,
        source: 'env',
        lookupState: lookup.state,
        lookupMessage: lookup.message,
        url: endpointUrl,
      };
    }

    return {
      webhookId: null,
      source: 'none',
      lookupState: lookup.state,
      lookupMessage: lookup.message,
      url: endpointUrl,
    };
  }

  return {
    webhookId: null,
    source: 'none',
    lookupState: lookup.state,
    lookupMessage: null,
    url: endpointUrl,
  };
}
