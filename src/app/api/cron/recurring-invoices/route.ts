import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { InvoiceService } from '@/services/invoices'
import { addDaysIsoDate, calculateNextInvoiceIsoDate } from '@/lib/recurringInvoiceSchedule'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import type { InvoiceLineItemInput, InvoiceWithDetails, RecurringFrequency } from '@/types/invoices'
import { logAuditEvent } from '@/app/actions/audit'
import { reportCronFailure } from '@/lib/cron/alerting'
import { buildInvoiceSentUpdate } from '@/lib/invoices/delivery-state'
import { invoiceBalanceDue, invoiceIssuedCreditTotal } from '@/lib/invoices/balance'
import { buildInvoiceEmail, type InvoiceEmailDraft } from '@/lib/invoices/email-copy'
import { resolveInvoiceGreetingName } from '@/lib/invoices/greeting'
import { isWeekday } from '@/lib/invoices/reminder-rules'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute max

/**
 * Tells the owner that an invoice was raised but never reached the customer.
 *
 * Every exit below this point runs AFTER the schedule has moved on to its next date, so
 * nothing will ever try this invoice again. It used to be marked sent before the email was
 * attempted, which left an unsent invoice looking delivered. It now stays a draft, and this
 * alert is the only thing that gets it sent: it names the exact draft and says how.
 */
async function alertUnsentDraft(input: {
  reason: string
  invoiceId: string
  invoiceNumber: string
  vendorName?: string | null
  /**
   * True when the send has no definite answer (the request left, then the connection dropped):
   * the customer may already hold the invoice, so the owner must look before sending it again.
   */
  outcomeUnknown?: boolean
}): Promise<void> {
  await reportCronFailure(
    'recurring-invoices',
    new Error(
      input.outcomeUnknown
        ? `Invoice ${input.invoiceNumber} may or may not have been emailed: ${input.reason}`
        : `Invoice ${input.invoiceNumber} was raised but not emailed: ${input.reason}`
    ),
    {
      invoice: input.invoiceNumber,
      client: input.vendorName ?? 'Unknown',
      draft: `${getAppUrl()}/invoices/${input.invoiceId}`,
      what_to_do: input.outcomeUnknown
        ? 'Check Sent Items first. If the invoice is there, the customer has it: do not send it again. If it is not, open the draft and send it with the Email Invoice button. Do not re-run the schedule: it has already moved to its next date.'
        : 'Open the draft and send it with the Email Invoice button once the cause is fixed. Do not re-run the schedule: it has already moved to its next date.',
    }
  )
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    logger.info('[Cron] Starting recurring invoices processing')
    
    const supabase = createAdminClient()
    const emailConfigured = isGraphConfigured()
    const todayIso = getTodayIsoDate()

    // Invoices go out on a weekday morning, never at a weekend: the schedule in vercel.json is
    // Monday to Friday. If something calls this on a Saturday or Sunday anyway, do nothing. A
    // schedule that fell due at the weekend is not lost: the query below takes everything dated
    // today or earlier, so Monday's run raises it.
    if (!isWeekday(todayIso)) {
      logger.info('[Cron] Recurring invoices skipped: not a weekday', {
        metadata: { today: todayIso }
      })
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Not a weekday in Europe/London'
      })
    }

    // Get all active recurring invoices due for processing
    const { data: dueRecurringInvoices, error: fetchError } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          email,
          contact_name,
          payment_terms
        ),
        line_items:recurring_invoice_line_items(
          catalog_item_id,
          description,
          quantity,
          unit_price,
          discount_percentage,
          vat_rate
        )
      `)
      .eq('is_active', true)
      .lte('next_invoice_date', todayIso)
      .order('next_invoice_date', { ascending: true })

    if (fetchError) {
      console.error('[Cron] Error fetching recurring invoices:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch recurring invoices'
      }, { status: 500 })
    }

    logger.info('[Cron] Found recurring invoices to process', {
      metadata: { count: dueRecurringInvoices?.length || 0 }
    })

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      sent: 0,
      skipped_send_not_configured: 0,
      skipped_send_no_recipient: 0,
      send_failed: 0,
      errors: [] as Array<{
      recurring_invoice_id: string
      vendor?: string
      error: string
    }>
    }

    // Process each recurring invoice
    for (const recurringInvoice of dueRecurringInvoices || []) {
      results.processed++
      const scheduledInvoiceDate = recurringInvoice.next_invoice_date
      const claimKey = `cron:recurring-invoice:${recurringInvoice.id}:${scheduledInvoiceDate}`
      const claimHash = computeIdempotencyRequestHash({
        recurring_invoice_id: recurringInvoice.id,
        scheduled_invoice_date: scheduledInvoiceDate
      })
      let claimHeld = false
      let createdInvoiceId: string | null = null
      let createdInvoiceNumber: string | null = null
      
      try {
        console.warn(`[Cron] Processing recurring invoice ${recurringInvoice.id}`)
        
        // Check if end date has passed. Compared with the date the invoice was DUE to be raised,
        // not with today: the job no longer runs at weekends, so a last invoice scheduled for a
        // Saturday that is also the end date is raised on the Monday. Measured against today it
        // would look past its end and be dropped without ever being raised.
        if (recurringInvoice.end_date && recurringInvoice.end_date < scheduledInvoiceDate) {
          console.warn(`[Cron] Recurring invoice ${recurringInvoice.id} has passed end date, deactivating`)
          
          const { data: deactivatedRecurringInvoice, error: deactivateError } = await supabase
            .from('recurring_invoices')
            .update({ 
              is_active: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', recurringInvoice.id)
            .select('id')
            .maybeSingle()

          if (deactivateError) {
            throw deactivateError
          }

          if (!deactivatedRecurringInvoice) {
            throw new Error(`Recurring invoice ${recurringInvoice.id} not found while deactivating`)
          }
          
          continue
        }

        const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 90)
        if (claim.state === 'conflict') {
          results.failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: 'Recurring invoice idempotency conflict'
          })
          continue
        }

        if (claim.state === 'in_progress' || claim.state === 'replay') {
          console.warn(
            `[Cron] Recurring invoice ${recurringInvoice.id} for ${scheduledInvoiceDate} already processing/processed; skipping duplicate`
          )
          continue
        }

        claimHeld = claim.state === 'claimed'

        // Generate the invoice. It is dated the London day it is raised, and its due date counts
        // from that day: a schedule dated a Saturday is raised on the Monday, and dating it the
        // Saturday would hand the customer an invoice already two days into its payment terms.
        const invoiceDateIso = todayIso
        const vendorPaymentTerms = typeof recurringInvoice.vendor?.payment_terms === 'number'
          ? recurringInvoice.vendor.payment_terms
          : null
        const effectivePaymentTerms = Number(vendorPaymentTerms ?? recurringInvoice.days_before_due ?? 0) || 0
        const dueDateIso = addDaysIsoDate(invoiceDateIso, effectivePaymentTerms)

        const lineItems: InvoiceLineItemInput[] = (recurringInvoice.line_items ?? []).map((item: any) => ({
          catalog_item_id: item.catalog_item_id,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_percentage: Number(item.discount_percentage) || 0,
          vat_rate: Number(item.vat_rate) || 0
        }))

        const newInvoice = await InvoiceService.createInvoiceAsAdmin({
          vendor_id: recurringInvoice.vendor_id,
          invoice_date: invoiceDateIso,
          due_date: dueDateIso,
          reference: recurringInvoice.reference,
          invoice_discount_percentage: Number(recurringInvoice.invoice_discount_percentage) || 0,
          notes: recurringInvoice.notes,
          internal_notes: recurringInvoice.internal_notes,
          line_items: lineItems
        })
        createdInvoiceId = newInvoice.id
        createdInvoiceNumber = newInvoice.invoice_number

        // The schedule moves on from its OWN date, not from the day the invoice was raised, so a
        // monthly schedule stays on its day of the month however many weekends it lands on.
        const nextInvoiceDateIso = calculateNextInvoiceIsoDate(
          scheduledInvoiceDate,
          recurringInvoice.frequency as RecurringFrequency
        )

        const { data: recurringUpdatedRow, error: recurringUpdateError } = await supabase
          .from('recurring_invoices')
          .update({
            next_invoice_date: nextInvoiceDateIso,
            last_invoice_id: newInvoice.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', recurringInvoice.id)
          .select('id')
          .maybeSingle()

        if (recurringUpdateError) {
          throw new Error(recurringUpdateError.message || 'Failed to update recurring invoice schedule')
        }
        if (!recurringUpdatedRow) {
          throw new Error('Recurring invoice not found while updating schedule')
        }

        console.warn(`[Cron] Successfully generated invoice ${newInvoice.invoice_number}`)

        await logAuditEvent({
          operation_type: 'create',
          resource_type: 'invoice',
          resource_id: newInvoice.id,
          operation_status: 'success',
          additional_info: {
            source: 'recurring_invoice_cron',
            recurring_invoice_id: recurringInvoice.id,
            invoice_number: newInvoice.invoice_number,
            vendor: recurringInvoice.vendor?.name || null,
          }
        })

        if (!emailConfigured) {
          results.skipped_send_not_configured++
          results.successful++
          await alertUnsentDraft({
            reason: 'email is not configured',
            invoiceId: newInvoice.id,
            invoiceNumber: newInvoice.invoice_number,
            vendorName: recurringInvoice.vendor?.name,
          })
          if (claimHeld) {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed',
                recurring_invoice_id: recurringInvoice.id,
                invoice_id: newInvoice.id,
                invoice_number: newInvoice.invoice_number,
                sent: false,
                reason: 'email_not_configured'
              },
              24 * 90
            )
            claimHeld = false
          }
          continue
        }

        const recipientResult = await resolveVendorInvoiceRecipients(
          supabase,
          recurringInvoice.vendor_id,
          recurringInvoice.vendor?.email ? String(recurringInvoice.vendor.email) : null
        )

        if ('error' in recipientResult) {
          results.send_failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: recipientResult.error || 'Failed to resolve invoice recipients'
          })
          results.successful++
          await alertUnsentDraft({
            reason: 'the client\'s email address could not be looked up',
            invoiceId: newInvoice.id,
            invoiceNumber: newInvoice.invoice_number,
            vendorName: recurringInvoice.vendor?.name,
          })
          if (claimHeld) {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed',
                recurring_invoice_id: recurringInvoice.id,
                invoice_id: newInvoice.id,
                invoice_number: newInvoice.invoice_number,
                sent: false,
                reason: 'recipient_resolution_failed'
              },
              24 * 90
            )
            claimHeld = false
          }
          continue
        }

        if (!recipientResult.to) {
          results.skipped_send_no_recipient++
          results.successful++
          await alertUnsentDraft({
            reason: 'the client has no email address on file',
            invoiceId: newInvoice.id,
            invoiceNumber: newInvoice.invoice_number,
            vendorName: recurringInvoice.vendor?.name,
          })
          if (claimHeld) {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed',
                recurring_invoice_id: recurringInvoice.id,
                invoice_id: newInvoice.id,
                invoice_number: newInvoice.invoice_number,
                sent: false,
                reason: 'no_recipient'
              },
              24 * 90
            )
            claimHeld = false
          }
          continue
        }

        const { data: fullInvoice, error: invoiceFetchError } = await supabase
          .from('invoices')
          .select(`
            *,
            vendor:invoice_vendors(*),
            line_items:invoice_line_items(*),
            payments:invoice_payments(*)
          `)
          .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
          .eq('id', newInvoice.id)
          .single()

        if (invoiceFetchError || !fullInvoice) {
          results.send_failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: invoiceFetchError?.message || 'Failed to load invoice for email'
          })
          results.successful++
          await alertUnsentDraft({
            reason: 'the invoice could not be loaded for emailing',
            invoiceId: newInvoice.id,
            invoiceNumber: newInvoice.invoice_number,
            vendorName: recurringInvoice.vendor?.name,
          })
          if (claimHeld) {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed',
                recurring_invoice_id: recurringInvoice.id,
                invoice_id: newInvoice.id,
                invoice_number: newInvoice.invoice_number,
                sent: false,
                reason: 'invoice_reload_failed'
              },
              24 * 90
            )
            claimHeld = false
          }
          continue
        }

        // The shared wording (src/lib/invoices/email-copy.ts): a person's first name or "Hi there",
        // never the company name, with what is owed and when. Built inside its own try because the
        // balance helpers throw on an unreadable amount, and a throw here would land in the catch
        // at the bottom, which raises no alert. A wording fault takes the failed-email exit
        // instead: the draft is kept and the owner is told which one to send by hand.
        let emailDraft: InvoiceEmailDraft | null = null
        try {
          emailDraft = buildInvoiceEmail({
            firstName: await resolveInvoiceGreetingName(supabase, recurringInvoice.vendor_id),
            invoiceNumber: fullInvoice.invoice_number,
            reference: fullInvoice.reference,
            dueDate: fullInvoice.due_date,
            total: Number(fullInvoice.total_amount) || 0,
            paid: Number(fullInvoice.paid_amount) || 0,
            credits: invoiceIssuedCreditTotal(fullInvoice),
            balance: invoiceBalanceDue(fullInvoice),
          })
        } catch (wordingError) {
          console.error(
            `[Cron] Could not build the email for invoice ${fullInvoice.invoice_number}:`,
            wordingError
          )
        }
        const subject = emailDraft?.subject ?? `Invoice ${fullInvoice.invoice_number} from Orange Jelly`
        const body = emailDraft?.body ?? ''

        // The invoice is NOT marked sent here. It is marked sent only once the email has been
        // accepted (below), the order the OJ Projects billing run uses. Marking it first left an
        // invoice whose email failed looking delivered, with no sent_at, so it was never retried
        // and never chased.
        const emailResult: { success: boolean; error?: string; uncertain?: boolean } = emailDraft
          ? await sendInvoiceEmail(
              fullInvoice as InvoiceWithDetails,
              recipientResult.to,
              subject,
              body,
              recipientResult.cc,
              undefined,
              { emailKind: 'invoice' }
            )
          : { success: false, error: 'the email wording could not be built from the invoice figures' }

        if (!emailResult.success) {
          results.send_failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: emailResult.error || 'Unknown error sending invoice email'
          })

          const { error: failedEmailLogError } = await supabase
            .from('invoice_email_logs')
            .insert({
              invoice_id: fullInvoice.id,
              sent_to: recipientResult.to,
              sent_by: null,
              subject,
              body,
              status: 'failed'
            })
          if (failedEmailLogError) {
            console.error(
              `[Cron] Failed to write failed email log for recurring invoice ${recurringInvoice.id}:`,
              failedEmailLogError
            )
          }

          results.successful++
          await alertUnsentDraft({
            reason: emailResult.error || 'the email could not be sent',
            invoiceId: fullInvoice.id,
            invoiceNumber: fullInvoice.invoice_number,
            vendorName: recurringInvoice.vendor?.name,
            outcomeUnknown: emailResult.uncertain === true,
          })
          if (claimHeld) {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed',
                recurring_invoice_id: recurringInvoice.id,
                invoice_id: fullInvoice.id,
                invoice_number: fullInvoice.invoice_number,
                sent: false,
                reason: 'email_send_failed'
              },
              24 * 90
            )
            claimHeld = false
          }
          continue
        }

        // The email has gone. Record it: sent_at is what the reminder job reads to decide an
        // invoice was ever delivered, and its absence is why recurring invoices were never chased.
        // From here nothing may throw into the catch below: that would release the claim and
        // report a failure for an email the customer already has.
        const { data: sentInvoiceRow, error: sentInvoiceError } = await supabase
          .from('invoices')
          .update(buildInvoiceSentUpdate(recipientResult.to))
          .eq('id', fullInvoice.id)
          .eq('status', 'draft')
          .select('id')
          .maybeSingle()

        if (sentInvoiceError || !sentInvoiceRow) {
          console.error(
            `[Cron] Invoice ${fullInvoice.invoice_number} was emailed but could not be marked sent:`,
            sentInvoiceError ?? 'no draft row matched'
          )
          await reportCronFailure(
            'recurring-invoices',
            new Error(`Invoice ${fullInvoice.invoice_number} was emailed but could not be marked sent`),
            {
              invoice: fullInvoice.invoice_number,
              client: recurringInvoice.vendor?.name ?? 'Unknown',
              link: `${getAppUrl()}/invoices/${fullInvoice.id}`,
              what_to_do:
                'The customer HAS this invoice. Do not email it again. Open it and use Mark as Sent.',
            }
          )
        }

        const { error: sentEmailLogError } = await supabase
          .from('invoice_email_logs')
          .insert([
            {
              invoice_id: fullInvoice.id,
              sent_to: recipientResult.to,
              sent_by: null,
              subject,
              body,
              status: 'sent'
            },
            ...recipientResult.cc.map((cc) => ({
              invoice_id: fullInvoice.id,
              sent_to: cc,
              sent_by: null,
              subject,
              body,
              status: 'sent'
            }))
          ])
        if (sentEmailLogError) {
          console.error(
            `[Cron] Failed to write sent email logs for recurring invoice ${recurringInvoice.id}:`,
            sentEmailLogError
          )
        }

        await logAuditEvent({
          operation_type: 'auto_send',
          resource_type: 'invoice',
          resource_id: fullInvoice.id,
          operation_status: 'success',
          additional_info: {
            invoice_number: fullInvoice.invoice_number,
            recipient: recipientResult.to,
            cc: recipientResult.cc,
            automated: true,
            source: 'recurring_invoice_cron',
            recurring_invoice_id: recurringInvoice.id,
          }
        })

        results.sent++
        results.successful++
        if (claimHeld) {
          await persistIdempotencyResponse(
            supabase,
            claimKey,
            claimHash,
            {
              state: 'processed',
              recurring_invoice_id: recurringInvoice.id,
              invoice_id: fullInvoice.id,
              invoice_number: fullInvoice.invoice_number,
              sent: true,
              recipient_to: recipientResult.to,
              recipient_cc: recipientResult.cc
            },
            24 * 90
          )
          claimHeld = false
        }

      } catch (error) {
        // Always release the idempotency claim on failure so the next cron run
        // can retry. Previously, partial successes (invoice created but schedule
        // not advanced) would seal the claim as processed_with_error, wedging the
        // schedule permanently. Releasing allows the next run to retry both the
        // invoice creation (which will get a new idempotency key for the same
        // next_invoice_date since the schedule wasn't advanced) and the schedule
        // advancement.
        if (claimHeld) {
          try {
            await releaseIdempotencyClaim(supabase, claimKey, claimHash)
          } catch (releaseError) {
            console.error(
              `[Cron] Failed releasing recurring invoice idempotency claim ${recurringInvoice.id}:`,
              releaseError
            )
          } finally {
            claimHeld = false
          }
        }

        console.error(`[Cron] Error processing recurring invoice ${recurringInvoice.id}:`, error)
        results.failed++
        results.errors.push({
          recurring_invoice_id: recurringInvoice.id,
          vendor: recurringInvoice.vendor?.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    logger.info('[Cron] Recurring invoices processing completed', {
      metadata: { results }
    })

    // A schedule that could not raise its invoice at all used to end as a line in the JSON
    // nobody reads. Its claim is released, so the next run tries again, but say so.
    if (results.failed > 0) {
      await reportCronFailure(
        'recurring-invoices',
        new Error(`${results.failed} recurring invoice schedule(s) could not be processed and will be tried again on the next run`),
        { schedules: results.errors.map((entry) => entry.recurring_invoice_id).join(', ') }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Recurring invoices processed',
      results
    })

  } catch (error) {
    console.error('[Cron] Fatal error in recurring invoices cron:', error)
    await reportCronFailure('recurring-invoices', error)
    return NextResponse.json({
      error: 'Failed to process recurring invoices'
    }, { status: 500 })
  }
}
