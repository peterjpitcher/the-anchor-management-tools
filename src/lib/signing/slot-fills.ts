import { formatDateInLondon } from '@/lib/dateUtils'
import { formatSigningInstant, type CertificateParty } from './certificate'
import { describeHow, type SignatureSlotFill } from './signature-slots'
import type { SigningDocumentRow, SigningPartyRole } from './types'

/**
 * What goes in each signature slot: before signing (who is expected to sign there) and after
 * (who did, when, where and how). See signature-slots.ts for the slots themselves.
 */

/** "CEEBA528": the start of the document's id, as printed beside each signature. */
export function signingReference(documentId: string): string {
  return documentId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

function location(party: Pick<CertificateParty, 'signed_city' | 'signed_region' | 'signed_country'>): string | null {
  const parts = [party.signed_city, party.signed_region, party.signed_country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * The slots as the signers are first shown them. Everyone still to sign is "to be signed
 * electronically". The business, where it signs, signs as the document is sent, so its slot
 * already carries the sender's name and today's date.
 */
export function buildAwaitingFills(input: {
  slots: Record<string, SigningPartyRole>
  parties: Array<{ role: SigningPartyRole; name: string }>
  /** Set when the business signs on sending. */
  sender?: { name: string; position?: string | null } | null
  now?: Date
}): Record<string, SignatureSlotFill> {
  const fills: Record<string, SignatureSlotFill> = {}
  for (const [key, role] of Object.entries(input.slots)) {
    if (role === 'company') {
      fills[key] = input.sender
        ? {
            state: 'signed',
            name: input.sender.position ? `${input.sender.name}, ${input.sender.position}` : input.sender.name,
            when: formatDateInLondon(input.now ?? new Date(), { day: 'numeric', month: 'long', year: 'numeric' }),
            location: null,
            how: describeHow('sender'),
            reference: null,
          }
        : { state: 'blank' }
      continue
    }
    const party = input.parties.find((candidate) => candidate.role === role)
    fills[key] = party ? { state: 'awaiting', who: party.name } : { state: 'blank' }
  }
  return fills
}

/** The slots once the document is fully signed, from the recorded signatures. */
export function buildSignedFills(input: {
  document: Pick<SigningDocumentRow, 'id' | 'context'>
  slots: Record<string, SigningPartyRole>
  parties: CertificateParty[]
}): Record<string, SignatureSlotFill> {
  const reference = signingReference(input.document.id)
  const position = typeof input.document.context.sender_position === 'string' ? input.document.context.sender_position : null
  const fills: Record<string, SignatureSlotFill> = {}
  for (const [key, role] of Object.entries(input.slots)) {
    const party = input.parties.find((candidate) => candidate.role === role)
    if (!party) {
      fills[key] = { state: 'blank' }
      continue
    }
    if (party.status !== 'signed' || !party.signed_at || !party.method) {
      fills[key] = { state: 'awaiting', who: party.name }
      continue
    }
    const name = party.typed_name ?? party.name
    fills[key] = {
      state: 'signed',
      name: role === 'company' && position ? `${name}, ${position}` : name,
      when: formatSigningInstant(party.signed_at),
      location: location(party),
      how: describeHow(party.method, party.witnessName),
      reference,
    }
  }
  return fills
}
