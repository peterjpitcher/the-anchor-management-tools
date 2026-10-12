import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  messageForState,
  openPublicSigningRequest,
  signingError,
  signingJson,
  signingServerError,
} from '@/lib/signing/public-request'
import { declineSigningParty } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

const BodySchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params
  try {
    const opened = await openPublicSigningRequest(request, token, { scope: 'signing-decline', maxAttempts: 10 })
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request

    // Someone who cannot pass the date of birth check may still say no.
    if (state !== 'ready' && state !== 'needs_identity_check') {
      return signingError('NOT_AVAILABLE', messageForState(state) ?? 'This document is not available.', 410)
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return signingError('VALIDATION_ERROR', 'Please keep the reason under 1,000 characters.', 400)
    }

    const result = await declineSigningParty({
      context: signing,
      reason: parsed.data.reason?.trim() || null,
      evidence,
    })
    if (!result.ok) {
      return signingError('REFUSED', 'This could not be declined. Please contact us.', 409, { reason: result.reason })
    }
    return signingJson({ declined: true }, 201)
  } catch (error) {
    return signingServerError('decline', error)
  }
}
