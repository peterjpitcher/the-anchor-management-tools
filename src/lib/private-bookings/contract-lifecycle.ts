import { createAdminClient } from '@/lib/supabase/admin'
import { generateContractHTML, bookingRequiresWaiverAnnex } from '@/lib/contract-template'
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
  name: 'Orange Jelly Limited trading as The Anchor Pub',
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
  version: number
  booking: any
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

  const html = generateContractHTML({
    booking,
    logoUrl: CONTRACT_LOGO_DATA_URI,
    contractVersion: version,
    companyDetails: CONTRACT_COMPANY_DETAILS,
  })

  await storeContractSnapshot(admin, {
    bookingId,
    version,
    fileName: `contract-v${version}.html`,
    content: Buffer.from(html, 'utf-8'),
    mimeType: 'text/html',
    generatedBy: options.performedBy ?? null,
  })

  // SOP §21: when the rendered contract carried the waiver annex and the
  // waiver was outstanding, generating the document counts as sending it —
  // stamp 'required' → 'sent' (non-blocking, audited).
  if (bookingRequiresWaiverAnnex(booking) && booking.waiver_status === 'required') {
    try {
      const { data: stampedRow, error: waiverError } = await admin
        .from('private_bookings')
        .update({ waiver_status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', bookingId)
        .eq('waiver_status', 'required')
        .select('id')
        .maybeSingle()
      if (waiverError) throw new Error(waiverError.message)

      if (stampedRow) {
        const { error: waiverAuditError } = await admin.from('private_booking_audit').insert({
          booking_id: bookingId,
          action: 'field_updated',
          field_name: 'waiver_status',
          old_value: 'required',
          new_value: 'sent',
          performed_by: options.performedBy ?? null,
          metadata: { via: 'contract_generated', contract_version: version },
        })
        if (waiverAuditError) throw new Error(waiverAuditError.message)
      }
    } catch (waiverStampError) {
      logger.error('Waiver sent stamp failed (non-blocking)', {
        error: waiverStampError instanceof Error ? waiverStampError : new Error(String(waiverStampError)),
        metadata: { bookingId, version },
      })
    }
  }

  return { html, version, booking }
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
  },
): Promise<void> {
  try {
    const storagePath = `${input.bookingId}/${input.fileName}`
    const { error: uploadError } = await admin.storage
      .from(CONTRACT_DOCUMENTS_BUCKET)
      .upload(storagePath, input.content, {
        contentType: input.mimeType,
        upsert: true,
      })
    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const { error: docError } = await admin.from('private_booking_documents').insert({
      booking_id: input.bookingId,
      document_type: 'contract',
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
    logger.error('Contract snapshot storage failed (non-blocking)', {
      error: snapshotError instanceof Error ? snapshotError : new Error(String(snapshotError)),
      metadata: { bookingId: input.bookingId, version: input.version, fileName: input.fileName },
    })
  }
}
