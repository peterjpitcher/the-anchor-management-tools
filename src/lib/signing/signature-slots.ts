import { STAFF } from '@/lib/brand/palette'
import type { SigningMethod, SigningMode } from './types'

/**
 * Signature slots: the places in a document where a signature goes.
 *
 * A document sent for signature is rendered from HTML that marks each such place with a
 * comment, `<!--signing-slot:KEY-->`. The same HTML is rendered twice: once before signing,
 * with each slot saying a signature is awaited, and once after, with each slot showing who
 * signed, when and how. So the signed copy a person receives shows the signature where the
 * signature belongs, and never a blank line that makes a signed contract look unsigned (owner
 * request, 13 October 2026).
 *
 * The second render changes nothing but the slots: the HTML is stored when the document is
 * sent, not rebuilt from the record, so an edit to a booking after sending cannot change what
 * the signed copy says. The fingerprint on the signing record is of the first render, the file
 * each signer was shown.
 *
 * Pure: no server imports, so it can be tested without a browser. Colours come from the brand
 * palette, the neutral ink every printed document here uses.
 */

const SLOT_PATTERN = /<!--signing-slot:([a-z0-9:_-]+)-->/g
const INITIALS_MARKER = '<!--signing-initials-->'

/** The marker a template prints where a signature goes. */
export function signatureSlot(key: string): string {
  if (!/^[a-z0-9:_-]+$/.test(key)) throw new Error(`Invalid signature slot key: ${key}`)
  return `<!--signing-slot:${key}-->`
}

/**
 * The marker a template prints in place of per-page initials boxes. Initials cannot be
 * collected online, and an empty box on a signed copy reads as something left undone.
 */
export function initialsSlot(): string {
  return INITIALS_MARKER
}

/** The slot keys present in a piece of HTML, in the order they first appear. */
export function findSignatureSlots(html: string): string[] {
  const keys = new Set<string>()
  for (const match of html.matchAll(SLOT_PATTERN)) keys.add(match[1])
  return [...keys]
}

export type SignatureSlotFill =
  /** Before signing: someone will sign here. */
  | { state: 'awaiting'; who?: string | null }
  /** Signed: who, when, where and how. */
  | {
      state: 'signed'
      /** The name they typed (or, for the business, the name of whoever sent it). */
      name: string
      /** "13 October 2026 at 11:41:35 BST", or the plain date for the business before sending. */
      when: string
      /** "Staines, ENG, GB", or null when it is not known or does not apply. */
      location: string | null
      /** One short plain line: how they signed. */
      how: string
      /** Short reference to the signing record, such as "CEEBA528". */
      reference: string | null
    }
  /** A slot on pages that belong to another document, or that nobody is signing. */
  | { state: 'blank' }

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Inline styles only, and `font: inherit`, so a slot sits in any template without that
 * template knowing about it. The fixed minimum height keeps the box the same size before and
 * after signing: the contract and the worker agreement are fixed-height A4 sheets, and a box
 * that grew on signing would push their footers off the page.
 */
const BOX_STYLE = 'min-height:24mm;box-sizing:border-box;font:inherit;line-height:1.4;'
const SMALL_CAPS = 'font-size:7.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;'
const LINE = 'font-size:9px;margin:0;'

export function signedLabel(mode: SigningMode): string {
  return mode === 'acknowledge' ? 'Confirmed electronically' : 'Signed electronically'
}

const HOW: Record<SigningMethod, string> = {
  link: 'By a personal link sent by email',
  portal: 'Signed in to the staff portal',
  in_person: 'In person',
  sender: 'On sending, signed in to the management app',
}

/** How someone signed, as one short line for the slot. */
export function describeHow(method: SigningMethod, witnessName?: string | null): string {
  if (method === 'in_person' && witnessName) return `In person, with ${witnessName} present`
  return HOW[method]
}

export function renderSignatureSlot(fill: SignatureSlotFill, mode: SigningMode): string {
  if (fill.state === 'blank') {
    return `<div style="${BOX_STYLE}"></div>`
  }
  if (fill.state === 'awaiting') {
    const action = mode === 'acknowledge' ? 'To be confirmed electronically' : 'To be signed electronically'
    const verb = mode === 'acknowledge' ? 'confirms' : 'signs'
    return `<div style="${BOX_STYLE}border:1px dashed ${STAFF.borderStrong};padding:2.6mm 3mm;color:${STAFF.textMuted};">
  <p style="${SMALL_CAPS}margin:0 0 1mm;">${action}</p>
  <p style="${LINE}">${fill.who ? `${esc(fill.who)} ${verb} online. ` : ''}No handwritten signature is needed.</p>
</div>`
  }
  const lines = [
    `<p style="${LINE}">${esc(fill.when)}</p>`,
    fill.location ? `<p style="${LINE}">${esc(fill.location)} (approximate location)</p>` : '',
    `<p style="${LINE}color:${STAFF.textMuted};">${esc(fill.how)}${fill.reference ? `. Signing record on the last page, ref ${esc(fill.reference)}` : ''}</p>`,
  ].filter(Boolean)
  return `<div style="${BOX_STYLE}border-left:2px solid ${STAFF.text};padding:0.4mm 0 0.4mm 3mm;">
  <p style="font-size:13px;font-weight:600;margin:0 0 0.6mm;line-height:1.25;overflow-wrap:anywhere;">${esc(fill.name)}</p>
  <p style="${SMALL_CAPS}margin:0 0 1mm;">${signedLabel(mode)}</p>
  ${lines.join('\n  ')}
</div>`
}

/**
 * Fill every slot in the HTML. A slot with no fill given is left blank, never left as a
 * marker: an unfilled comment would print as nothing, and a signature box that silently
 * vanished is exactly the fault this exists to prevent, so callers are expected to fill every
 * slot their document owns (the tests pin that for each template).
 */
export function fillSignatureSlots(input: {
  html: string
  fills: Record<string, SignatureSlotFill>
  mode: SigningMode
  /** Printed where the per-page initials boxes were. Null prints nothing there. */
  initialsText: string | null
}): string {
  const withSlots = input.html.replace(SLOT_PATTERN, (_marker, key: string) =>
    renderSignatureSlot(input.fills[key] ?? { state: 'blank' }, input.mode)
  )
  return withSlots.split(INITIALS_MARKER).join(input.initialsText ? esc(input.initialsText) : '')
}
