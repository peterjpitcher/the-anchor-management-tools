import type { NextResponse } from 'next/server'
import { readSigningEvidence } from './evidence'
import { isInPersonOnlyKind } from './kinds'
import { getPortalPartyContext, getPortalWorker, type PortalWorker } from './portal'
import { IN_PERSON_ONLY_MESSAGE, messageForState, signingError } from './public-request'
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
  if (isInPersonOnlyKind(found.document.kind) && found.party.status !== 'signed') {
    // Signed only in person, on the device a manager hands over, so the record shows them
    // present. Not here: not opened, signed or declined in the portal. A signed copy can still
    // be downloaded once it is signed.
    return { response: signingError('NOT_AVAILABLE', IN_PERSON_ONLY_MESSAGE, 403) }
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
