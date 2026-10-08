import { NextRequest } from 'next/server'
import { z } from 'zod'

import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import {
  OPS_ALERT_SMS_NUMBER_ENV,
  PAYMENT_FAILURE_ALERT_DAILY_CAP,
  PAYMENT_FAILURE_ALERT_SCOPE,
  PAYMENT_FAILURE_ALERT_TEMPLATE_KEY,
  PAYMENT_FAILURE_ALERT_WINDOW_MINUTES,
  PAYMENT_FAILURE_AREAS,
  PAYMENT_FAILURE_REASONS,
  buildPaymentFailureAlertText,
  paymentFailureAlertSlot,
  resolveOpsAlertSmsNumber,
} from '@/lib/ops-alerts/payment-failure-alert'

/**
 * The website tells us a payment failed; we text the pub's own alert number.
 *
 * Auth is the API key guard every other website-called route uses, with its own
 * scope so no existing key can send a text until it is granted on purpose.
 *
 * This is a staff alert, not a customer message, so it takes the same path as
 * the front-of-house food order alert: no customer is looked up or created, so
 * no opt-in or opt-out record is consulted or written, nothing is added to the
 * `messages` table, and quiet hours do not hold it back.
 *
 * Limits, both enforced here whatever the caller does:
 *   - one text per area every ten minutes;
 *   - six texts in any 24 hours across all areas.
 * The counters live in Upstash when it is configured and in this instance's
 * memory when it is not. The SMS idempotency guard is given the ten minute slot
 * as its dedupe stage, so the per-area limit also holds across instances
 * through the database.
 *
 * A slot is spent when a send is attempted, not when it succeeds. If Twilio is
 * down we answer with the failure and do not hammer it again for ten minutes;
 * the website's email alert does not depend on this endpoint.
 */

const BodySchema = z
  .object({
    area: z.enum(PAYMENT_FAILURE_AREAS),
    reason: z.enum(PAYMENT_FAILURE_REASONS),
  })
  .strict()

const WINDOW_MS = PAYMENT_FAILURE_ALERT_WINDOW_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function limitReached(code: 'ALERT_WINDOW_LIMIT' | 'ALERT_DAILY_CAP', message: string, limited?: Response): Response {
  const response = createErrorResponse(message, code, 429)
  const retryAfter = limited?.headers.get('Retry-After')
  if (retryAfter) {
    response.headers.set('Retry-After', retryAfter)
  }
  return response
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiAuth(
    async (req) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
      }

      const parsed = BodySchema.safeParse(body)
      if (!parsed.success) {
        // The field names only. Echoing a rejected value would put caller text in a response.
        return createErrorResponse('Invalid request body', 'VALIDATION_ERROR', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.') || 'body'),
        })
      }
      const { area, reason } = parsed.data

      const destination = resolveOpsAlertSmsNumber()
      if (!destination.configured) {
        logger.error('Payment failure alert not sent: the alert number is not configured', {
          metadata: { envVar: OPS_ALERT_SMS_NUMBER_ENV, problem: destination.problem, area },
        })
        return createErrorResponse(
          `The alert number is not configured (${OPS_ALERT_SMS_NUMBER_ENV})`,
          'ALERT_NOT_CONFIGURED',
          503
        )
      }

      const windowLimited = await applyDistributedRateLimit(request, {
        prefix: 'ops-alert:payment-failure:area',
        identifier: area,
        window: `${PAYMENT_FAILURE_ALERT_WINDOW_MINUTES} m`,
        max: 1,
        localWindowMs: WINDOW_MS,
      })
      if (windowLimited) {
        return limitReached('ALERT_WINDOW_LIMIT', 'An alert for this area was sent in the last ten minutes', windowLimited)
      }

      const dailyLimited = await applyDistributedRateLimit(request, {
        prefix: 'ops-alert:payment-failure:day',
        identifier: 'all',
        window: '1 d',
        max: PAYMENT_FAILURE_ALERT_DAILY_CAP,
        localWindowMs: DAY_MS,
      })
      if (dailyLimited) {
        return limitReached('ALERT_DAILY_CAP', 'The daily limit for payment failure alerts has been reached', dailyLimited)
      }

      const text = buildPaymentFailureAlertText(area, reason)

      let smsResult: Awaited<ReturnType<typeof sendSMS>>
      try {
        smsResult = await sendSMS(destination.number, text, {
          createCustomerIfMissing: false,
          skipMessageLogging: true,
          skipQuietHours: true,
          metadata: {
            template_key: PAYMENT_FAILURE_ALERT_TEMPLATE_KEY,
            trigger_type: PAYMENT_FAILURE_ALERT_TEMPLATE_KEY,
            stage: paymentFailureAlertSlot(area),
            source: 'website',
          },
        })
      } catch (smsError) {
        logger.error('Payment failure alert send threw unexpectedly', {
          error: smsError instanceof Error ? smsError : new Error(String(smsError)),
          metadata: { area, reason },
        })
        return createErrorResponse('The alert text could not be sent', 'SMS_SEND_FAILED', 502)
      }

      const { code } = extractSmsSafetyInfo(smsResult)

      if (!smsResult.success) {
        logger.error('Payment failure alert was not sent', {
          metadata: { area, reason, code, error: smsResult.error || 'unknown' },
        })
        return createErrorResponse(
          'The alert text could not be sent',
          'SMS_SEND_FAILED',
          502,
          code ? { smsCode: code } : undefined
        )
      }

      // The idempotency guard answers "success" for a send it suppressed as a duplicate.
      // No text went, so say that: another instance already alerted for this slot.
      if ('suppressed' in smsResult && smsResult.suppressed === true) {
        return limitReached('ALERT_WINDOW_LIMIT', 'An alert for this area was sent in the last ten minutes')
      }

      return createApiResponse({ success: true, data: { sent: true, area, reason } }, 202, {}, 'POST')
    },
    [PAYMENT_FAILURE_ALERT_SCOPE],
    request
  )
}
