import { readBookingPaymentLedger } from '@/lib/private-bookings/payment-ledger'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateContractHTML } from '@/lib/contract-template'
import { CONTRACT_LOGO_DATA_URI } from '@/lib/private-bookings/contract-logo'
import { logger } from '@/lib/logger'

/**
 * Contract generation + snapshot storage (SOP pack §28 document generation):
 * every generated contract carries a version number, and the exact document
 * is stored — not just regenerated from live data.
 */

export const CONTRACT_DOCUMENTS_BUCKET = 'private-booking-documents'

// §30 business details — single source shared by the on-demand route and the
// send-contract action.
export const CONTRACT_COMPANY_DETAILS = {
  // The venue is "The Anchor", never "The Anchor Pub" (website SSOT §14). The contract named the
  // trader one way and every email named it the other (review PB-22). The legal entity is
  // unchanged: only the trading name is corrected.
  name: 'Orange Jelly Limited trading as The Anchor',
  registrationNumber: '10537179',
  vatNumber: 'GB 315 2036 47',
  address: 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ',
  phone: '01753 682707',
  email: 'manager@the-anchor.pub',
  privacyNoticeUrl: 'https://www.the-anchor.pub/privacy-policy',
} as const

const BOOKING_CONTRACT_SELECT = `
  *,
  customer:customers(*),
  items:private_booking_items(
    *,
    space:venue_spaces(*),
    package:catering_packages(*),
    vendor:vendors(*)
  ),
  payments:private_booking_payments(*)
`

export type GeneratedContract = {
  html: string
  /**
   * The same contract with signature slots where the signature lines are, for signing online
   * (src/lib/signing/signature-slots.ts). The printed contract (`html`) is unchanged.
   */
  signingHtml: string
  version: number
  booking: any
}

/**
 * Render the contract for viewing, with no side effects at all.
 *
 * Issuing a contract is a deliberate act: it mints a version, writes an audit
 * row, stores an immutable snapshot and can stamp the waiver as sent. Opening
 * the Contract tab is not that act, but it used to run the whole of
 * generateContractDocument, so simply looking at a booking inflated its
 * version. Nine bookings had reached 39 generation events and version 22 that
 * way, which makes the version number meaningless as a record of what the
 * customer was actually sent.
 */
export async function renderContractPreview(bookingId: string): Promise<GeneratedContract> {
  const admin = createAdminClient()

  const { data: booking, error } = await admin
    .from('private_bookings')
    .select(BOOKING_CONTRACT_SELECT)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    throw new Error('Booking not found')
  }

  const ledger = await readBookingPaymentLedger(bookingId)
  booking.payments = ledger.payments
  booking.applied_deposit_amount = ledger.appliedDepositAmount

  const version = Number((booking as { contract_version?: number | null }).contract_version ?? 0)

  const contract = {
    booking,
    logoUrl: CONTRACT_LOGO_DATA_URI,
    contractVersion: version,
    companyDetails: CONTRACT_COMPANY_DETAILS,
  }

  return {
    html: generateContractHTML(contract),
    signingHtml: generateContractHTML({ ...contract, signingSlots: true }),
    version,
    booking,
  }
}

/**
 * Load the booking, mint a new contract version (atomic RPC), audit the
 * generation, render the HTML and store an immutable snapshot in the
 * private-booking-documents bucket + private_booking_documents table.
 *
 * Snapshot storage failure is logged loudly but does not block generation —
 * the version + audit trail still exist and the document can be regenerated.
 */
export async function generateContractDocument(
  bookingId: string,
  options: { performedBy?: string | null; ipAddress?: string | null } = {},
): Promise<GeneratedContract> {
  const admin = createAdminClient()

  const { data: booking, error } = await admin
    .from('private_bookings')
    .select(BOOKING_CONTRACT_SELECT)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    throw new Error('Booking not found')
  }

  const ledger = await readBookingPaymentLedger(bookingId)
  booking.payments = ledger.payments
  booking.applied_deposit_amount = ledger.appliedDepositAmount

  const { data: incrementedVersion, error: versionError } = await admin.rpc(
    'increment_private_booking_contract_version',
    { p_booking_id: bookingId },
  )
  if (versionError || typeof incrementedVersion !== 'number') {
    throw new Error(versionError?.message || 'Failed to record contract version')
  }
  const version = incrementedVersion

  const { error: auditError } = await admin.from('private_booking_audit').insert({
    booking_id: bookingId,
    action: 'contract_generated',
    performed_by: options.performedBy ?? null,
    metadata: {
      contract_version: version,
      ...(options.ipAddress ? { ip_address: options.ipAddress } : {}),
    },
  })
  if (auditError) {
    logger.error('Contract audit log failed (non-blocking)', {
      error: new Error(auditError.message),
      metadata: { bookingId, version },
    })
  }

  const contract = {
    booking,
    logoUrl: CONTRACT_LOGO_DATA_URI,
    contractVersion: version,
    companyDetails: CONTRACT_COMPANY_DETAILS,
  }
  const html = generateContractHTML(contract)
  const signingHtml = generateContractHTML({ ...contract, signingSlots: true })

  await storeContractSnapshot(admin, {
    bookingId,
    version,
    fileName: `contract-v${version}.html`,
    content: Buffer.from(html, 'utf-8'),
    mimeType: 'text/html',
    generatedBy: options.performedBy ?? null,
  })

  return { html, signingHtml, version, booking }
}

/**
 * SOP §21: record that the self-catering and outside food agreement has gone to the customer.
 * Called once the email carrying it has been accepted for delivery, never before: a booking must
 * not say the agreement was sent when nothing went out (a failed contract email used to leave
 * it saying exactly that). Moves 'required' to 'sent', and 'not_required' too, for a booking
 * whose "Outside food" tick predates the tick counting (13 October 2026). Never touches 'sent',
 * 'overdue' or 'signed'. Audited. A failure is logged and does not undo the send.
 */
export async function markWaiverSent(
  admin: ReturnType<typeof createAdminClient>,
  input: { bookingId: string; via: 'contract_sent' | 'food_agreement_sent'; contractVersion?: number | null; performedBy?: string | null }
): Promise<void> {
  try {
    const { data: before, error: readError } = await admin
      .from('private_bookings')
      .select('waiver_status')
      .eq('id', input.bookingId)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    const statusBefore = (before?.waiver_status as string | null) ?? 'not_required'
    if (!['required', 'not_required'].includes(statusBefore)) return

    const { data: stampedRow, error: waiverError } = await admin
      .from('private_bookings')
      .update({ waiver_status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', input.bookingId)
      .in('waiver_status', ['required', 'not_required'])
      .select('id')
      .maybeSingle()
    if (waiverError) throw new Error(waiverError.message)
    if (!stampedRow) return

    const { error: waiverAuditError } = await admin.from('private_booking_audit').insert({
      booking_id: input.bookingId,
      action: 'field_updated',
      field_name: 'waiver_status',
      old_value: statusBefore,
      new_value: 'sent',
      performed_by: input.performedBy ?? null,
      metadata: { via: input.via, contract_version: input.contractVersion ?? null },
    })
    if (waiverAuditError) throw new Error(waiverAuditError.message)
  } catch (waiverStampError) {
    logger.error('Waiver sent stamp failed (non-blocking)', {
      error: waiverStampError instanceof Error ? waiverStampError : new Error(String(waiverStampError)),
      metadata: { bookingId: input.bookingId, via: input.via },
    })
  }
}

export async function storeContractSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    version: number
    fileName: string
    content: Buffer
    mimeType: string
    generatedBy?: string | null
    metadata?: Record<string, unknown>
    /**
     * Defaults to 'contract'. Private booking invoices reuse this so the
     * exact document that reached the customer can be reproduced later: VAT
     * records must be kept six years and regenerating from live data would
     * produce a different document after any edit.
     */
    documentType?: 'contract' | 'invoice' | 'receipt' | 'correspondence' | 'other'
    /** Receipt snapshots must be immutable and storage failure must prevent success. */
    strict?: boolean
  },
): Promise<void> {
  try {
    const storagePath = `${input.bookingId}/${input.fileName}`
    const { error: uploadError } = await admin.storage
      .from(CONTRACT_DOCUMENTS_BUCKET)
      .upload(storagePath, input.content, {
        contentType: input.mimeType,
        upsert: !input.strict,
      })
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { error: docError } = await admin.from('private_booking_documents').insert({
      booking_id: input.bookingId,
      document_type: input.documentType ?? 'contract',
      file_name: input.fileName,
      storage_path: storagePath,
      mime_type: input.mimeType,
      file_size_bytes: input.content.byteLength,
      version: input.version,
      generated_by: input.generatedBy ?? null,
      metadata: input.metadata ?? {},
    })
    if (docError) {
      throw new Error(docError.message)
    }
  } catch (snapshotError) {
    if (input.strict) throw snapshotError
    logger.error('Booking document snapshot storage failed (non-blocking)', {
      error: snapshotError instanceof Error ? snapshotError : new Error(String(snapshotError)),
      metadata: { bookingId: input.bookingId, version: input.version, fileName: input.fileName },
    })
  }
}
