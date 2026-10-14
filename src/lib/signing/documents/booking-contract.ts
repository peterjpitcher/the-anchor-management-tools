import { CONTRACT_SLOT_ANCHOR, CONTRACT_SLOT_HOST, WAIVER_SLOT_ORGANISER, bookingRequiresWaiverAnnex } from '@/lib/contract-template'
import { formatDateInLondon } from '@/lib/dateUtils'
import { renderContractPreview } from '@/lib/private-bookings/contract-lifecycle'
import {
  assertSlotsPresent,
  fillForSending,
  toRenderInput,
  type PreparedSigningDocument,
  type SigningDocumentSource,
  type SigningSender,
} from '../prepare'
import { renderSigningPdf, selectPdfPages } from '../render'
import { findSignatureSlots } from '../signature-slots'
import { SigningError, createSigningRequest, voidSigningDocument, type SigningPartyInput } from '../service'
import type { SigningPartyRole } from '../types'

/**
 * Private booking contracts and the self-catering and outside food agreement ("the waiver"),
 * for signing.
 *
 * They are two documents with two signatures (owner decision, 13 October 2026, and what the
 * waiver itself says: "This signature is separate from, and additional to, the signature on
 * the private booking contract"). The contract template prints both from one HTML, so that
 * HTML is rendered once and its pages divided: the contract sheets are one signing request and
 * the waiver sheets another. A booking with no outside food has only the contract.
 */

export interface BookingForSigning {
  id: string
  customer_id?: string | null
  customer_name?: string | null
  customer_first_name?: string | null
  customer_last_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  event_date?: string | null
  event_type?: string | null
  date_tbd?: boolean | null
  outside_food?: boolean | null
  waiver_status?: string | null
}

export const CONTRACT_TITLE = 'Private booking contract'
export const WAIVER_TITLE = 'Self-catering and outside food agreement'

const CONTRACT_SLOTS: Record<string, SigningPartyRole> = {
  [CONTRACT_SLOT_HOST]: 'customer',
  [CONTRACT_SLOT_ANCHOR]: 'company',
}
const WAIVER_SLOTS: Record<string, SigningPartyRole> = {
  [WAIVER_SLOT_ORGANISER]: 'customer',
}

export function bookingSignerParty(booking: BookingForSigning): SigningPartyInput {
  const name =
    [booking.customer_first_name, booking.customer_last_name].map((part) => part?.trim()).filter(Boolean).join(' ') ||
    booking.customer_name?.trim() ||
    ''
  return {
    role: 'customer',
    name,
    email: booking.contact_email ?? null,
    phone: booking.contact_phone ?? null,
    customerId: booking.customer_id ?? null,
  }
}

function eventLabel(booking: BookingForSigning): string {
  const what = booking.event_type?.trim() || 'your event'
  if (booking.date_tbd || !booking.event_date) return `${what} (date to be confirmed)`
  return `${what} on ${formatDateInLondon(booking.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
}

/** How many sheets of the contract HTML are the waiver. Zero when the booking has none. */
export function countWaiverSheets(signingHtml: string): number {
  return (signingHtml.match(/<section class="sheet" data-doc="waiver">/g) ?? []).length
}

/** Every sheet of the contract HTML, contract and food agreement together. */
function countSheets(signingHtml: string): number {
  return (signingHtml.match(/<section class="sheet" data-doc="(?:contract|waiver)">/g) ?? []).length
}

function contractSource(signingHtml: string, waiverSheets: number): SigningDocumentSource {
  return {
    html: signingHtml,
    profile: 'a4_css_page',
    // Each sheet of the template prints as one page. `total` holds the split to that: if the
    // render, now or when the signed copy is made, has a different number of pages, it stops.
    pages: waiverSheets > 0 ? { skipLast: waiverSheets, total: countSheets(signingHtml) } : { total: countSheets(signingHtml) },
    slots: CONTRACT_SLOTS,
    hasInitials: true,
  }
}

function waiverSource(signingHtml: string, waiverSheets: number): SigningDocumentSource {
  return {
    html: signingHtml,
    profile: 'a4_css_page',
    pages: { onlyLast: waiverSheets, total: countSheets(signingHtml) },
    slots: WAIVER_SLOTS,
    // The single-sheet waiver has no initials boxes: it is signed once by the organiser.
    hasInitials: false,
  }
}

export interface PreparedBookingContract {
  /** Every sheet as sent, for the booking's own record of what the customer received. */
  fullPdf: Buffer
  contract: PreparedSigningDocument
  /** Null when the booking has no outside food. */
  waiver: PreparedSigningDocument | null
}

/**
 * Render the contract for sending, once, and divide it into the documents to be signed.
 * `signingHtml` is the contract HTML with signature slots (generateContractDocument returns it).
 */
export async function prepareBookingContract(input: {
  signingHtml: string
  booking: BookingForSigning
  /** The member of staff sending it, who signs for The Anchor as they send. */
  sender: SigningSender
  /**
   * True when the booking's food agreement is already signed. The contract then goes alone:
   * nobody is asked to sign the same agreement twice, and the copy kept holds the contract only.
   */
  waiverAlreadySigned?: boolean
}): Promise<PreparedBookingContract> {
  const waiverSheets = countWaiverSheets(input.signingHtml)
  // The food agreement's signature place and its pages must agree. If the template has changed
  // so that one is found without the other, the split below would put the food agreement inside
  // the contract or send it with no signature place, so stop instead.
  const hasWaiverSlot = findSignatureSlots(input.signingHtml).includes(WAIVER_SLOT_ORGANISER)
  if (hasWaiverSlot !== waiverSheets > 0) {
    throw new Error('The food agreement pages of the contract could not be identified, so the two documents could not be separated')
  }
  const contract = contractSource(input.signingHtml, waiverSheets)
  const waiver = waiverSheets > 0 && !input.waiverAlreadySigned ? waiverSource(input.signingHtml, waiverSheets) : null
  if (waiver) assertSlotsPresent(waiver)
  const party = bookingSignerParty(input.booking)

  const filled = fillForSending({
    source: contract,
    mode: 'sign',
    parties: [{ role: 'customer', name: party.name }],
    sender: input.sender,
    extraSlots: waiver?.slots,
  })
  const fullPdf = await renderSigningPdf({ html: filled, profile: 'a4_css_page' })

  const contractPdf = await selectPdfPages(fullPdf, contract.pages)
  return {
    // What was sent: every page, or the contract alone where the food agreement was left out.
    fullPdf: waiver || waiverSheets === 0 ? fullPdf : contractPdf,
    contract: { pdf: contractPdf, render: toRenderInput(contract) },
    waiver: waiver ? { pdf: await selectPdfPages(fullPdf, waiver.pages), render: toRenderInput(waiver) } : null,
  }
}

export interface BookingSigningLink {
  documentId: string
  partyId: string
  signingUrl: string
}

/**
 * Create the signing requests for a contract that has just been prepared: one for the
 * contract, and a second for the waiver where the booking has outside food. The links are not
 * emailed here: the caller puts both in the contract email, so the customer gets one message.
 * If the second request cannot be created the first is withdrawn, so a customer is never asked
 * to sign half of what they were sent.
 */
export async function createBookingContractSigningRequests(input: {
  booking: BookingForSigning
  contractVersion: number
  prepared: PreparedBookingContract
  userId: string
  sender: SigningSender
}): Promise<{ contract: BookingSigningLink; waiver: BookingSigningLink | null }> {
  const party = bookingSignerParty(input.booking)
  if (!party.name) throw new SigningError('party_name_missing', 'Add the customer\'s name before sending the contract.')
  if (!party.email) throw new SigningError('no_email', 'Add a contact email address before sending the contract.')

  const link = (result: Awaited<ReturnType<typeof createSigningRequest>>): BookingSigningLink => {
    const delivery = result.deliveries.find((candidate) => candidate.signingUrl)
    if (!delivery?.signingUrl) throw new Error('The signing link was not created')
    return { documentId: result.documentId, partyId: delivery.partyId, signingUrl: delivery.signingUrl }
  }

  const contract = link(
    await createSigningRequest({
      kind: 'private_booking_contract',
      subjectId: input.booking.id,
      title: CONTRACT_TITLE,
      summary: `The contract and terms for ${eventLabel(input.booking)}.`,
      pdf: input.prepared.contract.pdf,
      render: input.prepared.contract.render,
      parties: [party],
      createdBy: input.userId,
      createdByName: input.sender.name,
      createdByPosition: input.sender.position ?? null,
      context: { contract_version: input.contractVersion },
      sendLinkEmails: false,
    })
  )

  if (!input.prepared.waiver) return { contract, waiver: null }

  try {
    const waiver = link(
      await createSigningRequest({
        kind: 'private_booking_waiver',
        subjectId: input.booking.id,
        title: WAIVER_TITLE,
        summary: `This covers food you bring or arrange yourself for ${eventLabel(input.booking)}. It is signed separately from the contract.`,
        pdf: input.prepared.waiver.pdf,
        render: input.prepared.waiver.render,
        parties: [party],
        createdBy: input.userId,
        createdByName: input.sender.name,
        context: { contract_version: input.contractVersion },
        sendLinkEmails: false,
      })
    )
    return { contract, waiver }
  } catch (waiverError) {
    await voidSigningDocument({
      documentId: contract.documentId,
      userId: input.userId,
      reason: 'The food agreement could not be prepared with it',
    }).catch(() => undefined)
    throw waiverError
  }
}

/**
 * The waiver on its own, from the contract as it stands now, for a booking whose contract was
 * already accepted another way (by paying the deposit) or that gained outside food later.
 * Rendering the whole contract and keeping its last sheets means the waiver someone signs alone
 * is, to the letter, the one printed at the back of their contract.
 */
export async function prepareBookingWaiver(bookingId: string): Promise<{ prepared: PreparedSigningDocument; booking: BookingForSigning }> {
  const { signingHtml, booking } = await renderContractPreview(bookingId)
  if (!bookingRequiresWaiverAnnex(booking)) {
    throw new SigningError('no_waiver', 'This booking has no outside food, so there is no food agreement to sign.')
  }
  const waiverSheets = countWaiverSheets(signingHtml)
  if (waiverSheets === 0) {
    throw new Error('The contract did not include the food agreement sheet')
  }
  const source = waiverSource(signingHtml, waiverSheets)
  const party = bookingSignerParty(booking as BookingForSigning)
  const pdf = await renderSigningPdf({
    html: fillForSending({ source, mode: 'sign', parties: [{ role: 'customer', name: party.name }], extraSlots: CONTRACT_SLOTS }),
    profile: source.profile,
    pages: source.pages,
  })
  return { prepared: { pdf, render: toRenderInput(source) }, booking: booking as BookingForSigning }
}
