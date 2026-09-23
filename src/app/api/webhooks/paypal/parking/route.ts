import { NextRequest } from 'next/server'
import { handlePayPalWebhook } from '@/lib/paypal-webhook-dispatch'

export const dynamic = 'force-dynamic'

/**
 * Legacy per-domain PayPal webhook URL.
 *
 * PayPal delivers every event on the app to every registered URL, so this never received only
 * "its own" events and its name never meant anything: production shows invoice and event-ticket
 * captures arriving here. It is kept alive, delegating to the shared dispatcher, purely so the
 * existing PayPal registrations keep working while they are reduced to the single
 * /api/webhooks/paypal endpoint. Delete it once nothing is registered against this URL.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handlePayPalWebhook(request, {
    endpointPath: '/api/webhooks/paypal/parking',
    endpointName: 'parking',
    envOverride: process.env.PAYPAL_PARKING_WEBHOOK_ID,
  })
}
