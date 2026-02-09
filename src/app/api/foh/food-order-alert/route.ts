import { NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'

const FOOD_ORDER_ALERT_NUMBER = '+447956315214'
const FOOD_ORDER_ALERT_MESSAGE = 'Food order'

export async function POST() {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const smsResult = await sendSMS(FOOD_ORDER_ALERT_NUMBER, FOOD_ORDER_ALERT_MESSAGE, {
    createCustomerIfMissing: false,
    skipQuietHours: true,
    metadata: {
      source: 'foh_food_order_button',
      user_id: auth.userId
    }
  })

  if (!smsResult.success) {
    logger.error('Failed to send FOH food order SMS alert', {
      metadata: {
        userId: auth.userId,
        to: FOOD_ORDER_ALERT_NUMBER,
        error: smsResult.error || 'unknown'
      }
    })

    return NextResponse.json({ error: 'Failed to send food order alert' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
