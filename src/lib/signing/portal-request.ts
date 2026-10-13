import type { NextResponse } from 'next/server'
import { readSigningEvidence } from './evidence'
import { getPortalPartyContext, getPortalWorker, type PortalWorker } from './portal'
import { messageForState, signingError } from './public-request'
import { resolveSigningPartyState, withdrawIfSubjectClosed, type SigningPartyContext, type SigningPartyState } from './service'
import type { SigningEvidence } from './types'

export interface PortalSigningRequest {
  worker: PortalWorker
  context: SigningPartyContext
  state: SigningPartyState
  evidence: SigningEvidence
}

/**
 * Front door for the staff portal signing endpoints. /api is public at the middleware level, so
 * the session is checked here, and a document that is not this worker's own answers exactly as
 * one that does not exist.
 */
export async function openPortalSigningRequest(
  request: Request,
  partyId: string
): Promise<{ response: NextResponse } | { request: PortalSigningRequest }> {
  const worker = await getPortalWorker()
  if (!worker) {
    return { response: signingError('NOT_AVAILABLE', 'Please sign in again.', 401) }
  }
  const found = await getPortalPartyContext(worker, partyId)
  if (!found) {
    return { response: signingError('LINK_NOT_VALID', 'This document was not found.', 404) }
  }
  const context = await withdrawIfSubjectClosed(found)
  return {
    request: {
      worker,
      context,
      state: resolveSigningPartyState(context, 'portal'),
      evidence: readSigningEvidence(request.headers),
    },
  }
}

export function portalStateRefusal(state: SigningPartyState): NextResponse {
  return signingError('NOT_AVAILABLE', messageForState(state) ?? 'This document is not available.', 410)
}
