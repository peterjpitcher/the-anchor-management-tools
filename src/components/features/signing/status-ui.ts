import type { SigningDocumentStatus, SigningMethod, SigningPartyStatus } from '@/lib/signing/types'

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/** How a signing document's status reads and looks, wherever it is listed. */
export const SIGNING_DOCUMENT_STATUS_LABEL: Record<SigningDocumentStatus, string> = {
  sent: 'Waiting to be signed',
  part_signed: 'Partly signed',
  completed: 'Signed',
  declined: 'Declined',
  voided: 'Withdrawn',
  expired: 'Expired',
  superseded: 'Replaced',
}

export const SIGNING_DOCUMENT_STATUS_TONE: Record<SigningDocumentStatus, Tone> = {
  sent: 'warning',
  part_signed: 'warning',
  completed: 'success',
  declined: 'danger',
  voided: 'neutral',
  expired: 'neutral',
  superseded: 'neutral',
}

/** One signer's state within a document. */
export const SIGNING_PARTY_STATUS_LABEL: Record<SigningPartyStatus, string> = {
  pending: 'Not yet signed',
  signed: 'Signed',
  declined: 'Declined',
}

export const SIGNING_PARTY_STATUS_TONE: Record<SigningPartyStatus, Tone> = {
  pending: 'warning',
  signed: 'success',
  declined: 'danger',
}

/** How someone signed, in a few words for a list. The signing record spells it out in full. */
export const SIGNING_METHOD_LABEL: Record<SigningMethod, string> = {
  link: 'by email link',
  portal: 'in the staff portal',
  in_person: 'in person',
  sender: 'on sending',
}
