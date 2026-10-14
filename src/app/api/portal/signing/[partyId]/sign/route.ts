import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { openPortalSigningRequest, portalStateRefusal } from '@/lib/signing/portal-request'
import { signingError, signingJson, signingServerError } from '@/lib/signing/public-request'
import { signSigningParty } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Completing a document renders its signing record page, which starts a browser.
export const maxDuration = 60

type RouteContext = { params: Promise<{ partyId: string }> }

const BodySchema = z.object({
  typed_name: z.string().trim().min(1).max(120),
  agreed: z.literal(true),
  agreed_text: z.string().min(1).max(600),
})

const REFUSALS: Record<string, string> = {
  name_not_acceptable: 'Please type your full name.',
  agreement_text_changed: 'This page is out of date. Please reload it and try again.',
  document_not_viewed: 'Please open the document before you sign it.',
  already_signed: 'You have already signed this document.',
  document_voided: 'This document has been withdrawn. There is nothing for you to sign.',
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { partyId } = await context.params
  try {
    const opened = await openPortalSigningRequest(request, partyId)
    if ('response' in opened) return opened.response
    const { worker, context: signing, state, evidence } = opened.request
    if (state !== 'ready') return portalStateRefusal(state)

    const parsed = BodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return signingError('VALIDATION_ERROR', 'Please type your full name and tick the box.', 400)
    }

    const result = await signSigningParty({
      context: signing,
      typedName: parsed.data.typed_name,
      agreedText: parsed.data.agreed_text,
      via: 'portal',
      evidence,
      authUserId: worker.userId,
    })
    if (!result.ok) {
      return signingError('REFUSED', REFUSALS[result.reason] ?? 'This could not be signed. Please speak to your manager.', 409, {
        reason: result.reason,
      })
    }
    return signingJson({ signed: true, completed: result.completed }, 201)
  } catch (error) {
    return signingServerError('portal sign', error, { partyId })
  }
}
