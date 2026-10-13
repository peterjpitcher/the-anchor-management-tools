import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  messageForState,
  openPublicSigningRequest,
  signingError,
  signingJson,
  signingServerError,
} from '@/lib/signing/public-request'
import { signSigningParty } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Completing a document renders its signing record page, which starts a browser.
export const maxDuration = 60

type RouteContext = { params: Promise<{ token: string }> }

const BodySchema = z.object({
  typed_name: z.string().trim().min(1).max(120),
  agreed: z.literal(true),
  agreed_text: z.string().min(1).max(600),
})

const REFUSALS: Record<string, { message: string; status: number }> = {
  name_not_acceptable: { message: 'Please type your full name.', status: 400 },
  missing_name_or_agreement: { message: 'Please type your full name and tick the box.', status: 400 },
  agreement_text_changed: { message: 'This page is out of date. Please reload it and try again.', status: 409 },
  document_not_viewed: { message: 'Please open the document before you sign it.', status: 409 },
  identity_not_checked: { message: 'Please confirm your date of birth first.', status: 403 },
  already_signed: { message: 'You have already signed this document.', status: 409 },
  already_declined: { message: 'You have already declined this document.', status: 409 },
  link_expired: { message: 'This link has expired. Please ask us to send a new one.', status: 410 },
  document_expired: { message: 'This request has expired. Please ask us to send the document again.', status: 410 },
  document_voided: { message: 'This document has been withdrawn. There is nothing for you to sign.', status: 410 },
  document_declined: { message: 'This document was declined by another signer and is no longer open.', status: 410 },
  document_superseded: { message: 'This document has been replaced by a newer version.', status: 410 },
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params
  try {
    const opened = await openPublicSigningRequest(request, token, { scope: 'signing-sign', maxAttempts: 10 })
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request

    if (state !== 'ready') {
      const message = state === 'needs_identity_check'
        ? 'Please confirm your date of birth first.'
        : messageForState(state) ?? 'This document is not available.'
      return signingError('NOT_AVAILABLE', message, state === 'needs_identity_check' ? 403 : 410)
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return signingError('VALIDATION_ERROR', 'Please type your full name and tick the box.', 400)
    }

    const result = await signSigningParty({
      context: signing,
      typedName: parsed.data.typed_name,
      agreedText: parsed.data.agreed_text,
      via: 'link',
      evidence,
    })
    if (!result.ok) {
      const refusal = REFUSALS[result.reason] ?? { message: 'This could not be signed. Please contact us.', status: 409 }
      return signingError('REFUSED', refusal.message, refusal.status, { reason: result.reason })
    }
    return signingJson({ signed: true, completed: result.completed }, 201)
  } catch (error) {
    return signingServerError('sign', error)
  }
}
