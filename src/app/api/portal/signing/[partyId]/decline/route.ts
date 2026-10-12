import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { openPortalSigningRequest, portalStateRefusal } from '@/lib/signing/portal-request'
import { signingError, signingJson, signingServerError } from '@/lib/signing/public-request'
import { declineSigningParty } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ partyId: string }> }

const BodySchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { partyId } = await context.params
  try {
    const opened = await openPortalSigningRequest(request, partyId)
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request
    if (state !== 'ready') return portalStateRefusal(state)

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return signingError('VALIDATION_ERROR', 'Please keep the reason under 1,000 characters.', 400)
    }

    const result = await declineSigningParty({ context: signing, reason: parsed.data.reason?.trim() || null, evidence })
    if (!result.ok) {
      return signingError('REFUSED', 'This could not be declined. Please speak to your manager.', 409, { reason: result.reason })
    }
    return signingJson({ declined: true }, 201)
  } catch (error) {
    return signingServerError('portal decline', error, { partyId })
  }
}
