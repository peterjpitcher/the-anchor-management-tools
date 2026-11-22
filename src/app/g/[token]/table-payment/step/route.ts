import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { redactPii } from '@/lib/cron/alerting'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  DEPOSIT_PAY_CLIENT_STEPS,
  afterDepositPayResponse,
  isDepositPayClientFault,
  reportDepositPayStep,
  resolveDepositPayBooking,
  type DepositPayStepDetail,
} from '@/lib/table-bookings/deposit-pay-steps'

/**
 * Where the deposit pay page's browser reports each step it reaches (owner decision,
 * 22 November 2026: record every step so a failed payment can be explained).
 *
 * The booking comes from the guest token in the path, the same token the page itself opens with;
 * a booking id in the body is refused along with every other unknown field. Only the fixed list
 * of client steps is taken. The browser fires this and forgets it, so the answer is a bare status:
 * the write and any alert happen after the response has gone, and a failed write is never the
 * guest's problem.
 */

export const dynamic = 'force-dynamic'

/** PayPal's error as the browser saw it, named fields only. Anything longer or extra is refused. */
const DetailSchema = z
  .object({
    name: z.string().max(120).optional(),
    code: z.string().max(120).optional(),
    message: z.string().max(300).optional(),
    debugId: z.string().max(120).optional(),
  })
  .strict()

const BodySchema = z
  .object({
    step: z.enum(DEPOSIT_PAY_CLIENT_STEPS),
    detail: DetailSchema.optional(),
  })
  .strict()

function answer(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return answer(400)
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return answer(400)

  // A page reports about six steps per attempt, so sixty in fifteen minutes leaves room for a
  // guest who tries several times without leaving the door open to a flood.
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_table_payment_step',
    maxAttempts: 60,
  })
  if (!throttle.allowed) return answer(429)

  const supabase = createAdminClient()
  const booking = await resolveDepositPayBooking(supabase, token)
  if (!booking) return answer(404)

  const { step, detail: sent } = parsed.data
  // The text came from a browser, so it is treated as untrusted: capped above, and anything that
  // looks like a phone number or an email address is taken out before it is stored.
  const detail: DepositPayStepDetail = {
    errorName: sent?.name,
    errorCode: sent?.code,
    errorMessage: sent?.message ? redactPii(sent.message) : undefined,
    paypalDebugId: sent?.debugId,
  }

  afterDepositPayResponse(() =>
    reportDepositPayStep(supabase, { ...booking, step, detail, alert: isDepositPayClientFault(step) }),
  )

  return answer(204)
}
