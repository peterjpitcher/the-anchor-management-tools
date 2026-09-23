import { vi } from 'vitest'
import type { PayPalWebhookGateResult } from '@/lib/paypal-webhook-gate'

/**
 * Shared shapes for suites that mock the PayPal webhook gate.
 *
 * Route suites mock the gate so they can exercise their own handling. What the gate itself
 * accepts and rejects is proved against the real helper with mocked HTTP in
 * `tests/lib/paypalWebhookVerification.test.ts`: a route suite stubbing "valid" proves nothing
 * about which messages verify.
 */

const DIAGNOSTICS = {
  webhook_id: 'WEBHOOK-ID-FROM-PAYPAL',
  webhook_id_source: 'resolved' as const,
  registry_lookup: 'matched' as const,
  registry_message: null,
  verification_status: 'SUCCESS',
  transmission_age_seconds: 12,
}

export function gateVerified(body: string): PayPalWebhookGateResult {
  return {
    ok: true,
    webhookId: 'WEBHOOK-ID-FROM-PAYPAL',
    event: JSON.parse(body),
    diagnostics: { ...DIAGNOSTICS },
  }
}

export function gateSignatureRejected(): PayPalWebhookGateResult {
  return {
    ok: false,
    logStatus: 'signature_rejected',
    errorMessage: 'PayPal rejected the webhook signature',
    diagnostics: { ...DIAGNOSTICS, verification_status: 'FAILURE' },
    httpStatus: 401,
    responseBody: { error: 'Invalid signature' },
  }
}

export function gateConfigurationError(endpointName: string): PayPalWebhookGateResult {
  return {
    ok: false,
    logStatus: 'configuration_error',
    errorMessage: `No PayPal webhook is registered for the ${endpointName} endpoint`,
    diagnostics: {
      webhook_id: null,
      webhook_id_source: 'none',
      registry_lookup: 'no_match',
      registry_message: null,
      verification_status: null,
      transmission_age_seconds: null,
    },
    httpStatus: process.env.NODE_ENV === 'production' ? 500 : 200,
    responseBody: {
      received: false,
      error: `No PayPal webhook is registered for the ${endpointName} endpoint`,
    },
  }
}

/** Factory body for `vi.mock('@/lib/paypal-webhook-gate', ...)`. */
export function paypalGateModuleMock() {
  return {
    gatePayPalWebhook: vi.fn(async (input: { body: string }) => gateVerified(input.body)),
    sanitizePayPalHeadersForLog: (headers: Record<string, string>) => headers,
  }
}
