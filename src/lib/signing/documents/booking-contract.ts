import { PDFDocument } from 'pdf-lib'
import { bookingRequiresWaiverAnnex } from '@/lib/contract-template'
import { formatDateInLondon } from '@/lib/dateUtils'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { renderContractPreview } from '@/lib/private-bookings/contract-lifecycle'
import { SigningError, createSigningRequest, type SigningPartyInput } from '../service'

/**
 * Private booking contracts and the self-catering waiver, for signing.
 *
 * The contract PDF carries the waiver as its last sheet when the booking has self-catering. Sent
 * together, one signature covers both and the title says so. The waiver can also be sent on its
 * own, for a booking whose contract was already accepted by paying the deposit.
 */

export const CONTRACT_PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
} as const

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
  waiver_status?: string | null
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

export const CONTRACT_TITLE = 'Private booking contract'
export const CONTRACT_WITH_WAIVER_TITLE = 'Private booking contract and self-catering agreement'
export const WAIVER_TITLE = 'Self-catering and outside food agreement'

/**
 * Create the signing request for a contract that has just been generated. The link is not
 * emailed here: the caller puts it in the contract email, so the customer gets one message.
 */
export async function createBookingContractSigningRequest(input: {
  booking: BookingForSigning
  contractVersion: number
  pdf: Buffer
  includesWaiver: boolean
  userId: string
  userName: string
}): Promise<{ documentId: string; partyId: string; signingUrl: string }> {
  const party = bookingSignerParty(input.booking)
  if (!party.name) throw new SigningError('party_name_missing', 'Add the customer\'s name before sending the contract.')
  if (!party.email) throw new SigningError('no_email', 'Add a contact email address before sending the contract.')

  const result = await createSigningRequest({
    kind: 'private_booking_contract',
    subjectId: input.booking.id,
    title: input.includesWaiver ? CONTRACT_WITH_WAIVER_TITLE : CONTRACT_TITLE,
    summary: input.includesWaiver
      ? `The contract and terms for ${eventLabel(input.booking)}. Its last page is the self-catering and outside food agreement, which your signature also covers.`
      : `The contract and terms for ${eventLabel(input.booking)}.`,
    pdf: input.pdf,
    parties: [party],
    createdBy: input.userId,
    createdByName: input.userName,
    context: { contract_version: input.contractVersion, includes_waiver: input.includesWaiver },
    sendLinkEmails: false,
  })
  const delivery = result.deliveries[0]
  if (!delivery?.signingUrl) {
    throw new Error('The signing link was not created')
  }
  return { documentId: result.documentId, partyId: delivery.partyId, signingUrl: delivery.signingUrl }
}

/**
 * The waiver sheets on their own, cut from the contract as it stands now. Rendering the whole
 * contract and keeping its last sheets means the waiver someone signs alone is, to the letter,
 * the one printed at the back of their contract.
 */
export async function buildWaiverOnlyPdf(bookingId: string): Promise<{ pdf: Buffer; booking: BookingForSigning }> {
  const { html, booking } = await renderContractPreview(bookingId)
  if (!bookingRequiresWaiverAnnex(booking)) {
    throw new SigningError('no_waiver', 'This booking has no self-catering or outside food, so there is no waiver to sign.')
  }
  const waiverSheets = (html.match(/<section class="sheet" data-doc="waiver">/g) ?? []).length
  if (waiverSheets === 0) {
    throw new Error('The contract did not include the waiver sheet')
  }

  const full = await PDFDocument.load(await generatePDFFromHTML(html, CONTRACT_PDF_OPTIONS))
  const total = full.getPageCount()
  if (total <= waiverSheets) {
    throw new Error('The contract has fewer pages than expected, so the waiver could not be separated')
  }
  const waiver = await PDFDocument.create()
  const pages = await waiver.copyPages(
    full,
    Array.from({ length: waiverSheets }, (_, index) => total - waiverSheets + index)
  )
  for (const page of pages) waiver.addPage(page)
  return { pdf: Buffer.from(await waiver.save()), booking: booking as BookingForSigning }
}
