import crypto from 'crypto'

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1'

export type StripeCheckoutSession = {
  id: string
  url: string | null
  payment_intent?: string | null
  setup_intent?: string | null
  status?: string | null
  payment_status?: string | null
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, string>
}

export type StripeRefund = {
  id: string
  status: string | null
  amount: number | null
  currency: string | null
  payment_intent: string | null
}

type CreateStripeCheckoutSessionInput = {
  idempotencyKey: string
  successUrl: string
  cancelUrl: string
  bookingId: string
  eventId: string
  quantity: number
  unitAmountMinor: number
  currency: string
  productName: string
  tokenHash: string
  expiresAtUnix?: number
  metadata?: Record<string, string>
}

type CreateStripeSetupCheckoutSessionInput = {
  idempotencyKey: string
  successUrl: string
  cancelUrl: string
  tableBookingId: string
  customerId: string
  tokenHash: string
  stripeCustomerId?: string
  expiresAtUnix?: number
  metadata?: Record<string, string>
}

export type StripeSetupIntent = {
  id: string
  status: string | null
  payment_method: string | null
  customer: string | null
}

export type StripeCustomer = {
  id: string
}

export type StripePaymentIntent = {
  id: string
  status: string | null
  amount: number | null
  currency: string | null
  errorMessage?: string | null
}

function getStripeSecretKey(): string {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return stripeSecretKey
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

function sanitizeCustomerName(input?: string | null): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 80)
}

function sanitizePhone(input?: string | null): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 32)
}

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toLowerCase()
  return normalized.length > 0 ? normalized : 'gbp'
}

function sanitizeProductName(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return 'Event booking'
  return trimmed.slice(0, 120)
}

export async function createStripeCheckoutSession(
  input: CreateStripeCheckoutSessionInput
): Promise<StripeCheckoutSession> {
  const secretKey = getStripeSecretKey()

  if (!Number.isFinite(input.unitAmountMinor) || input.unitAmountMinor <= 0) {
    throw new Error('Stripe unit amount must be a positive integer')
  }

  if (!Number.isFinite(input.quantity) || input.quantity < 1) {
    throw new Error('Stripe quantity must be at least 1')
  }

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('payment_method_types[0]', 'card')
  params.set('success_url', input.successUrl)
  params.set('cancel_url', input.cancelUrl)
  params.set('client_reference_id', input.bookingId)

  params.set('line_items[0][price_data][currency]', normalizeCurrency(input.currency))
  params.set('line_items[0][price_data][unit_amount]', String(Math.trunc(input.unitAmountMinor)))
  params.set('line_items[0][price_data][product_data][name]', sanitizeProductName(input.productName))
  params.set('line_items[0][quantity]', String(Math.trunc(input.quantity)))

  const metadata = {
    event_booking_id: input.bookingId,
    event_id: input.eventId,
    token_hash: input.tokenHash,
    ...(input.metadata || {})
  }

  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value)
  }

  if (input.expiresAtUnix && Number.isFinite(input.expiresAtUnix)) {
    params.set('expires_at', String(Math.trunc(input.expiresAtUnix)))
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey
    },
    body: params.toString()
  })

  const rawText = await response.text()
  let payload: any = null

  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const details = payload?.error?.message || rawText || `Stripe API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe checkout session response missing id')
  }

  return {
    id: payload.id,
    url: typeof payload.url === 'string' ? payload.url : null,
    payment_intent: typeof payload.payment_intent === 'string' ? payload.payment_intent : null,
    setup_intent: typeof payload.setup_intent === 'string' ? payload.setup_intent : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    payment_status: typeof payload.payment_status === 'string' ? payload.payment_status : null,
    amount_total: typeof payload.amount_total === 'number' ? payload.amount_total : null,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    metadata: typeof payload.metadata === 'object' && payload.metadata !== null ? payload.metadata : undefined
  }
}

export async function createStripeSetupCheckoutSession(
  input: CreateStripeSetupCheckoutSessionInput
): Promise<StripeCheckoutSession> {
  const secretKey = getStripeSecretKey()

  const params = new URLSearchParams()
  params.set('mode', 'setup')
  params.set('payment_method_types[0]', 'card')
  params.set('success_url', input.successUrl)
  params.set('cancel_url', input.cancelUrl)
  params.set('client_reference_id', input.tableBookingId)
  if (input.stripeCustomerId && input.stripeCustomerId.trim().length > 0) {
    params.set('customer', input.stripeCustomerId.trim())
  }

  const metadata = {
    payment_kind: 'table_card_capture',
    table_booking_id: input.tableBookingId,
    customer_id: input.customerId,
    token_hash: input.tokenHash,
    ...(input.metadata || {})
  }

  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value)
  }

  if (input.expiresAtUnix && Number.isFinite(input.expiresAtUnix)) {
    params.set('expires_at', String(Math.trunc(input.expiresAtUnix)))
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey
    },
    body: params.toString()
  })

  const rawText = await response.text()
  let payload: any = null

  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const details = payload?.error?.message || rawText || `Stripe API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe setup checkout session response missing id')
  }

  return {
    id: payload.id,
    url: typeof payload.url === 'string' ? payload.url : null,
    payment_intent: typeof payload.payment_intent === 'string' ? payload.payment_intent : null,
    setup_intent: typeof payload.setup_intent === 'string' ? payload.setup_intent : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    payment_status: typeof payload.payment_status === 'string' ? payload.payment_status : null,
    amount_total: typeof payload.amount_total === 'number' ? payload.amount_total : null,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    metadata: typeof payload.metadata === 'object' && payload.metadata !== null ? payload.metadata : undefined
  }
}

export async function retrieveStripeSetupIntent(setupIntentId: string): Promise<StripeSetupIntent> {
  const secretKey = getStripeSecretKey()
  const normalizedId = setupIntentId.trim()
  if (!normalizedId) {
    throw new Error('Setup intent id is required')
  }

  const response = await fetch(
    `${STRIPE_API_BASE_URL}/setup_intents/${encodeURIComponent(normalizedId)}?expand[]=payment_method`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    }
  )

  const rawText = await response.text()
  let payload: any = null
  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const details = payload?.error?.message || rawText || `Stripe setup intent API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe setup intent response missing id')
  }

  const paymentMethod =
    typeof payload.payment_method === 'string'
      ? payload.payment_method
      : typeof payload.payment_method?.id === 'string'
        ? payload.payment_method.id
        : null

  return {
    id: payload.id,
    status: typeof payload.status === 'string' ? payload.status : null,
    payment_method: paymentMethod,
    customer:
      typeof payload.customer === 'string'
        ? payload.customer
        : typeof payload.customer?.id === 'string'
          ? payload.customer.id
          : null
  }
}

export async function createStripeOffSessionCharge(input: {
  idempotencyKey: string
  amountMinor: number
  currency: string
  customerId: string
  paymentMethodId: string
  metadata?: Record<string, string>
}): Promise<StripePaymentIntent> {
  const secretKey = getStripeSecretKey()
  const amountMinor = Math.trunc(input.amountMinor)
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new Error('Stripe charge amount must be a positive integer')
  }

  const customerId = input.customerId.trim()
  const paymentMethodId = input.paymentMethodId.trim()
  if (!customerId || !paymentMethodId) {
    throw new Error('Stripe charge requires customer and payment method')
  }

  const params = new URLSearchParams()
  params.set('amount', String(amountMinor))
  params.set('currency', normalizeCurrency(input.currency))
  params.set('customer', customerId)
  params.set('payment_method', paymentMethodId)
  params.set('off_session', 'true')
  params.set('confirm', 'true')
  params.set('confirmation_method', 'automatic')

  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      params.set(`metadata[${key}]`, value)
    }
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey
    },
    body: params.toString()
  })

  const rawText = await response.text()
  let payload: any = null

  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const paymentIntent = payload?.error?.payment_intent
    if (paymentIntent?.id && typeof paymentIntent.id === 'string') {
      return {
        id: paymentIntent.id,
        status: typeof paymentIntent.status === 'string' ? paymentIntent.status : null,
        amount: typeof paymentIntent.amount === 'number' ? paymentIntent.amount : null,
        currency: typeof paymentIntent.currency === 'string' ? paymentIntent.currency : null,
        errorMessage: payload?.error?.message || null
      }
    }

    const details = payload?.error?.message || rawText || `Stripe payment intent API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe payment intent response missing id')
  }

  return {
    id: payload.id,
    status: typeof payload.status === 'string' ? payload.status : null,
    amount: typeof payload.amount === 'number' ? payload.amount : null,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    errorMessage: null
  }
}

export async function createStripeCustomer(input: {
  idempotencyKey: string
  name?: string | null
  phone?: string | null
  metadata?: Record<string, string>
}): Promise<StripeCustomer> {
  const secretKey = getStripeSecretKey()
  const params = new URLSearchParams()
  const safeName = sanitizeCustomerName(input.name)
  const safePhone = sanitizePhone(input.phone)

  if (safeName) {
    params.set('name', safeName)
  }
  if (safePhone) {
    params.set('phone', safePhone)
  }
  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      params.set(`metadata[${key}]`, value)
    }
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey
    },
    body: params.toString()
  })

  const rawText = await response.text()
  let payload: any = null
  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const details = payload?.error?.message || rawText || `Stripe customer API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe customer response missing id')
  }

  return { id: payload.id }
}

type StripeSignatureValue = {
  timestamp: number
  signatures: string[]
}

function parseStripeSignatureHeader(headerValue: string): StripeSignatureValue | null {
  const components = headerValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  let timestamp: number | null = null
  const signatures: string[] = []

  for (const component of components) {
    const [key, value] = component.split('=', 2)
    if (!key || !value) {
      continue
    }

    if (key === 't') {
      const parsedTimestamp = Number.parseInt(value, 10)
      if (Number.isFinite(parsedTimestamp)) {
        timestamp = parsedTimestamp
      }
      continue
    }

    if (key === 'v1') {
      signatures.push(value)
    }
  }

  if (!timestamp || signatures.length === 0) {
    return null
  }

  return { timestamp, signatures }
}

function secureHexEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  } catch {
    return false
  }
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader || !webhookSecret) {
    return false
  }

  const parsed = parseStripeSignatureHeader(signatureHeader)
  if (!parsed) {
    return false
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - parsed.timestamp
  if (Math.abs(ageSeconds) > toleranceSeconds) {
    return false
  }

  const signedPayload = `${parsed.timestamp}.${payload}`
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  return parsed.signatures.some((candidate) => secureHexEquals(candidate, expectedSignature))
}

type CreateStripeRefundInput = {
  paymentIntentId: string
  amountMinor?: number
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  metadata?: Record<string, string>
  idempotencyKey?: string
}

export async function createStripeRefund(input: CreateStripeRefundInput): Promise<StripeRefund> {
  const secretKey = getStripeSecretKey()
  if (!input.paymentIntentId || input.paymentIntentId.trim().length === 0) {
    throw new Error('Stripe refund requires payment intent id')
  }

  const params = new URLSearchParams()
  params.set('payment_intent', input.paymentIntentId.trim())

  if (typeof input.amountMinor === 'number') {
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('Stripe refund amount must be a positive integer')
    }
    params.set('amount', String(Math.trunc(input.amountMinor)))
  }

  if (input.reason) {
    params.set('reason', input.reason)
  }

  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      params.set(`metadata[${key}]`, value)
    }
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {})
    },
    body: params.toString()
  })

  const rawText = await response.text()
  let payload: any = null
  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const details = payload?.error?.message || rawText || `Stripe refund API error (${response.status})`
    throw new Error(details)
  }

  if (!payload?.id || typeof payload.id !== 'string') {
    throw new Error('Stripe refund response missing id')
  }

  return {
    id: payload.id,
    status: typeof payload.status === 'string' ? payload.status : null,
    amount: typeof payload.amount === 'number' ? payload.amount : null,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    payment_intent: typeof payload.payment_intent === 'string' ? payload.payment_intent : null
  }
}
