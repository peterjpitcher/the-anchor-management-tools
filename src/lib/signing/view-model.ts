import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateInLondon } from '@/lib/dateUtils'
import { buildAgreedText } from './agreement-text'
import { isInPersonOnlyKind, signingRoleLabel } from './kinds'
import { IN_PERSON_ONLY_MESSAGE, messageForState } from './public-request'
import type { SigningPartyContext, SigningPartyState } from './service'
import type { SigningPartyRow } from './types'
import type { SigningViewModel } from '@/components/features/signing/useSigningFlow'

/**
 * Turn a party, its document and the other signers into what the signing screen shows. Shared
 * by the public link page and the staff portal, which differ only in their endpoints.
 */
export function buildSigningViewModel(input: {
  context: SigningPartyContext
  state: SigningPartyState
  otherParties: Array<Pick<SigningPartyRow, 'id' | 'name' | 'role' | 'status'>>
  /** Titles of other documents still waiting for this same person. */
  alsoToSign?: string[]
  endpoints: SigningViewModel['endpoints']
}): SigningViewModel {
  const { party, document } = input.context
  const isPortal = input.endpoints.identity === undefined
  // A document signed only in person, opened in the staff portal: shown as not signable here.
  // The portal endpoints refuse it too (portal-request.ts); this keeps the screen in step.
  const inPersonElsewhere = isPortal && isInPersonOnlyKind(document.kind) && input.state === 'ready'
  const initialPhase: SigningViewModel['initialPhase'] = inPersonElsewhere
    ? 'blocked'
    : input.state === 'ready'
      ? 'form'
      : input.state === 'needs_identity_check'
        ? 'identity'
        : input.state === 'signed'
          ? 'signed'
          : input.state === 'declined'
            ? 'declined'
            : 'blocked'

  // Who else is signing, and what the document is about, are only for someone who has got as
  // far as the document itself: not before the date of birth check, and not on a dead link.
  const showDetail = !inPersonElsewhere && (input.state === 'ready' || input.state === 'signed')

  return {
    brand: document.brand,
    mode: document.mode,
    title: document.title,
    summary: showDetail ? document.summary : null,
    senderName: document.brand === 'guest' ? COMPANY_DETAILS.tradingName : COMPANY_DETAILS.legalName,
    recipientName: party.name,
    agreedText: buildAgreedText({ mode: document.mode, title: document.title, kind: document.kind, context: document.context }),
    initialPhase,
    blockedMessage: inPersonElsewhere ? IN_PERSON_ONLY_MESSAGE : messageForState(input.state),
    documentViewed: Boolean(party.document_viewed_at),
    expiresOn: formatDateInLondon(input.endpoints.identity === undefined ? document.expires_at : party.token_expires_at ?? document.expires_at, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    inPerson: Boolean(party.witnessed_by) && party.status === 'pending',
    isPortal,
    otherSigners: (showDetail ? input.otherParties : [])
      .filter((other) => other.id !== party.id && other.role !== 'company')
      .map((other) => ({
        name: other.name,
        roleLabel: signingRoleLabel(other.role),
        signed: other.status === 'signed',
      })),
    // Named while there is something to sign and once it is signed, never on a dead link.
    alsoToSign: showDetail ? input.alsoToSign ?? [] : [],
    endpoints: input.endpoints,
  }
}
