'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { getQuote } from '@/app/actions/quotes'
import { formatDateInLondon, isValidIsoDate } from '@/lib/dateUtils'
import { getErrorMessage } from '@/lib/errors'
import { buildQuoteSigningSource } from '@/lib/signing/documents/quote'
import { quoteContentFingerprint } from '@/lib/signing/documents/quote-fingerprint'
import { prepareSigningDocument } from '@/lib/signing/prepare'
import { sendTemplateSigningRequest } from '@/lib/signing/send-template'
import {
  SigningError,
  createSigningRequest,
  listSigningDocumentsForSeries,
  type CreateSigningRequestResult,
  type PartyDelivery,
  type SigningDocumentSummary,
} from '@/lib/signing/service'
import { canSendSigningKind, canViewSigningKind, getSigningStaffUser, type SigningStaffUser } from '@/lib/signing/staff'
import { SINGLE_TEMPLATE_SLUGS } from '@/lib/signing/template-fields'
import { TemplateMergeError } from '@/lib/signing/template-render'
import type { SigningKind } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Sending commercial documents for signature: quote acceptance and client agreements for
 * Orange Jelly's clients, and booking confirmations for The Anchor's suppliers.
 */

export interface SendResult {
  documentId: string
  deliveries: PartyDelivery[]
}
type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()
const SignerSchema = {
  signerName: z.string().trim().min(2, 'Enter the name of the person who will sign.').max(120),
  signerEmail: z.string().trim().email('Enter a valid email address.').max(254),
}

function failure(error: unknown): { error: string } {
  if (error instanceof SigningError) return { error: error.message }
  if (error instanceof TemplateMergeError) {
    return { error: `This document needs details that are missing: ${error.missingFields.join(', ')}.` }
  }
  console.error('Commercial signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

async function authorise(kind: SigningKind): Promise<{ error: string } | { user: SigningStaffUser }> {
  const user = await getSigningStaffUser()
  if (!user) return { error: 'Unauthorized' }
  if (!(await canSendSigningKind(kind, user.id))) return { error: 'Insufficient permissions' }
  return { user }
}

async function recordSend(
  user: SigningStaffUser,
  kind: SigningKind,
  info: Record<string, unknown>,
  result: CreateSigningRequestResult,
  paths: string[]
): Promise<SendResult> {
  await logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'send',
    resource_type: 'signing_document',
    resource_id: result.documentId,
    operation_status: 'success',
    additional_info: { kind, version: result.version, ...info },
  })
  for (const path of paths) revalidatePath(path)
  return { documentId: result.documentId, deliveries: result.deliveries }
}

function longDate(isoDate: string): string {
  return formatDateInLondon(isoDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

const QuoteSchema = z.object({ quoteId: UuidSchema, ...SignerSchema })

/**
 * Ask a client to accept a quote online. They are shown the quote exactly as its PDF prints it;
 * accepting marks the quote Accepted. Separate from emailing the quote, which stays as it is.
 */
export async function sendQuoteForAcceptance(input: {
  quoteId: string
  signerName: string
  signerEmail: string
}): Promise<ActionResult<SendResult>> {
  try {
    const parsed = QuoteSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const auth = await authorise('quote_acceptance')
    if ('error' in auth) return auth

    const quoteResult = await getQuote(parsed.data.quoteId)
    if (quoteResult.error || !quoteResult.quote) return { error: quoteResult.error ?? 'Quote not found.' }
    const quote = quoteResult.quote
    if (quote.status === 'accepted') return { error: 'This quote has already been accepted.' }
    if (quote.status === 'rejected') return { error: 'This quote was rejected. Create a new quote to send for acceptance.' }
    if (quote.status === 'expired') return { error: 'This quote has expired. Update its valid-until date before sending it for acceptance.' }

    // The quote as its PDF prints it, with a panel where the acceptance is shown once given.
    const parties = [{ role: 'client' as const, name: parsed.data.signerName, email: parsed.data.signerEmail }]
    const prepared = await prepareSigningDocument({
      source: buildQuoteSigningSource(quote),
      mode: 'sign',
      parties: parties.map((party) => ({ role: party.role, name: party.name })),
    })
    const result = await createSigningRequest({
      kind: 'quote_acceptance',
      subjectId: quote.id,
      title: `Quote ${quote.quote_number}`,
      summary: `Our quote ${quote.quote_number}, valid until ${longDate(quote.valid_until)}. Signing accepts the quote as it is set out.`,
      pdf: prepared.pdf,
      render: prepared.render,
      parties,
      createdBy: auth.user.id,
      createdByName: auth.user.name,
      context: {
        quote_number: quote.quote_number,
        vendor_id: quote.vendor_id ?? null,
        // What the client is shown. The completion hook will not accept a quote whose total has
        // moved, or whose lines, notes or dates have changed while the total stayed the same.
        total_amount: typeof quote.total_amount === 'number' ? quote.total_amount : null,
        quote_fingerprint: quoteContentFingerprint(quote),
      },
    })

    // Asking for acceptance is sending it. A draft becomes Sent, as it does when emailed.
    if (quote.status === 'draft') {
      const admin = createAdminClient()
      await admin
        .from('quotes')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', quote.id)
        .eq('status', 'draft')
    }

    return {
      success: true,
      data: await recordSend(auth.user, 'quote_acceptance', { quote_id: quote.id }, result, [`/quotes/${quote.id}`, '/quotes']),
    }
  } catch (error) {
    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Client agreements
// ---------------------------------------------------------------------------

const ClientAgreementSchema = z.object({
  vendorId: UuidSchema,
  ...SignerSchema,
  servicesSummary: z.string().trim().min(10, 'Describe the work.').max(6000),
  feesSummary: z.string().trim().min(5, 'Describe the fees.').max(4000),
  startDate: z.string().refine(isValidIsoDate, 'Choose a start date.'),
})

export async function sendClientAgreement(input: {
  vendorId: string
  signerName: string
  signerEmail: string
  servicesSummary: string
  feesSummary: string
  startDate: string
}): Promise<ActionResult<SendResult>> {
  try {
    const parsed = ClientAgreementSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const auth = await authorise('client_agreement')
    if ('error' in auth) return auth

    const admin = createAdminClient()
    const { data: vendor, error } = await admin.from('invoice_vendors').select('id, name').eq('id', parsed.data.vendorId).maybeSingle()
    if (error) throw new Error(`Could not read the client: ${error.message}`)
    if (!vendor) return { error: 'Client not found.' }

    const result = await sendTemplateSigningRequest({
      kind: 'client_agreement',
      slug: SINGLE_TEMPLATE_SLUGS.client_agreement,
      subjectId: vendor.id as string,
      mergeValues: {
        client_name: vendor.name as string,
        services_summary: parsed.data.servicesSummary,
        fees_summary: parsed.data.feesSummary,
        start_date: longDate(parsed.data.startDate),
      },
      parties: [{ role: 'client', name: parsed.data.signerName, email: parsed.data.signerEmail }],
      user: auth.user,
      summary: `The agreement between Orange Jelly Limited and ${vendor.name}: the work, the fees and the terms.`,
      subtitle: `Prepared for ${vendor.name}`,
    })
    return {
      success: true,
      data: await recordSend(auth.user, 'client_agreement', { vendor_id: vendor.id }, result, ['/oj-projects/clients']),
    }
  } catch (error) {
    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Supplier confirmations
// ---------------------------------------------------------------------------

function bookingSeriesKey(bookingId: string): string {
  return `booking:${bookingId}`
}

export interface BookingSupplier {
  vendorId: string
  name: string
  contactName: string | null
  contactEmail: string | null
  /** What they are down to provide, from the booking's items. */
  services: string[]
}

export interface BookingSupplierState {
  suppliers: BookingSupplier[]
  documents: SigningDocumentSummary[]
  /** "Saturday, 5 December 2026" (the app's usual long date), or null when the booking has no firm date. */
  eventDate: string | null
  canSend: boolean
}

/** The suppliers on a booking and the confirmations sent to them for it. */
export async function getBookingSupplierState(bookingId: string): Promise<ActionResult<BookingSupplierState>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind('supplier_confirmation', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: booking, error } = await admin
      .from('private_bookings')
      .select('id, event_date, date_tbd, items:private_booking_items(description, vendor:vendors(id, name, contact_name, contact_email))')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the booking: ${error.message}`)
    if (!booking) return { error: 'Booking not found.' }

    type VendorRow = { id: string; name: string; contact_name: string | null; contact_email: string | null }
    const suppliers = new Map<string, BookingSupplier>()
    for (const item of (booking.items ?? []) as Array<{ description: string | null; vendor: VendorRow | VendorRow[] | null }>) {
      const vendor = Array.isArray(item.vendor) ? item.vendor[0] : item.vendor
      if (!vendor) continue
      const entry = suppliers.get(vendor.id) ?? {
        vendorId: vendor.id,
        name: vendor.name,
        contactName: vendor.contact_name,
        contactEmail: vendor.contact_email,
        services: [],
      }
      if (item.description?.trim()) entry.services.push(item.description.trim())
      suppliers.set(vendor.id, entry)
    }

    return {
      success: true,
      data: {
        suppliers: [...suppliers.values()],
        documents: await listSigningDocumentsForSeries('vendor', bookingSeriesKey(bookingId)),
        eventDate: booking.date_tbd || !booking.event_date ? null : longDate(booking.event_date as string),
        canSend: await canSendSigningKind('supplier_confirmation', user.id),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

const SupplierSchema = z.object({
  bookingId: UuidSchema,
  vendorId: UuidSchema,
  ...SignerSchema,
  serviceSummary: z.string().trim().min(5, 'Describe what they are providing.').max(4000),
  eventDate: z.string().trim().min(4, 'Say when they are needed.').max(300),
  feeSummary: z.string().trim().min(2, 'Describe the fee.').max(2000),
})

/** Ask a supplier to confirm what they are providing for a booking, when, and for how much. */
export async function sendSupplierConfirmation(input: {
  bookingId: string
  vendorId: string
  signerName: string
  signerEmail: string
  serviceSummary: string
  eventDate: string
  feeSummary: string
}): Promise<ActionResult<SendResult>> {
  try {
    const parsed = SupplierSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const auth = await authorise('supplier_confirmation')
    if ('error' in auth) return auth

    const admin = createAdminClient()
    const { data: vendor, error } = await admin.from('vendors').select('id, name').eq('id', parsed.data.vendorId).maybeSingle()
    if (error) throw new Error(`Could not read the supplier: ${error.message}`)
    if (!vendor) return { error: 'Supplier not found.' }
    // The supplier must actually be on this booking: the confirmation is filed under both.
    const { data: onBooking, error: itemError } = await admin
      .from('private_booking_items')
      .select('id')
      .eq('booking_id', parsed.data.bookingId)
      .eq('vendor_id', parsed.data.vendorId)
      .limit(1)
    if (itemError) throw new Error(`Could not read the booking: ${itemError.message}`)
    if (!onBooking || onBooking.length === 0) return { error: 'That supplier is not on this booking.' }

    const result = await sendTemplateSigningRequest({
      kind: 'supplier_confirmation',
      slug: SINGLE_TEMPLATE_SLUGS.supplier_confirmation,
      subjectId: vendor.id as string,
      mergeValues: {
        supplier_name: vendor.name as string,
        service_summary: parsed.data.serviceSummary,
        event_date: parsed.data.eventDate,
        fee_summary: parsed.data.feeSummary,
      },
      parties: [{ role: 'supplier', name: parsed.data.signerName, email: parsed.data.signerEmail }],
      user: auth.user,
      summary: `Please confirm your booking with The Anchor: what you are providing, when, and the fee.`,
      subtitle: `Prepared for ${vendor.name}`,
      seriesKey: bookingSeriesKey(parsed.data.bookingId),
      context: { private_booking_id: parsed.data.bookingId },
    })
    return {
      success: true,
      data: await recordSend(
        auth.user,
        'supplier_confirmation',
        { vendor_id: vendor.id, booking_id: parsed.data.bookingId },
        result,
        [`/private-bookings/${parsed.data.bookingId}`]
      ),
    }
  } catch (error) {
    return failure(error)
  }
}
