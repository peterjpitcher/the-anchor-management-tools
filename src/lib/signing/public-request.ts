import { NextResponse } from 'next/server'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'
import { readSigningEvidence } from './evidence'
import {
  getSigningPartyByToken,
  resolveSigningPartyState,
  withdrawIfSubjectClosed,
  type SigningPartyContext,
  type SigningPartyState,
} from './service'
import type { SigningEvidence } from './types'

/**
 * Shared front door for the public signing endpoints (/api/sign/[token]/...).
 *
 * These are reachable by anyone who has a link, so every one of them: throttles by link and
 * address, answers an unknown link exactly as it answers a dead one, never caches, and fails
 * closed. If we cannot record something, the signer is told it did not work and we are alerted;
 * nothing is ever reported as signed that was not written.
 */

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export type SigningErrorCode =
  | 'RATE_LIMITED'
  | 'LINK_NOT_VALID'
  | 'NOT_AVAILABLE'
  | 'VALIDATION_ERROR'
  | 'IDENTITY_CHECK_FAILED'
  | 'REFUSED'
  | 'SERVER_ERROR'

export function signingJson(data: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status, headers: { ...NO_STORE, ...headers } })
}

export function signingError(
  code: SigningErrorCode,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, ...extra } },
    { status, headers: { ...NO_STORE, ...headers } }
  )
}

/** The one answer for a link we do not recognise, whatever the reason. */
export function linkNotValid(): NextResponse {
  return signingError('LINK_NOT_VALID', 'This link is not valid. Please use the link in your most recent email.', 404)
}

const STATE_MESSAGES: Record<Exclude<SigningPartyState, 'ready' | 'needs_identity_check'>, string> = {
  locked: 'This link has been locked after too many wrong answers. Please ask us to send a new one.',
  signed: 'You have already signed this document.',
  declined: 'You have already declined this document.',
  link_expired: 'This link has expired. Please ask us to send a new one.',
  expired: 'This request has expired. Please ask us to send the document again.',
  voided: 'This document has been withdrawn. There is nothing for you to sign.',
  superseded: 'This document has been replaced by a newer version.',
  document_declined: 'This document was declined by another signer and is no longer open.',
}

export function messageForState(state: SigningPartyState): string | null {
  if (state === 'ready' || state === 'needs_identity_check') return null
  return STATE_MESSAGES[state]
}

export interface PublicSigningRequest {
  context: SigningPartyContext
  state: SigningPartyState
  evidence: SigningEvidence
}

/**
 * Throttle, then resolve the link. Returns either the response to send straight back, or the
 * party, document and evidence for the handler to work with.
 */
export async function openPublicSigningRequest(
  request: Request,
  rawToken: string,
  options: { scope: string; maxAttempts: number }
): Promise<{ response: NextResponse } | { request: PublicSigningRequest }> {
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken,
    scope: options.scope,
    maxAttempts: options.maxAttempts,
    windowMs: 15 * 60 * 1000,
  })
  if (!throttle.allowed) {
    return {
      response: signingError('RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.', 429, {}, {
        'Retry-After': String(throttle.retryAfterSeconds),
      }),
    }
  }

  const found = await getSigningPartyByToken(rawToken)
  if (!found) {
    return { response: linkNotValid() }
  }
  // The booking may have been cancelled, or the quote settled by phone, since the link was sent.
  const context = await withdrawIfSubjectClosed(found)
  return {
    request: {
      context,
      state: resolveSigningPartyState(context, 'link'),
      evidence: readSigningEvidence(request.headers),
    },
  }
}

/**
 * Our own failure, on a public write path. The signer sees a clear error and how to reach us;
 * we get a log line and an alert. Never reported to them as anything they did wrong.
 */
export async function signingServerError(what: string, error: unknown, context: Record<string, unknown> = {}): Promise<NextResponse> {
  logger.error(`Signing endpoint failed: ${what}`, {
    error: error instanceof Error ? error : new Error(String(error)),
    metadata: context,
  })
  try {
    await reportCronFailure(`signing endpoint: ${what}`, error, context)
  } catch {
    // The log line above is the record.
  }
  return signingError(
    'SERVER_ERROR',
    'Sorry, something went wrong on our side and this was not saved. Please try again in a moment, or contact us and we will sort it out.',
    500
  )
}
