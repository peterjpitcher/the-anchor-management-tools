import { NextRequest } from 'next/server'
import { handlePayPalWebhook } from '@/lib/paypal-webhook-dispatch'

export const dynamic = 'force-dynamic'

/**
 * THE PayPal webhook. Register this one URL and nothing else.
 *
 * PayPal fans every event on the app out to every registered webhook and gives no way to scope
 * a registration to a subset of transactions, so a webhook per domain was five copies of one
 * feed: five deliveries, five log rows and five idempotency rows per payment, each endpoint
 * discarding four fifths of what it got. Worse, an endpoint could not tell whose event it had:
 * the table-bookings URL logged "success" for five captures that were really invoices and
 * private bookings, and the parking URL would have thrown on anything that was not parking.
 *
 * This endpoint receives everything and routes on the payload. The per-domain URLs still work
 * and share this exact code, so registrations can be reduced to this one whenever convenient.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handlePayPalWebhook(request, {
    endpointPath: '/api/webhooks/paypal',
    endpointName: 'paypal',
    envOverride: process.env.PAYPAL_WEBHOOK_ID,
  })
}
