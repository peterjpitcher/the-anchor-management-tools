import { findSigningKind } from './kinds'
import type { SigningKind, SigningMode } from './types'

/**
 * The exact words a signer agrees to. They are shown beside the tick box, stored with the
 * signature and printed on the signing record, so all three always say the same thing.
 *
 * A kind may word it its own way from what the document stores (a training confirmation names
 * the course and its version: src/lib/signing/training-wording.ts). Pass the document's kind and
 * context wherever the words are shown or checked, so every place builds the same words.
 */
export function buildAgreedText(input: {
  mode: SigningMode
  title: string
  kind?: SigningKind
  context?: Record<string, unknown> | null
}): string {
  if (input.kind) {
    const own = findSigningKind(input.kind)?.agreementWording?.({ title: input.title, context: input.context ?? {} })
    if (own) return own
  }
  if (input.mode === 'acknowledge') {
    return `I confirm that I have read and understood "${input.title}".`
  }
  return `I have read "${input.title}" and I agree to it. I understand that typing my name here has the same effect as signing it by hand.`
}

/** The words recorded for the business when it signs as it sends. */
export function buildCompanyAgreedText(input: {
  title: string
  kind?: SigningKind
  context?: Record<string, unknown> | null
}): string {
  if (input.kind) {
    const own = findSigningKind(input.kind)?.companyAgreementWording?.({ title: input.title, context: input.context ?? {} })
    if (own) return own
  }
  return `Issued and signed for the business: "${input.title}".`
}

/**
 * A typed name must be a real attempt at the signer's name: at least two letters, and not just
 * punctuation. We do not insist it matches the name on file, because people sign with married
 * names, middle names and initials; the name on file is printed beside it on the record.
 */
export function isAcceptableTypedName(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed.length > 120) return false
  return (trimmed.match(/\p{L}/gu) ?? []).length >= 2
}
