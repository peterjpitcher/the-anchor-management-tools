import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { submitPrivateBookingFeedbackByRawToken } from '@/lib/private-bookings/feedback'

const FeedbackSchema = z.object({
  rating_overall: z.preprocess(
    (value) => (typeof value === 'string' && value.length > 0 ? Number.parseInt(value, 10) : NaN),
    z.number().int().min(1).max(5)
  ),
  rating_food: z
    .preprocess((value) => {
      if (typeof value !== 'string' || value.length === 0) return null
      return Number.parseInt(value, 10)
    }, z.number().int().min(1).max(5).nullable())
    .optional(),
  rating_service: z
    .preprocess((value) => {
      if (typeof value !== 'string' || value.length === 0) return null
      return Number.parseInt(value, 10)
    }, z.number().int().min(1).max(5).nullable())
    .optional(),
  comments: z
    .preprocess((value) => (typeof value === 'string' ? value.trim() : ''), z.string().max(2000))
    .optional()
})

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(
    new URL(`/g/${token}/private-feedback?status=${encodeURIComponent(status)}`, request.url),
    303
  )
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_private_feedback_submit',
    maxAttempts: 8
  })

  if (!throttle.allowed) {
    return redirectWithStatus(request, token, 'rate_limited')
  }

  const formData = await request.formData()

  const parsed = FeedbackSchema.safeParse({
    rating_overall: formData.get('rating_overall'),
    rating_food: formData.get('rating_food'),
    rating_service: formData.get('rating_service'),
    comments: formData.get('comments')
  })

  if (!parsed.success) {
    return redirectWithStatus(request, token, 'error')
  }

  const supabase = createAdminClient()

  try {
    const result = await submitPrivateBookingFeedbackByRawToken(supabase, {
      rawToken: token,
      ratingOverall: parsed.data.rating_overall,
      ratingFood: parsed.data.rating_food ?? null,
      ratingService: parsed.data.rating_service ?? null,
      comments: parsed.data.comments || null
    })

    if (result.state !== 'submitted') {
      return redirectWithStatus(request, token, 'error')
    }

    return redirectWithStatus(request, token, 'submitted')
  } catch (error) {
    logger.warn('Guest private-feedback submission failed unexpectedly', {
      metadata: {
        token,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }
}
