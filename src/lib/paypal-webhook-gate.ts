import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import {
  resolvePayPalWebhookId,
  verifyPayPalWebhookDetailed,
  type PayPalWebhookIdResolution,
} from '@/lib/paypal'

/**
 * Everything the five PayPal webhook routes do before they look at the event: find the id to
 * verify against, verify, and decide what a failure is called and what HTTP code it earns.
 *
 * It lives in one place because the five routes used to log four different failure causes as
 * the same `signature_failed` row, which cost a day of wrong diagnosis and left a dead
 * endpoint invisible for six months. The domain handlers stay in their own routes.
 */

export type PayPalWebhookGateDiagnostics = {
  webhook_id: string | null
  webhook_id_source: PayPalWebhookIdResolution['source']
  registry_lookup: PayPalWebhookIdResolution['lookupState']
  registry_message: string | null
  verification_status: string | null
  transmission_age_seconds: number | null
  missing_headers?: string[]
}

export type PayPalWebhookGateResult =
  | {
      ok: true
      webhookId: string
      event: any // PayPal webhook event payload is not typed in this project
      diagnostics: PayPalWebhookGateDiagnostics
    }
  | {
      ok: false
      /** Value for `webhook_logs.status`. */
      logStatus: string
      errorMessage: string
      diagnostics: PayPalWebhookGateDiagnostics
      httpStatus: number
      responseBody: Record<string, unknown>
    }

type GateInput = {
  /** Path under the app URL, e.g. `/api/webhooks/paypal/table-bookings`. */
  endpointPath: string
  /** Label used in the configuration error message, e.g. `table-bookings`. */
  endpointName: string
  headers: Record<string, string>
  body: string
  /** The endpoint's OWN webhook id env var, used only when PayPal cannot be reached. */
  envOverride?: string | null
}

function baseDiagnostics(resolution: PayPalWebhookIdResolution): PayPalWebhookGateDiagnostics {
  return {
    webhook_id: resolution.webhookId,
    webhook_id_source: resolution.source,
    registry_lookup: resolution.lookupState,
    registry_message: resolution.lookupMessage,
    verification_status: null,
    transmission_age_seconds: null,
  }
}

export async function gatePayPalWebhook(input: GateInput): Promise<PayPalWebhookGateResult> {
  const endpointUrl = `${getAppUrl()}${input.endpointPath}`
  const resolution = await resolvePayPalWebhookId(endpointUrl, input.envOverride)
  const diagnostics = baseDiagnostics(resolution)

  if (resolution.source === 'env') {
    logger.warn('PayPal webhook id came from the environment override, not the registry', {
      metadata: {
        endpoint: input.endpointName,
        registryLookup: resolution.lookupState,
        registryMessage: resolution.lookupMessage,
      },
    })
  }

  if (!resolution.webhookId) {
    const errorMessage = resolution.lookupState === 'unavailable'
      ? `Could not reach PayPal to resolve the ${input.endpointName} webhook id`
      : `No PayPal webhook is registered for the ${input.endpointName} endpoint`

    logger.error(errorMessage, {
      metadata: { registryLookup: resolution.lookupState, registryMessage: resolution.lookupMessage },
    })

    return {
      ok: false,
      logStatus: 'configuration_error',
      errorMessage,
      diagnostics,
      // 500 only in production so a misconfigured dev environment still answers.
      httpStatus: process.env.NODE_ENV === 'production' ? 500 : 200,
      responseBody: { received: false, error: errorMessage },
    }
  }

  const verification = await verifyPayPalWebhookDetailed(input.headers, input.body, resolution.webhookId)
  diagnostics.transmission_age_seconds = verification.transmissionAgeSeconds

  switch (verification.outcome) {
    case 'verified': {
      diagnostics.verification_status = verification.verificationStatus
      let event: any
      try {
        event = JSON.parse(input.body)
      } catch (parseError) {
        // verifyPayPalWebhookDetailed already parsed this body, so reaching here means the
        // body changed underneath us. Treat it as an invalid payload rather than trusting it.
        return {
          ok: false,
          logStatus: 'invalid_payload',
          errorMessage: parseError instanceof Error ? parseError.message : 'Invalid JSON payload',
          diagnostics,
          httpStatus: 400,
          responseBody: { error: 'Invalid payload' },
        }
      }
      return { ok: true, webhookId: resolution.webhookId, event, diagnostics }
    }

    case 'missing_signature_headers':
      diagnostics.missing_headers = verification.missingHeaders
      return {
        ok: false,
        logStatus: 'missing_signature_headers',
        errorMessage: `Missing PayPal signature headers: ${verification.missingHeaders.join(', ')}`,
        diagnostics,
        httpStatus: 400,
        responseBody: { error: 'Missing signature headers' },
      }

    case 'stale_transmission':
      return {
        ok: false,
        logStatus: 'stale_transmission',
        errorMessage: `PayPal transmission time is ${verification.reason}`,
        diagnostics,
        httpStatus: 400,
        responseBody: { error: 'Transmission outside the accepted window' },
      }

    case 'invalid_payload':
      return {
        ok: false,
        logStatus: 'invalid_payload',
        errorMessage: verification.message,
        diagnostics,
        httpStatus: 400,
        responseBody: { error: 'Invalid payload' },
      }

    case 'signature_rejected':
      diagnostics.verification_status = verification.verificationStatus
      return {
        ok: false,
        logStatus: 'signature_rejected',
        errorMessage: 'PayPal rejected the webhook signature',
        diagnostics,
        httpStatus: 401,
        responseBody: { error: 'Invalid signature' },
      }

    case 'verification_unavailable':
    default:
      return {
        ok: false,
        logStatus: 'verification_unavailable',
        errorMessage: verification.outcome === 'verification_unavailable'
          ? verification.message
          : 'PayPal verification returned an unexpected result',
        diagnostics,
        // 500 so PayPal retries. Our own outage must never be recorded, or answered, as a
        // rejected signature.
        httpStatus: 500,
        responseBody: { error: 'Verification unavailable' },
      }
  }
}

/**
 * Headers safe to keep on a webhook log row. The signature itself is never stored: it is the
 * secret part, and presence alone is what diagnosis needs.
 */
export function sanitizePayPalHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-time',
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['paypal-transmission-sig-present'] = headers['paypal-transmission-sig'] ? 'true' : 'false'
  return sanitized
}
