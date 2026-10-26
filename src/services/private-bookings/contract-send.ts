import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'

/**
 * Send a private booking's contract for signature (SOP §11: the contract must be provided before
 * the deposit is paid, and the send must be recorded). Shared by Email Contract on the booking page
 * and by Confirm deposit, which sends the contract in the same action (owner decision D25, review
 * BK-006).
 *
 * Generates a fresh version, stores the PDF snapshot, creates the signing requests through the
 * shared signing feature (src/lib/signing: the contract, and separately the self-catering and
 * outside food agreement where the booking has outside food), emails the customer one message
 * with both links, and stamps contract_sent_at and contract_sent_to.
 *
 * Throws with a message staff can act on when it cannot be sent; if the email fails, the signing
 * requests are withdrawn so nothing sits there looking live. The caller checks permissions.
 *
 * The heavy modules (the contract template, the PDF renderer) are loaded only when a contract is
 * actually sent.
 */
export interface SentContract {
  version: number
  foodAgreementIncluded: boolean
  sentTo: string
  signingDocumentId: string
  foodAgreementSigningDocumentId: string | null
}

export async function sendPrivateBookingContractForSignature(input: {
  bookingId: string
  userId: string
  /** The sender's email, used for the signature line only when no staff name is known. */
  userEmail?: string | null
  /** What started the send, for the audit trail: 'email_contract' or 'confirm_deposit'. */
  via?: string
}): Promise<SentContract> {
  const { bookingId, userId } = input
  const { generateContractDocument, markWaiverSent, storeContractSnapshot } = await import('@/lib/private-bookings/contract-lifecycle')
  const { sendContractEmailToCustomer } = await import('@/lib/email/private-booking-emails')
  const { createBookingContractSigningRequests, prepareBookingContract } = await import('@/lib/signing/documents/booking-contract')
  const { recordSigningLinkSent, voidSigningDocument } = await import('@/lib/signing/service')
  const { getSigningStaffUser } = await import('@/lib/signing/staff')

  const { signingHtml, version, booking } = await generateContractDocument(bookingId, { performedBy: userId })

  const sentTo = booking.contact_email?.trim()
  if (!sentTo) {
    throw new Error('This booking has no contact email address. Add one before sending the contract.')
  }

  // Signatures go through src/lib/signing (CLAUDE.md, Domain rules). The contract is rendered
  // once, with a signature slot where each signature goes, and divided into the documents to
  // sign: the contract, and separately the self-catering and outside food agreement where the
  // booking has outside food. Whoever sends it signs for The Anchor as they send.
  const staff = await getSigningStaffUser()
  const sender = { name: staff?.name ?? input.userEmail ?? 'A member of staff', position: staff?.position ?? null }
  // A food agreement that is already signed is not sent for signature again.
  const prepared = await prepareBookingContract({
    signingHtml,
    booking,
    sender,
    waiverAlreadySigned: booking.waiver_status === 'signed',
  })

  const admin = createAdminClient()
  await storeContractSnapshot(admin, {
    bookingId,
    version,
    fileName: `contract-v${version}.pdf`,
    content: prepared.fullPdf,
    mimeType: 'application/pdf',
    generatedBy: userId,
    metadata: { sent_to: booking.contact_email, includes_food_agreement: Boolean(prepared.waiver) },
  })

  // If a signing request cannot be created the contract is not sent, so nobody receives a
  // contract they cannot sign.
  const signing = await createBookingContractSigningRequests({
    booking,
    contractVersion: version,
    prepared,
    userId,
    sender,
  })
  const requests = [signing.contract, ...(signing.waiver ? [signing.waiver] : [])]

  try {
    await sendContractEmailToCustomer(booking, {
      version,
      pdf: prepared.contract.pdf,
      signingUrl: signing.contract.signingUrl,
      waiver: prepared.waiver && signing.waiver
        ? { pdf: prepared.waiver.pdf, signingUrl: signing.waiver.signingUrl }
        : undefined,
    })
  } catch (emailError) {
    // Nobody has the links, so the requests must not sit there looking live.
    for (const request of requests) {
      try {
        await voidSigningDocument({ documentId: request.documentId, userId, reason: 'The contract email could not be sent' })
      } catch (voidError) {
        logger.error('Could not withdraw a signing request after a failed contract email', {
          error: voidError instanceof Error ? voidError : new Error(String(voidError)),
          metadata: { bookingId, documentId: request.documentId },
        })
      }
    }
    throw emailError
  }
  for (const request of requests) {
    await recordSigningLinkSent({
      documentId: request.documentId,
      partyId: request.partyId,
      to: sentTo,
      userId,
    })
  }

  // Only now has the food agreement gone to the customer, so only now does the booking say so.
  if (signing.waiver) {
    await markWaiverSent(admin, { bookingId, via: 'contract_sent', contractVersion: version, performedBy: userId })
  }

  const nowIso = new Date().toISOString()
  const { error: updateError } = await admin
    .from('private_bookings')
    .update({ contract_sent_at: nowIso, contract_sent_to: booking.contact_email, updated_at: nowIso })
    .eq('id', bookingId)
  if (updateError) {
    logger.error('Failed to record contract send', {
      error: new Error(updateError.message),
      metadata: { bookingId },
    })
  }

  await logAuditEvent({
    user_id: userId,
    operation_type: 'update',
    resource_type: 'private_booking',
    resource_id: bookingId,
    operation_status: 'success',
    additional_info: {
      action: 'contract_sent',
      via: input.via ?? 'email_contract',
      contract_version: version,
      sent_to: booking.contact_email,
      customer_notified: true,
      signing_document_id: signing.contract.documentId,
      food_agreement_signing_document_id: signing.waiver?.documentId ?? null,
    },
  })

  return {
    version,
    foodAgreementIncluded: Boolean(signing.waiver),
    sentTo,
    signingDocumentId: signing.contract.documentId,
    foodAgreementSigningDocumentId: signing.waiver?.documentId ?? null,
  }
}
