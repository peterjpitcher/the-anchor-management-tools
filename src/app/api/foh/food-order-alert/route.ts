import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { createRateLimiter } from '@/lib/rate-limit'

const FOOD_ORDER_ALERT_NUMBER = '+447956315214'
const FOOD_ORDER_ALERT_MESSAGE = 'Food order'
const foodOrderAlertLimiter = createRateLimiter({
  windowMs: 30 * 1000,
  max: 8,
  message: 'Too many food order alerts. Please wait before sending another alert.'
})

export async function POST(request: NextRequest) {
  const rateLimitResponse = await foodOrderAlertLimiter(request)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  // Keep dedupe scoped to a short window so repeated legitimate alerts still send.
  const dedupeStage = `food_order_${Math.floor(Date.now() / 5000)}`

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(FOOD_ORDER_ALERT_NUMBER, FOOD_ORDER_ALERT_MESSAGE, {
      createCustomerIfMissing: false,
      skipQuietHours: true,
      metadata: {
        template_key: 'foh_food_order_alert',
        trigger_type: 'foh_food_order_alert',
        stage: dedupeStage,
        source: 'foh_food_order_button',
        user_id: auth.userId
      }
    })
  } catch (smsError) {
    logger.error('FOH food order SMS alert send threw unexpectedly', {
      error: smsError instanceof Error ? smsError : new Error(String(smsError)),
      metadata: {
        userId: auth.userId,
        to: FOOD_ORDER_ALERT_NUMBER
      }
    })
    return NextResponse.json({ error: 'Failed to send food order alert' }, { status: 500 })
  }

  const code = typeof (smsResult as any)?.code === 'string' ? ((smsResult as any).code as string) : null
  const logFailure = (smsResult as any)?.logFailure === true || code === 'logging_failed'

  if (logFailure) {
    logger.error('FOH food order SMS alert sent but outbound message logging failed', {
      metadata: {
        userId: auth.userId,
        to: FOOD_ORDER_ALERT_NUMBER,
        code,
        logFailure,
      },
    })
  }

  if (!smsResult.success) {
    // Fail-safe: a logging failure means the SMS transport may have succeeded. Returning a 500
    // encourages rapid operator retries that can create duplicate alerts.
    if (logFailure) {
      return NextResponse.json({
        success: true,
        code: code ?? 'logging_failed',
        logFailure: true,
      })
    }

    logger.error('Failed to send FOH food order SMS alert', {
      metadata: {
        userId: auth.userId,
        to: FOOD_ORDER_ALERT_NUMBER,
        error: smsResult.error || 'unknown'
      }
    })

    return NextResponse.json({ error: 'Failed to send food order alert' }, { status: 500 })
  }

  return NextResponse.json({ success: true, code, logFailure })
}
