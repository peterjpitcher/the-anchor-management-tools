'use server'

import { invoiceBalanceDue } from '@/lib/invoices/balance'
import type { InvoiceEmailDraft } from '@/lib/invoices/email-copy'
import { buildDefaultChaseEmailDraft, buildDefaultInvoiceEmailDraft } from '@/lib/invoices/email-drafts'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { sendInvoiceEmail, sendQuoteEmail, testEmailConnection, isGraphConfigured } from '@/lib/microsoft-graph'
import { getInvoice } from './invoices'
import { getQuote } from './quotes'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseRecipientList, resolveManualInvoiceRecipients } from '@/lib/invoice-recipients'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

// Email validation schema
const SendInvoiceEmailSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  recipientEmail: z.string().min(3, 'Recipient required'),
  subject: z.string().optional(),
  body: z.string().optional()
})

const SendQuoteEmailSchema = z.object({
  quoteId: z.string().uuid('Invalid quote ID'),
  recipientEmail: z.string().min(3, 'Recipient required'),
  subject: z.string().optional(),
  body: z.string().optional()
})

async function markLinkedOjRowsBilled(
  admin: ReturnType<typeof createAdminClient>,
  invoiceId: string,
  warnings: string[]
) {
  const nowIso = new Date().toISOString()
  const { error: entriesError } = await admin
    .from('oj_entries')
    .update({
      status: 'billed',
      billed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('invoice_id', invoiceId)
    .eq('status', 'billing_pending')

  if (entriesError) {
    console.error('Error finalizing linked OJ entries after invoice send:', entriesError)
    warnings.push('Email sent but linked OJ entries were not finalized')
  }

  const { error: recurringError } = await admin
    .from('oj_recurring_charge_instances')
    .update({
      status: 'billed',
      billed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('invoice_id', invoiceId)
    .eq('status', 'billing_pending')

  if (recurringError) {
    console.error('Error finalizing linked OJ recurring charges after invoice send:', recurringError)
    warnings.push('Email sent but linked OJ recurring charges were not finalized')
  }
}

function splitRawRecipients(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function validateRecipientInput(raw: string): { recipients: string[] } | { error: string } {
  const rawRecipients = splitRawRecipients(raw)
  const recipients = parseRecipientList(raw)

  if (rawRecipients.length === 0 || recipients.length === 0) {
    return { error: 'At least one valid email address is required' }
  }

  if (rawRecipients.length !== recipients.length) {
    return { error: 'One or more email addresses are invalid' }
  }

  return { recipients }
}

const EMAIL_DISPATCH_IDEMP_TTL_HOURS = 1

function toUtcMidnightMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`)
}

function buildEmailDispatchIdempotency(
  kind: 'invoice_send' | 'invoice_chase' | 'quote_send',
  targetId: string,
  toAddress: string,
  ccAddresses: string[],
  subject: string,
  body: string
) {
  const normalizedTo = toAddress.trim().toLowerCase()
  const normalizedCc = ccAddresses.map((email) => email.trim().toLowerCase()).sort()
  const normalizedSubject = subject.trim()
  const normalizedBody = body.trim()
  const requestHash = computeIdempotencyRequestHash({
    kind,
    target_id: targetId,
    to: normalizedTo,
    cc: normalizedCc,
    subject: normalizedSubject,
    body: normalizedBody
  })

  return {
    key: `action:${kind}:${targetId}:${requestHash.slice(0, 16)}`,
    requestHash
  }
}

/**
 * What the send and chase dialogs cannot work out in the browser: who to greet, and which
 * booking a private hire invoice is for.
 */
export interface InvoiceEmailDraftContext {
  /** A person's first name, or null for "Hi there". Never a company name. */
  greetingName: string | null
  /** The event date of the private booking this invoice belongs to, or null. */
  bookingEventDate: string | null
  /** True when the invoice belongs to a private booking, whether or not its date is known. */
  isPrivateHire: boolean
}

const NO_DRAFT_CONTEXT: InvoiceEmailDraftContext = { greetingName: null, bookingEventDate: null, isPrivateHire: false }

/**
 * The event date of the private booking an invoice belongs to, or null for any other
 * invoice. `private_booking_invoices` holds one row per booking invoice, original or
 * additional. Never throws: a chase that cannot name the booking is still worth sending.
 */
async function loadInvoiceBooking(
  admin: ReturnType<typeof createAdminClient>,
  invoiceId: string
): Promise<{ isPrivateHire: boolean; eventDate: string | null }> {
  const none = { isPrivateHire: false, eventDate: null }
  try {
    const { data: link, error: linkError } = await admin
      .from('private_booking_invoices')
      .select('booking_id')
      .eq('invoice_id', invoiceId)
      .maybeSingle()
    if (linkError || !link?.booking_id) return none

    const { data: booking, error: bookingError } = await admin
      .from('private_bookings')
      .select('event_date')
      .eq('id', link.booking_id)
      .maybeSingle()
    // The link alone says it is private hire, even if the booking's date cannot be read.
    if (bookingError) return { isPrivateHire: true, eventDate: null }

    return { isPrivateHire: true, eventDate: booking?.event_date ? String(booking.event_date) : null }
  } catch {
    return none
  }
}

/**
 * The subject and body to send: the dialog's own text where it gave any, otherwise the
 * shared default wording.
 *
 * The dialogs send what the operator saw, so the default is built only when the subject or
 * the body arrives blank. Working it out here, rather than leaving it to `sendInvoiceEmail`,
 * means the text saved in the email log is the text that went, not a placeholder.
 */
async function resolveEmailText(
  given: { subject?: string; body?: string },
  buildDefault: () => Promise<InvoiceEmailDraft>
): Promise<InvoiceEmailDraft> {
  if (given.subject && given.body) return { subject: given.subject, body: given.body }
  const fallback = await buildDefault()
  return { subject: given.subject || fallback.subject, body: given.body || fallback.body }
}

async function loadInvoiceEmailDraftContext(
  admin: ReturnType<typeof createAdminClient>,
  invoiceId: string,
  vendorId: string | null | undefined
): Promise<InvoiceEmailDraftContext> {
  const [greetingName, booking] = await Promise.all([
    resolveInvoiceGreetingName(admin, vendorId),
    loadInvoiceBooking(admin, invoiceId),
  ])
  return { greetingName, bookingEventDate: booking.eventDate, isPrivateHire: booking.isPrivateHire }
}

/**
 * The greeting and booking date for an invoice's email dialogs, resolved on the server.
 *
 * The dialogs build their draft in the browser, but the contacts and guest records the
 * greeting comes from are readable by super admins only under row level security, so the
 * lookup runs here on the admin client, behind the invoice view permission. It returns a
 * first name and a date and nothing else. Any failure gives the neutral answer ("Hi there",
 * no booking named) rather than an error: a greeting is not worth failing a page over.
 */
export async function getInvoiceEmailDraftContext(invoiceId: string): Promise<InvoiceEmailDraftContext> {
  try {
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) return NO_DRAFT_CONTEXT

    if (!z.string().uuid().safeParse(invoiceId).success) return NO_DRAFT_CONTEXT

    const admin = createAdminClient()
    const { data: invoice, error } = await admin
      .from('invoices')
      .select('vendor_id')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error || !invoice) return NO_DRAFT_CONTEXT

    return await loadInvoiceEmailDraftContext(admin, invoiceId, invoice.vendor_id)
  } catch (error) {
    console.error('Error in getInvoiceEmailDraftContext:', error)
    return NO_DRAFT_CONTEXT
  }
}

// Get email logs for an invoice
export async function getInvoiceEmailLogs(invoiceId: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view email logs' }
    }

    // Use admin client to bypass restrictive RLS on logs table if necessary,
    // or standard client if policy allows. Given the investigation findings,
    // we should use admin client for reading logs but ensure we validate access first.
    const supabase = createAdminClient()

    // Owner alerts from the reminder job were logged here with a subject in square brackets
    // ("[First Reminder] Invoice ..."). They are not emails to the customer, so they are left
    // out: otherwise the chase dialog warns "recent reminder sent" on the very day the alert
    // tells the owner to chase.
    const { data: logs, error } = await supabase
      .from('invoice_email_logs')
      .select('*')
      .eq('invoice_id', invoiceId)
      .not('subject', 'like', '[%')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching email logs:', error)
      return { error: 'Failed to fetch email logs' }
    }

    return { logs }
  } catch (error) {
    console.error('Error in getInvoiceEmailLogs:', error)
    return { error: 'An unexpected error occurred' }
  }
}

// Send invoice via email
export async function sendInvoiceViaEmail(formData: FormData) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to send invoices' }
    }

    // Check if email is configured
    if (!isGraphConfigured()) {
      return { error: 'Email service is not configured. Please contact your administrator.' }
    }

    // Validate input
    const validatedData = SendInvoiceEmailSchema.parse({
      invoiceId: formData.get('invoiceId'),
      recipientEmail: formData.get('recipientEmail'),
      subject: formData.get('subject') || undefined,
      body: formData.get('body') || undefined
    })

    // Get invoice details
    const invoiceResult = await getInvoice(validatedData.invoiceId)
    if (invoiceResult.error || !invoiceResult.invoice) {
      return { error: 'Invoice not found' }
    }

    const invoice = invoiceResult.invoice

    const recipientValidation = validateRecipientInput(String(validatedData.recipientEmail))
    if ('error' in recipientValidation) {
      return { error: recipientValidation.error }
    }

    const recipientResolution = await resolveManualInvoiceRecipients(
      supabase as any,
      invoice.vendor_id,
      validatedData.recipientEmail
    )

    if ('error' in recipientResolution) {
      return { error: recipientResolution.error }
    }

    if (!recipientResolution.to) {
      return { error: 'At least one valid email address is required' }
    }

    const toAddress = recipientResolution.to
    const ccAddresses = recipientResolution.cc

    const { subject, body } = await resolveEmailText(validatedData, async () => {
      const context = await loadInvoiceEmailDraftContext(admin, invoice.id, invoice.vendor_id)
      return buildDefaultInvoiceEmailDraft(
        invoice,
        context.greetingName,
        context.isPrivateHire ? { eventDate: context.bookingEventDate } : null
      )
    })
    const senderId = (await supabase.auth.getUser()).data.user?.id || null

    const idempotencyContext = buildEmailDispatchIdempotency(
      'invoice_send',
      validatedData.invoiceId,
      toAddress,
      ccAddresses,
      subject,
      body
    )

    const idempotencyClaim = await claimIdempotencyKey(
      admin,
      idempotencyContext.key,
      idempotencyContext.requestHash,
      EMAIL_DISPATCH_IDEMP_TTL_HOURS
    )

    if (idempotencyClaim.state === 'conflict') {
      return { error: 'A conflicting email dispatch already exists for this invoice' }
    }

    if (idempotencyClaim.state === 'in_progress' || idempotencyClaim.state === 'replay') {
      return { success: true, deduplicated: true }
    }

    let claimHeld = true
    let emailSent = false
    const warnings: string[] = []

    try {
      const result = await sendInvoiceEmail(
        invoice,
        toAddress,
        subject,
        body,
        ccAddresses,
        undefined,
        { emailKind: 'invoice' }
      )
      if (!result.success) {
        await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
        claimHeld = false
        // A timeout after the request left: the customer may already have the email. Say so,
        // or staff will press send again and they will get it twice.
        return {
          error: result.uncertain
            ? 'The email may have been sent: the connection dropped before an answer came back. Check Sent Items before sending it again.'
            : result.error || 'Failed to send email',
        }
      }
      emailSent = true
      // The email went but the app could not save its record of it. It is NOT sent again;
      // staff are told so the gap in the invoice's email history is not a surprise.
      if (result.recorded === false) {
        warnings.push('Email sent, but it could not be saved to the invoice history')
      }

      const logRows = [
        {
          invoice_id: validatedData.invoiceId,
          sent_to: toAddress,
          sent_by: senderId,
          subject,
          body,
          status: 'sent' as const
        },
        ...ccAddresses.map((cc) => ({
          invoice_id: validatedData.invoiceId,
          sent_to: cc,
          sent_by: senderId,
          subject,
          body,
          status: 'sent' as const
        }))
      ]

      const { error: emailLogError } = await admin.from('invoice_email_logs').insert(logRows)
      if (emailLogError) {
        console.error('Error writing invoice email logs:', emailLogError)
        warnings.push('Email sent but delivery log persistence failed')
      }

      // Authoritative delivery record. status is a legacy mirror and cannot
      // carry delivery for an invoice that is already partially_paid or paid,
      // so every eligibility check reads sent_at instead.
      const { error: deliveryStampError } = await admin
        .from('invoices')
        .update({ sent_at: new Date().toISOString(), sent_to: toAddress })
        .eq('id', validatedData.invoiceId)
        .is('sent_at', null)
      if (deliveryStampError) {
        console.error('Error stamping invoice delivery:', deliveryStampError)
        warnings.push('Email sent but the delivery timestamp was not recorded')
      }

      // Update invoice status if it was draft
      if (invoice.status === 'draft') {
        const { data: statusUpdate, error: updateError } = await admin
          .from('invoices')
          .update({ 
            status: 'sent' as const,
            updated_at: new Date().toISOString()
          })
          .eq('id', validatedData.invoiceId)
          .eq('status', 'draft')
          .is('deleted_at', null)
          .select('id')
          .maybeSingle()

        if (updateError) {
          console.error('Error updating invoice status:', updateError)
          warnings.push('Email sent but invoice status update failed')
        } else if (!statusUpdate) {
          warnings.push('Email sent but invoice status changed before update finalized')
        } else {
          await markLinkedOjRowsBilled(admin, validatedData.invoiceId, warnings)
        }
      }

      try {
        await logAuditEvent({
          operation_type: 'update',
          resource_type: 'invoice',
          resource_id: validatedData.invoiceId,
          operation_status: 'success',
          additional_info: { 
            action: 'email_sent',
            recipient: recipientValidation.recipients.join(', '),
            invoice_number: invoice.invoice_number
          }
        })
      } catch (auditError) {
        console.error('Error writing invoice email audit event:', auditError)
        warnings.push('Email sent but audit logging failed')
      }

      await persistIdempotencyResponse(
        admin,
        idempotencyContext.key,
        idempotencyContext.requestHash,
        {
          state: 'processed',
          invoice_id: validatedData.invoiceId,
          message_id: result.messageId,
          warnings
        },
        EMAIL_DISPATCH_IDEMP_TTL_HOURS
      )
      claimHeld = false

      if (warnings.length > 0) {
        return { success: true, messageId: result.messageId, warnings }
      }
      return { success: true, messageId: result.messageId }
    } catch (sendError) {
      if (claimHeld) {
        if (emailSent) {
          try {
            await persistIdempotencyResponse(
              admin,
              idempotencyContext.key,
              idempotencyContext.requestHash,
              {
                state: 'processed_with_error',
                invoice_id: validatedData.invoiceId,
                error: sendError instanceof Error ? sendError.message : String(sendError)
              },
              EMAIL_DISPATCH_IDEMP_TTL_HOURS
            )
            claimHeld = false
          } catch (persistError) {
            console.error('Failed to persist invoice email idempotency state after partial success:', persistError)
            claimHeld = false
          }
        } else {
          try {
            await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
          } catch (releaseError) {
            console.error('Failed to release invoice email idempotency claim:', releaseError)
          }
          claimHeld = false
        }
      }

      throw sendError
    }
  } catch (error) {
    console.error('Error in sendInvoiceViaEmail:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Send chase payment email for overdue invoice
export async function sendChasePaymentEmail(formData: FormData) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to send payment reminders' }
    }

    // Check if email is configured
    if (!isGraphConfigured()) {
      return { error: 'Email service is not configured. Please contact your administrator.' }
    }

    // Validate input
    const validatedData = SendInvoiceEmailSchema.parse({
      invoiceId: formData.get('invoiceId'),
      recipientEmail: formData.get('recipientEmail'),
      subject: formData.get('subject') || undefined,
      body: formData.get('body') || undefined
    })

    // Get invoice details
    const invoiceResult = await getInvoice(validatedData.invoiceId)
    if (invoiceResult.error || !invoiceResult.invoice) {
      return { error: 'Invoice not found' }
    }

    const invoice = invoiceResult.invoice
    const invoiceStatus = String(invoice.status || '').toLowerCase()
    
    // Calculate days overdue
    const dueDateIso = String(invoice.due_date || '').slice(0, 10)
    const todayIso = getTodayIsoDate()
    const dueDateUtcMs = toUtcMidnightMs(dueDateIso)
    const todayUtcMs = toUtcMidnightMs(todayIso)

    if (!dueDateIso || Number.isNaN(dueDateUtcMs)) {
      return { error: 'Invoice due date is invalid' }
    }

    const daysOverdue = Math.floor((todayUtcMs - dueDateUtcMs) / (1000 * 60 * 60 * 24))
    
    // Ensure invoice is actually overdue
    if (daysOverdue <= 0) {
      return { error: 'Invoice is not yet overdue' }
    }
    
    // Calculate outstanding amount
    const outstandingAmount = invoiceBalanceDue(invoice)

    if (['paid', 'void', 'written_off'].includes(invoiceStatus)) {
      return { error: `Cannot send a chase email for an invoice with status "${invoice.status}"` }
    }

    if (!Number.isFinite(outstandingAmount) || outstandingAmount <= 0) {
      return { error: 'Cannot send a chase email when there is no outstanding balance' }
    }

    const recipientValidation = validateRecipientInput(String(validatedData.recipientEmail))
    if ('error' in recipientValidation) {
      return { error: recipientValidation.error }
    }

    const recipientResolution = await resolveManualInvoiceRecipients(
      supabase as any,
      invoice.vendor_id,
      validatedData.recipientEmail
    )

    if ('error' in recipientResolution) {
      return { error: recipientResolution.error }
    }

    if (!recipientResolution.to) {
      return { error: 'At least one valid email address is required' }
    }

    const toAddress = recipientResolution.to
    const ccAddresses = recipientResolution.cc
    const senderId = (await supabase.auth.getUser()).data.user?.id || null
    // For a private hire invoice the default chase names the booking at The Anchor, so the
    // customer can place an email from a company they have never dealt with.
    const { subject: finalSubject, body: finalBody } = await resolveEmailText(validatedData, async () => {
      const context = await loadInvoiceEmailDraftContext(admin, invoice.id, invoice.vendor_id)
      return buildDefaultChaseEmailDraft(invoice, {
        firstName: context.greetingName,
        todayIso,
        bookingEventDate: context.bookingEventDate,
      })
    })

    const idempotencyContext = buildEmailDispatchIdempotency(
      'invoice_chase',
      validatedData.invoiceId,
      toAddress,
      ccAddresses,
      finalSubject,
      finalBody
    )

    const idempotencyClaim = await claimIdempotencyKey(
      admin,
      idempotencyContext.key,
      idempotencyContext.requestHash,
      EMAIL_DISPATCH_IDEMP_TTL_HOURS
    )

    if (idempotencyClaim.state === 'conflict') {
      return { error: 'A conflicting chase email dispatch already exists for this invoice' }
    }

    if (idempotencyClaim.state === 'in_progress' || idempotencyClaim.state === 'replay') {
      return { success: true, deduplicated: true, daysOverdue }
    }

    let claimHeld = true
    let emailSent = false
    const warnings: string[] = []

    try {
      // Labelled as a chase so the invoice history and the reminder job can tell a chase
      // sent by hand from the invoice itself.
      const result = await sendInvoiceEmail(
        invoice,
        toAddress,
        finalSubject,
        finalBody,
        ccAddresses,
        undefined,
        { emailKind: 'chase' }
      )
      if (!result.success) {
        await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
        claimHeld = false
        // A timeout after the request left: the customer may already have the email. Say so,
        // or staff will press send again and they will get it twice.
        return {
          error: result.uncertain
            ? 'The email may have been sent: the connection dropped before an answer came back. Check Sent Items before sending it again.'
            : result.error || 'Failed to send email',
        }
      }
      emailSent = true
      // The email went but the app could not save its record of it. It is NOT sent again;
      // staff are told so the gap in the invoice's email history is not a surprise.
      if (result.recorded === false) {
        warnings.push('Email sent, but it could not be saved to the invoice history')
      }

      // No `email_type` here: invoice_email_logs has no such column, and the field made this
      // insert fail every time, so no manual chase was ever logged and the "recent reminder"
      // warning could not see one. The subject line is what identifies a chase.
      const logRows = [
        {
          invoice_id: validatedData.invoiceId,
          sent_to: toAddress,
          sent_by: senderId,
          subject: finalSubject,
          body: finalBody,
          status: 'sent' as const
        },
        ...ccAddresses.map((cc) => ({
          invoice_id: validatedData.invoiceId,
          sent_to: cc,
          sent_by: senderId,
          subject: finalSubject,
          body: finalBody,
          status: 'sent' as const
        }))
      ]

      const { error: chaseLogError } = await admin
        .from('invoice_email_logs')
        .insert(logRows)
      if (chaseLogError) {
        console.error('Error writing chase invoice email logs:', chaseLogError)
        warnings.push('Chase email sent but delivery log persistence failed')
      }

      try {
        await logAuditEvent({
          operation_type: 'update',
          resource_type: 'invoice',
          resource_id: validatedData.invoiceId,
          operation_status: 'success',
          additional_info: { 
            action: 'chase_email_sent',
            recipient: validatedData.recipientEmail,
            invoice_number: invoice.invoice_number,
            days_overdue: daysOverdue
          }
        })
      } catch (auditError) {
        console.error('Error writing chase invoice email audit event:', auditError)
        warnings.push('Chase email sent but audit logging failed')
      }

      await persistIdempotencyResponse(
        admin,
        idempotencyContext.key,
        idempotencyContext.requestHash,
        {
          state: 'processed',
          invoice_id: validatedData.invoiceId,
          message_id: result.messageId,
          days_overdue: daysOverdue,
          warnings
        },
        EMAIL_DISPATCH_IDEMP_TTL_HOURS
      )
      claimHeld = false

      if (warnings.length > 0) {
        return { success: true, messageId: result.messageId, daysOverdue, warnings }
      }
      return { success: true, messageId: result.messageId, daysOverdue }
    } catch (sendError) {
      if (claimHeld) {
        if (emailSent) {
          try {
            await persistIdempotencyResponse(
              admin,
              idempotencyContext.key,
              idempotencyContext.requestHash,
              {
                state: 'processed_with_error',
                invoice_id: validatedData.invoiceId,
                error: sendError instanceof Error ? sendError.message : String(sendError)
              },
              EMAIL_DISPATCH_IDEMP_TTL_HOURS
            )
            claimHeld = false
          } catch (persistError) {
            console.error('Failed to persist chase email idempotency state after partial success:', persistError)
            claimHeld = false
          }
        } else {
          try {
            await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
          } catch (releaseError) {
            console.error('Failed to release chase email idempotency claim:', releaseError)
          }
          claimHeld = false
        }
      }

      throw sendError
    }
  } catch (error) {
    console.error('Error in sendChasePaymentEmail:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Send quote via email
export async function sendQuoteViaEmail(formData: FormData) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'edit')
    if (!hasPermission) {
      return { error: 'You do not have permission to send quotes' }
    }

    // Check if email is configured
    if (!isGraphConfigured()) {
      return { error: 'Email service is not configured. Please contact your administrator.' }
    }

    // Validate input
    const validatedData = SendQuoteEmailSchema.parse({
      quoteId: formData.get('quoteId'),
      recipientEmail: formData.get('recipientEmail'),
      subject: formData.get('subject') || undefined,
      body: formData.get('body') || undefined
    })

    // Get quote details
    const quoteResult = await getQuote(validatedData.quoteId)
    if (quoteResult.error || !quoteResult.quote) {
      return { error: 'Quote not found' }
    }

    const quote = quoteResult.quote

    // Support multiple recipients and prefer Primary in To
    const recipientValidation = validateRecipientInput(String(validatedData.recipientEmail))
    if ('error' in recipientValidation) {
      return { error: recipientValidation.error }
    }

    const recipientResolution = await resolveManualInvoiceRecipients(
      supabase as any,
      quote.vendor_id,
      validatedData.recipientEmail
    )

    if ('error' in recipientResolution) {
      return { error: recipientResolution.error }
    }

    if (!recipientResolution.to) {
      return { error: 'At least one valid email address is required' }
    }

    const toAddress = recipientResolution.to
    const ccAddresses = recipientResolution.cc
    const subjectQ = validatedData.subject || `Quote ${quote.quote_number} from Orange Jelly Limited`
    const bodyQ = validatedData.body || 'Default quote email template used'
    const senderIdQ = (await supabase.auth.getUser()).data.user?.id || null

    const idempotencyContext = buildEmailDispatchIdempotency(
      'quote_send',
      validatedData.quoteId,
      toAddress,
      ccAddresses,
      subjectQ,
      bodyQ
    )

    const idempotencyClaim = await claimIdempotencyKey(
      admin,
      idempotencyContext.key,
      idempotencyContext.requestHash,
      EMAIL_DISPATCH_IDEMP_TTL_HOURS
    )

    if (idempotencyClaim.state === 'conflict') {
      return { error: 'A conflicting email dispatch already exists for this quote' }
    }

    if (idempotencyClaim.state === 'in_progress' || idempotencyClaim.state === 'replay') {
      return { success: true, deduplicated: true }
    }

    let claimHeld = true
    let emailSent = false
    const warnings: string[] = []

    try {
      const resultQ = await sendQuoteEmail(
        quote,
        toAddress,
        validatedData.subject,
        validatedData.body,
        ccAddresses
      )

      if (!resultQ.success) {
        await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
        claimHeld = false
        return { error: resultQ.error || 'Failed to send email' }
      }
      emailSent = true

      const logRows = [
        {
          quote_id: validatedData.quoteId,
          sent_to: toAddress,
          sent_by: senderIdQ,
          subject: subjectQ,
          body: bodyQ,
          status: 'sent' as const
        },
        ...ccAddresses.map((cc) => ({
          quote_id: validatedData.quoteId,
          sent_to: cc,
          sent_by: senderIdQ,
          subject: subjectQ,
          body: bodyQ,
          status: 'sent' as const
        }))
      ]

      const { error: quoteLogError } = await admin.from('invoice_email_logs').insert(logRows)
      if (quoteLogError) {
        console.error('Error writing quote email logs:', quoteLogError)
        warnings.push('Quote email sent but delivery log persistence failed')
      }

      // Update quote status if it was draft
      if (quote.status === 'draft') {
        const { data: quoteStatusUpdate, error: updateError } = await admin
          .from('quotes')
          .update({ 
            status: 'sent' as const,
            updated_at: new Date().toISOString()
          })
          .eq('id', validatedData.quoteId)
          .eq('status', 'draft')
          .select('id')
          .maybeSingle()

        if (updateError) {
          console.error('Error updating quote status:', updateError)
          warnings.push('Quote email sent but quote status update failed')
        } else if (!quoteStatusUpdate) {
          warnings.push('Quote email sent but quote status changed before update finalized')
        }
      }

      try {
        await logAuditEvent({
          operation_type: 'update',
          resource_type: 'quote',
          resource_id: validatedData.quoteId,
          operation_status: 'success',
          additional_info: { 
            action: 'email_sent',
            recipient: recipientValidation.recipients.join(', '),
            quote_number: quote.quote_number
          }
        })
      } catch (auditError) {
        console.error('Error writing quote email audit event:', auditError)
        warnings.push('Quote email sent but audit logging failed')
      }

      await persistIdempotencyResponse(
        admin,
        idempotencyContext.key,
        idempotencyContext.requestHash,
        {
          state: 'processed',
          quote_id: validatedData.quoteId,
          warnings
        },
        EMAIL_DISPATCH_IDEMP_TTL_HOURS
      )
      claimHeld = false

      if (warnings.length > 0) {
        return { success: true, warnings }
      }
      return { success: true }
    } catch (sendError) {
      if (claimHeld) {
        if (emailSent) {
          try {
            await persistIdempotencyResponse(
              admin,
              idempotencyContext.key,
              idempotencyContext.requestHash,
              {
                state: 'processed_with_error',
                quote_id: validatedData.quoteId,
                error: sendError instanceof Error ? sendError.message : String(sendError)
              },
              EMAIL_DISPATCH_IDEMP_TTL_HOURS
            )
            claimHeld = false
          } catch (persistError) {
            console.error('Failed to persist quote email idempotency state after partial success:', persistError)
            claimHeld = false
          }
        } else {
          try {
            await releaseIdempotencyClaim(admin, idempotencyContext.key, idempotencyContext.requestHash)
          } catch (releaseError) {
            console.error('Failed to release quote email idempotency claim:', releaseError)
          }
          claimHeld = false
        }
      }

      throw sendError
    }
  } catch (error) {
    console.error('Error in sendQuoteViaEmail:', error)
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
    }
    return { error: 'An unexpected error occurred' }
  }
}

// Test email configuration
async function testEmailConfiguration() {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to test email configuration' }
    }

    const result = await testEmailConnection()
    
    return result
  } catch (error) {
    console.error('Error testing email configuration:', error)
    return { 
      success: false, 
      message: 'Failed to test email configuration',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}

// Get email configuration status
export async function getEmailConfigStatus() {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('invoices', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view email configuration' }
    }

    return {
      configured: isGraphConfigured(),
      senderEmail: process.env.MICROSOFT_USER_EMAIL || 'Not configured'
    }
  } catch (error) {
    console.error('Error getting email config status:', error)
    return { error: 'Failed to get email configuration status' }
  }
}
