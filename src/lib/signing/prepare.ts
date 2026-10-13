import { renderSigningPdf, type SigningPageSelection, type SigningPdfProfile, type SigningRenderInput } from './render'
import { fillSignatureSlots, findSignatureSlots } from './signature-slots'
import { buildAwaitingFills } from './slot-fills'
import type { SigningMode, SigningPartyRole } from './types'

/**
 * Turn a document's HTML, with its signature slots marked, into what createSigningRequest
 * needs: the PDF the signers are shown (each slot saying a signature is awaited) and the render
 * details that let the signed copy be made from the same HTML later.
 */

export interface SigningDocumentSource {
  /** HTML with signature slots marked and unfilled. */
  html: string
  profile: SigningPdfProfile
  pages?: SigningPageSelection
  /** Which party fills which slot. Every key must appear in the HTML. */
  slots: Record<string, SigningPartyRole>
  hasInitials?: boolean
}

export interface SigningSender {
  name: string
  position?: string | null
}

/** Printed where the per-page initials boxes were, before signing. */
export const AWAITING_INITIALS_TEXT = 'To be signed electronically'

/**
 * A slot the document says it has, but its HTML does not, means the template has changed under
 * us. Sending anyway would produce a signed copy with a signature missing from it, so this
 * stops the send instead.
 */
export function assertSlotsPresent(source: Pick<SigningDocumentSource, 'html' | 'slots'>): void {
  const present = new Set(findSignatureSlots(source.html))
  const missing = Object.keys(source.slots).filter((key) => !present.has(key))
  if (missing.length > 0) {
    throw new Error(`The document is missing its signature slots: ${missing.join(', ')}`)
  }
}

/** The HTML as the signers are first shown it: every slot awaiting, or pre-signed for the business. */
export function fillForSending(input: {
  source: SigningDocumentSource
  mode: SigningMode
  parties: Array<{ role: SigningPartyRole; name: string }>
  /** Set when the business signs on sending. */
  sender?: SigningSender | null
  /** Slots of another document that shares this HTML, shown as awaiting too. */
  extraSlots?: Record<string, SigningPartyRole>
}): string {
  assertSlotsPresent(input.source)
  return fillSignatureSlots({
    html: input.source.html,
    fills: buildAwaitingFills({
      slots: { ...(input.extraSlots ?? {}), ...input.source.slots },
      parties: input.parties,
      sender: input.sender ?? null,
    }),
    mode: input.mode,
    initialsText: input.source.hasInitials ? AWAITING_INITIALS_TEXT : null,
  })
}

export function toRenderInput(source: SigningDocumentSource): SigningRenderInput {
  return {
    html: source.html,
    profile: source.profile,
    pages: source.pages,
    slots: source.slots,
    hasInitials: source.hasInitials === true,
  }
}

export interface PreparedSigningDocument {
  pdf: Buffer
  render: SigningRenderInput
}

/** One document from one HTML: fill for sending, render, and package the render details. */
export async function prepareSigningDocument(input: {
  source: SigningDocumentSource
  mode: SigningMode
  parties: Array<{ role: SigningPartyRole; name: string }>
  sender?: SigningSender | null
}): Promise<PreparedSigningDocument> {
  const pdf = await renderSigningPdf({
    html: fillForSending(input),
    profile: input.source.profile,
    pages: input.source.pages,
  })
  return { pdf, render: toRenderInput(input.source) }
}
