import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { isPayPalOrderNotFoundError } from '@/lib/paypal'
import { reconcileCapturedParkingPayment } from '@/lib/parking/payments'
import type { ParkingBooking } from '@/types/parking'

/**
 * Records parking payments PayPal took but the database never heard about.
 *
 * Parking capture is triggered only by the customer's return from PayPal. If
 * the capture call succeeds and the row update then fails, the money is gone
 * from the customer's account, the payment row is still `pending`, and nothing
 * retries. There is no webhook on this endpoint either, so nothing else in the
 * system would ever notice.
 *
 * Modelled on `event-paypal-reconciliation`, and like that one it RECORDS
 * rather than captures. An abandoned order sits at APPROVED with intent
 * CAPTURE, so no money has moved and there is nothing to record; capturing it
 * here would charge for a space that has very likely been resold, which the
 * return handler deliberately refuses to do.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const summary = { checked: 0, recorded: 0, untouched: 0, failed: 0 }
  // `untouched` covers both the ordinary case (customer never paid) and the one
  // that needs a person (money taken against a lapsed booking). The distinction
  // is in the logs, which is where anyone chasing it will be looking.

  try {
    const { data: pending, error } = await supabase
      .from('parking_booking_payments')
      .select('id, booking_id, paypal_order_id')
      .eq('status', 'pending')
      .not('paypal_order_id', 'is', null)
      .not('booking_id', 'is', null)
      .limit(100)

    if (error) throw error

    for (const row of pending ?? []) {
      summary.checked += 1

      try {
        const { data: booking, error: bookingError } = await supabase
          .from('parking_bookings')
          .select('*')
          .eq('id', row.booking_id)
          .maybeSingle()

        if (bookingError) throw bookingError
        if (!booking) {
          summary.untouched += 1
          continue
        }

        const result = await reconcileCapturedParkingPayment(
          booking as ParkingBooking,
          row.paypal_order_id as string,
          { client: supabase },
        )

        if (result) {
          summary.recorded += 1
          logger.warn('[parking-reconciliation] recorded a payment PayPal had already taken', {
            metadata: { bookingId: row.booking_id, orderId: row.paypal_order_id },
          })
        } else {
          summary.untouched += 1
        }
      } catch (rowError) {
        // A missing order is the ordinary end state for an abandoned checkout:
        // PayPal purges orders that were never completed.
        if (isPayPalOrderNotFoundError(rowError)) {
          summary.untouched += 1
          continue
        }

        summary.failed += 1
        logger.error('[parking-reconciliation] could not reconcile a payment', {
          error: rowError instanceof Error ? rowError : new Error(String(rowError)),
          metadata: { bookingId: row.booking_id, orderId: row.paypal_order_id },
        })
      }
    }

    return NextResponse.json({ success: true, ...summary })
  } catch (error) {
    logger.error('[parking-reconciliation] run failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ success: false, error: 'Reconciliation failed' }, { status: 500 })
  }
}
