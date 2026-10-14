import { initialsSlot, signatureSlot } from '../signature-slots'
import type { SigningPartyRole } from '../types'

/**
 * Signature slots for the zero-hours casual worker agreement.
 *
 * The agreement's wording is maintained by the business in src/lib/worker-agreement-template.ts
 * and is not touched here. This takes the HTML that template produces and swaps its blank
 * signature lines for signature slots (src/lib/signing/signature-slots.ts), for an agreement
 * that will be signed online. Each swap must find its lines exactly once: if the template's
 * signature page is ever reworded, this throws, and the tests fail, instead of sending an
 * agreement whose signed copy would show a signature missing.
 */

export const AGREEMENT_SLOT_COMPANY = 'agreement:company'
export const AGREEMENT_SLOT_WORKER = 'agreement:worker'
export const AGREEMENT_SLOT_GUARDIAN = 'agreement:guardian'

const RULE = '<div class="sign-rule"></div>'
const line = (caption: string, last = false): string =>
  `<div class="sign-line"${last ? ' style="margin-bottom:0;"' : ''}>${RULE}<p class="sign-cap">${caption}</p></div>`

/** Whitespace between tags varies with the template's indentation, so it is matched loosely. */
function pattern(parts: string[]): RegExp {
  return new RegExp(parts.map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('\\s*'))
}

const COMPANY_LINES = pattern([
  line('Signature'),
  '<div class="sign-two">',
  line('Name'),
  line('Position'),
  '</div>',
  line('Date', true),
])

const WORKER_LINES = pattern([
  line('Signature'),
  '<div class="sign-two">',
  line('Name'),
  `<div class="sign-line" style="visibility:hidden;">${RULE}<p class="sign-cap">&nbsp;</p></div>`,
  '</div>',
  line('Date', true),
])

const GUARDIAN_LINES = pattern([
  '<div class="sign-two">',
  line('Parent / guardian name', true),
  '<div class="sign-two">',
  line('Signature', true),
  line('Date', true),
  '</div>',
  '</div>',
])

const INITIALS_BOXES = '<span class="foot-init">Initials <span class="init-box"></span> <span class="init-box"></span></span>'

function swapOnce(html: string, find: RegExp, slot: string, what: string): string {
  const matches = html.match(new RegExp(find.source, 'g')) ?? []
  if (matches.length !== 1) {
    throw new Error(`Worker agreement: expected one ${what} signature block, found ${matches.length}`)
  }
  return html.replace(find, slot)
}

export interface WorkerAgreementSlots {
  html: string
  slots: Record<string, SigningPartyRole>
}

export function applyWorkerAgreementSigningSlots(
  html: string,
  options: { includesYoungWorkerSchedule: boolean }
): WorkerAgreementSlots {
  let slotted = swapOnce(html, COMPANY_LINES, signatureSlot(AGREEMENT_SLOT_COMPANY), 'company')
  slotted = swapOnce(slotted, WORKER_LINES, signatureSlot(AGREEMENT_SLOT_WORKER), 'worker')
  const slots: Record<string, SigningPartyRole> = {
    [AGREEMENT_SLOT_COMPANY]: 'company',
    [AGREEMENT_SLOT_WORKER]: 'worker',
  }
  if (options.includesYoungWorkerSchedule) {
    slotted = swapOnce(slotted, GUARDIAN_LINES, signatureSlot(AGREEMENT_SLOT_GUARDIAN), 'parent or guardian')
    slots[AGREEMENT_SLOT_GUARDIAN] = 'guardian'
  } else if (GUARDIAN_LINES.test(slotted)) {
    // The schedule is in the document but the caller says it is not. Going on would send an
    // agreement whose parent or guardian lines nobody is asked to sign.
    throw new Error('Worker agreement: a parent or guardian signature block is present, but the Young Worker Schedule was not expected')
  }
  if (!slotted.includes(INITIALS_BOXES)) {
    throw new Error('Worker agreement: the initials boxes were not found in the page footers')
  }
  slotted = slotted.split(INITIALS_BOXES).join(`<span class="foot-init">${initialsSlot()}</span>`)
  return { html: slotted, slots }
}
