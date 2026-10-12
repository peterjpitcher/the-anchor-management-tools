'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { bookingRequiresWaiverAnnex } from '@/lib/contract-template'
import { getErrorMessage } from '@/lib/errors'
import { WAIVER_TITLE, bookingSignerParty, buildWaiverOnlyPdf } from '@/lib/signing/documents/booking-contract'
import {
  SigningError,
  createSigningRequest,
  listSigningDocumentsForSubject,
  type PartyDelivery,
  type SigningDocumentSummary,
} from '@/lib/signing/service'
import { canSendSigningKind, canViewSigningKind, getSigningStaffUser } from '@/lib/signing/staff'
import { createAdminClient } from '@/lib/supabase/admin'

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()

function failure(error: unknown): { error: string } {
  if (error instanceof SigningError) return { error: error.message }
  console.error('Booking signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

export interface BookingSigningState {
  documents: SigningDocumentSummary[]
  /** True when the booking has self-catering or outside food, so a waiver applies. */
  waiverRequired: boolean
  waiverStatus: string | null
  hasEmail: boolean
  canSend: boolean
}

/** What the booking page's signing panel needs: the documents, and whether a waiver is owed. */
export async function getBookingSigningState(bookingId: string): Promise<ActionResult<BookingSigningState>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind('private_booking_contract', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: booking, error } = await admin
      .from('private_bookings')
      .select('id, contact_email, waiver_status, items:private_booking_items(item_type, package:catering_packages(id, name, requires_waiver))')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the booking: ${error.message}`)
    if (!booking) return { error: 'Booking not found.' }

    return {
      success: true,
      data: {
        documents: await listSigningDocumentsForSubject('private_booking', bookingId),
        // Only the fields the check reads are selected, which is less than the full item type.
        waiverRequired: bookingRequiresWaiverAnnex(booking as unknown as Parameters<typeof bookingRequiresWaiverAnnex>[0]),
        waiverStatus: (booking.waiver_status as string | null) ?? null,
        hasEmail: Boolean(booking.contact_email),
        canSend: await canSendSigningKind('private_booking_waiver', user.id),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Send the self-catering waiver on its own, for a booking whose contract was already accepted
 * another way (by paying the deposit). A contract sent for signature carries the waiver with it,
 * so this is not needed alongside one.
 */
export async function sendBookingWaiver(bookingId: string): Promise<ActionResult<{ documentId: string; deliveries: PartyDelivery[] }>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canSendSigningKind('private_booking_waiver', user.id))) return { error: 'Insufficient permissions' }

    const { pdf, booking } = await buildWaiverOnlyPdf(bookingId)
    if (booking.waiver_status === 'signed') return { error: 'The waiver for this booking is already signed.' }
    const party = bookingSignerParty(booking)
    if (!party.name) return { error: 'Add the customer\'s name to the booking first.' }

    const result = await createSigningRequest({
      kind: 'private_booking_waiver',
      subjectId: bookingId,
      title: WAIVER_TITLE,
      summary: 'This covers food you bring or arrange yourself for your event. Please read it before you sign.',
      pdf,
      parties: [party],
      createdBy: user.id,
      createdByName: user.name,
    })

    // Sending it counts as issuing it, as generating the contract does.
    const admin = createAdminClient()
    await admin
      .from('private_bookings')
      .update({ waiver_status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('waiver_status', 'required')

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'send',
      resource_type: 'signing_document',
      resource_id: result.documentId,
      operation_status: 'success',
      additional_info: { kind: 'private_booking_waiver', booking_id: bookingId, version: result.version },
    })
    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, data: { documentId: result.documentId, deliveries: result.deliveries } }
  } catch (error) {
    return failure(error)
  }
}
