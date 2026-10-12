import { COMPANY_DETAILS } from '@/lib/company-details'
import { formatDateInLondon } from '@/lib/dateUtils'
import { buildAgreedText } from './agreement-text'
import { signingRoleLabel } from './kinds'
import { messageForState } from './public-request'
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
  endpoints: SigningViewModel['endpoints']
}): SigningViewModel {
  const { party, document } = input.context
  const initialPhase: SigningViewModel['initialPhase'] =
    input.state === 'ready'
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
  const showDetail = input.state === 'ready' || input.state === 'signed'

  return {
    brand: document.brand,
    mode: document.mode,
    title: document.title,
    summary: showDetail ? document.summary : null,
    senderName: document.brand === 'guest' ? COMPANY_DETAILS.tradingName : COMPANY_DETAILS.legalName,
    recipientName: party.name,
    agreedText: buildAgreedText({ mode: document.mode, title: document.title }),
    initialPhase,
    blockedMessage: messageForState(input.state),
    documentViewed: Boolean(party.document_viewed_at),
    expiresOn: formatDateInLondon(input.endpoints.identity === undefined ? document.expires_at : party.token_expires_at ?? document.expires_at, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    inPerson: Boolean(party.witnessed_by) && party.status === 'pending',
    isPortal: input.endpoints.identity === undefined,
    otherSigners: (showDetail ? input.otherParties : [])
      .filter((other) => other.id !== party.id && other.role !== 'company')
      .map((other) => ({
        name: other.name,
        roleLabel: signingRoleLabel(other.role),
        signed: other.status === 'signed',
      })),
    endpoints: input.endpoints,
  }
}
