import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isValidIsoDate } from '@/lib/dateUtils'
import {
  messageForState,
  openPublicSigningRequest,
  signingError,
  signingJson,
  signingServerError,
} from '@/lib/signing/public-request'
import { checkSigningIdentity } from '@/lib/signing/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

const BodySchema = z.object({
  date_of_birth: z.string().refine(isValidIsoDate, 'Enter your date of birth.'),
})

/** A new starter confirms the date of birth we hold before they can open and sign. */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params
  try {
    const opened = await openPublicSigningRequest(request, token, { scope: 'signing-identity', maxAttempts: 10 })
    if ('response' in opened) return opened.response
    const { context: signing, state, evidence } = opened.request

    if (state === 'ready') return signingJson({ verified: true })
    if (state !== 'needs_identity_check') {
      return signingError('NOT_AVAILABLE', messageForState(state) ?? 'This document is not available.', 410)
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return signingError('VALIDATION_ERROR', 'Enter your date of birth.', 400)
    }

    const result = await checkSigningIdentity(signing, parsed.data.date_of_birth, evidence)
    if (result.ok) return signingJson({ verified: true })

    if (result.reason === 'no_record') {
      return signingError(
        'IDENTITY_CHECK_FAILED',
        'We cannot check your details online. Please contact us and we will arrange for you to sign in person.',
        409
      )
    }
    if (result.reason === 'locked') {
      return signingError('IDENTITY_CHECK_FAILED', messageForState('locked') as string, 423, { attempts_left: 0 })
    }
    return signingError(
      'IDENTITY_CHECK_FAILED',
      `That does not match our records. You have ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`,
      403,
      { attempts_left: result.attemptsLeft }
    )
  } catch (error) {
    return signingServerError('identity check', error)
  }
}
