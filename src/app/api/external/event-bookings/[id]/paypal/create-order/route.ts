import { NextRequest, NextResponse } from 'next/server'

import { withApiAuth } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createEventPayPalOrderByBookingId } from '@/lib/events/event-payments'
import { logAuditEvent } from '@/app/actions/audit'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: bookingId } = await params

  return withApiAuth(
    async () => {
      const supabase = createAdminClient()
      const result = await createEventPayPalOrderByBookingId(supabase, { bookingId })

      if (result.state !== 'created') {
        return NextResponse.json(
          { success: false, error: result.reason },
          { status: result.reason === 'hold_expired' ? 410 : 409 }
        )
      }

      void logAuditEvent({
        operation_type: 'event_payment.paypal_order_created',
        resource_type: 'event_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          order_id: result.orderId,
          amount: result.amount,
          currency: result.currency,
          source: 'external',
        },
      })

      return NextResponse.json({
        success: true,
        orderId: result.orderId,
        amount: result.amount,
        currency: result.currency,
        holdExpiresAt: result.holdExpiresAt,
      })
    },
    ['payments:capture'],
    request
  )
}
