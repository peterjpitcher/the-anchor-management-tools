'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { getErrorMessage } from '@/lib/errors'
import { formatCurrency } from '@/lib/format'
import { bookingSignerParty, eventLabel, type BookingForSigning } from '@/lib/signing/documents/booking-contract'
import { sendTemplateSigningRequest } from '@/lib/signing/send-template'
import { SigningError, listSigningDocumentsForSubject, type PartyDelivery } from '@/lib/signing/service'
import { canSendSigningKind, canViewSigningKind, getSigningStaffUser } from '@/lib/signing/staff'
import { SINGLE_TEMPLATE_SLUGS } from '@/lib/signing/template-fields'
import { TemplateMergeError } from '@/lib/signing/template-render'
import { SIGNING_OPEN_STATUSES, type SigningDocumentStatus } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The customer's agreement to a deposit deduction on a private booking (SOP section 25), by
 * signature. Staff send a proposed deduction to the customer, who signs to agree or declines with
 * a reason. The General Manager still decides: a signature approves nothing and moves no money.
 */

const KIND = 'deposit_deduction_agreement' as const

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()
const SendSchema = z.object({ deductionId: z.string().uuid('Unknown deduction.') })

function failure(error: unknown): { error: string } {
  if (error instanceof SigningError) return { error: error.message }
  if (error instanceof TemplateMergeError) {
    return { error: `This document needs details that are missing: ${error.missingFields.join(', ')}.` }
  }
  console.error('Deduction signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

/** One series per deduction, so two deductions on a booking are two documents. */
function deductionSeriesKey(deductionId: string): string {
  return `deduction:${deductionId}`
}

/** Whole pence, or null when the value is not a real amount. Sums are done in pence. */
function toPence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

type DepositBooking = BookingForSigning & {
  deposit_amount?: number | string | null
  deposit_paid_date?: string | null
  invoice_id?: string | null
  invoice_deposit_treatment?: string | null
}

/**
 * The deposit the customer paid and that is still held whole, in pence, or the reason it cannot
 * be stated. The rule is the app's own: a deposit counts as paid once the booking carries a paid
 * date, for the amount on the booking (as the refund action and the payment history read it).
 * Anything that would make "what comes back to you" a guess is refused instead of estimated.
 */
async function readDepositHeld(
  admin: ReturnType<typeof createAdminClient>,
  booking: DepositBooking
): Promise<{ pence: number } | { error: string }> {
  const paid = booking.deposit_paid_date ? toPence(booking.deposit_amount) : null
  if (paid === null || paid <= 0) {
    return { error: 'This booking has no deposit recorded as paid, so there is nothing to deduct from. Record the deposit on the booking first.' }
  }
  if (booking.invoice_id && booking.invoice_deposit_treatment === 'deducted') {
    return { error: 'The deposit on this booking was put towards the bill, so none of it is held to deduct from.' }
  }
  const { data: refunds, error } = await admin
    .from('payment_refunds')
    .select('id')
    .eq('source_type', 'private_booking')
    .eq('source_id', booking.id)
    .in('status', ['completed', 'pending'])
    .limit(1)
  if (error) throw new Error(`Could not read the deposit refunds: ${error.message}`)
  if (refunds && refunds.length > 0) {
    return { error: 'Some of this deposit has already been refunded, so what would come back to the customer cannot be stated. Talk the deduction through with them and record the discussion instead.' }
  }
  return { pence: paid }
}

export interface SendDeductionResult {
  documentId: string
  deliveries: PartyDelivery[]
}

/**
 * Send a proposed deduction to the customer to agree. Sending again replaces the earlier request
 * for the same deduction, and no other.
 */
export async function sendDeductionForAgreement(input: { deductionId: string }): Promise<ActionResult<SendDeductionResult>> {
  try {
    const parsed = SendSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canSendSigningKind(KIND, user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: deduction, error: deductionError } = await admin
      .from('private_booking_deductions')
      .select('id, booking_id, amount, reason, status')
      .eq('id', parsed.data.deductionId)
      .maybeSingle()
    if (deductionError) throw new Error(`Could not read the deduction: ${deductionError.message}`)
    if (!deduction) return { error: 'Deduction not found.' }
    if (deduction.status !== 'proposed' && deduction.status !== 'discussed') {
      return { error: 'This deduction has already been decided, so it cannot be sent to the customer.' }
    }

    const bookingId = deduction.booking_id as string
    const { data: booking, error: bookingError } = await admin
      .from('private_bookings')
      .select(
        'id, customer_id, customer_name, customer_first_name, customer_last_name, contact_email, contact_phone, event_date, event_type, date_tbd, deposit_amount, deposit_paid_date, invoice_id, invoice_deposit_treatment'
      )
      .eq('id', bookingId)
      .maybeSingle()
    if (bookingError) throw new Error(`Could not read the booking: ${bookingError.message}`)
    if (!booking) return { error: 'Booking not found.' }

    const party = bookingSignerParty(booking as DepositBooking)
    if (!party.name) return { error: "Add the customer's name to the booking first." }
    if (!party.email?.trim()) {
      return { error: 'This booking has no email address for the customer. Add one to the booking, then send the deduction again.' }
    }

    const deductionPence = toPence(deduction.amount)
    const reason = typeof deduction.reason === 'string' ? deduction.reason.trim() : ''
    if (deductionPence === null || deductionPence <= 0 || !reason) {
      return { error: 'This deduction has no amount or no reason, so it cannot be sent.' }
    }
    const deposit = await readDepositHeld(admin, booking as DepositBooking)
    if ('error' in deposit) return { error: deposit.error }
    if (deductionPence > deposit.pence) {
      return { error: `This deduction is more than the deposit paid (${formatCurrency(deposit.pence / 100)}), so it cannot be sent as it is.` }
    }
    const returnPence = deposit.pence - deductionPence

    // Each request states what comes back as if its deduction were the only one. Two out at once
    // would give the customer two sums that do not add up, so only one is out at a time.
    const others = await listSigningDocumentsForSubject('private_booking', bookingId)
    const anotherIsOut = others.some(
      (document) =>
        document.kind === KIND &&
        SIGNING_OPEN_STATUSES.includes(document.status) &&
        document.context.deduction_id !== deduction.id
    )
    if (anotherIsOut) {
      return {
        error:
          'Another deduction on this booking is already with the customer to agree, and the amounts coming back would not add up if both were out at once. Wait for that one to be signed, or withdraw it under Signatures, then send this one.',
      }
    }

    const label = eventLabel(booking as DepositBooking)
    const result = await sendTemplateSigningRequest({
      kind: KIND,
      slug: SINGLE_TEMPLATE_SLUGS[KIND],
      subjectId: bookingId,
      mergeValues: {
        customer_name: party.name,
        event_label: label,
        deduction_amount: formatCurrency(deductionPence / 100),
        deposit_amount: formatCurrency(deposit.pence / 100),
        deduction_reason: reason,
        amount_to_return: formatCurrency(returnPence / 100),
      },
      parties: [party],
      user,
      // Two deductions on one booking are told apart by their amounts.
      titleSuffix: formatCurrency(deductionPence / 100),
      summary: `We propose to keep ${formatCurrency(deductionPence / 100)} from your deposit for ${label}. Sign to agree, or decline and tell us why.`,
      subtitle: `Prepared for ${party.name}`,
      seriesKey: deductionSeriesKey(deduction.id as string),
      context: {
        deduction_id: deduction.id,
        deduction_amount: deductionPence / 100,
        deduction_reason: reason,
        deposit_amount: deposit.pence / 100,
        amount_to_return: returnPence / 100,
      },
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'send',
      resource_type: 'signing_document',
      resource_id: result.documentId,
      operation_status: 'success',
      additional_info: {
        kind: KIND,
        version: result.version,
        booking_id: bookingId,
        deduction_id: deduction.id,
        deduction_amount: deductionPence / 100,
      },
    })
    revalidatePath(`/private-bookings/${bookingId}`)
    return { success: true, data: { documentId: result.documentId, deliveries: result.deliveries } }
  } catch (error) {
    return failure(error)
  }
}

/** Where a deduction's latest request for agreement has got to. */
export interface DeductionAgreementState {
  deductionId: string
  documentId: string
  status: SigningDocumentStatus
  version: number
  sentAt: string
  /** When it was signed. */
  completedAt: string | null
  /** When it was withdrawn. */
  voidedAt: string | null
  expiresAt: string
  /** Why the customer declined, in their words. */
  declineReason: string | null
  /** Why the request was withdrawn. */
  withdrawnReason: string | null
}

export interface BookingDeductionAgreements {
  /** The latest request for each deduction that has one. */
  agreements: DeductionAgreementState[]
  canSend: boolean
}

/** The latest request for agreement on each of a booking's deductions. */
export async function getDeductionAgreements(bookingId: string): Promise<ActionResult<BookingDeductionAgreements>> {
  try {
    if (!UuidSchema.safeParse(bookingId).success) return { error: 'Unknown booking.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind(KIND, user.id))) return { error: 'Insufficient permissions' }

    const latest = new Map<string, DeductionAgreementState>()
    for (const document of await listSigningDocumentsForSubject('private_booking', bookingId)) {
      if (document.kind !== KIND) continue
      const deductionId = document.context.deduction_id
      if (typeof deductionId !== 'string') continue
      const known = latest.get(deductionId)
      if (known && known.version >= document.version) continue
      latest.set(deductionId, {
        deductionId,
        documentId: document.id,
        status: document.status,
        version: document.version,
        sentAt: document.sent_at,
        completedAt: document.completed_at,
        voidedAt: document.voided_at,
        expiresAt: document.expires_at,
        declineReason: document.parties.find((party) => party.status === 'declined')?.decline_reason ?? null,
        withdrawnReason: document.void_reason,
      })
    }

    return {
      success: true,
      data: { agreements: [...latest.values()], canSend: await canSendSigningKind(KIND, user.id) },
    }
  } catch (error) {
    return failure(error)
  }
}
