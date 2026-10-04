import { invoiceBalanceDue } from '@/lib/invoices/balance'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { reportCronFailure } from '@/lib/cron/alerting'
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

// AUTOMATIC CUSTOMER REMINDERS ARE PAUSED (owner decision, 4 October 2026).
//
// This job used to email the customer on each of the days below, in wording that read like a
// collections system ("Final Reminder", "to avoid any disruption to services"). Until the
// replacement schedule and wording are live it emails nobody but the owner: it still marks
// invoices overdue and still alerts him on the same days, and he chases by hand from the
// invoice page. Do not restore a customer send here. See
// tasks/spec-2026-10-04-invoice-issuing-and-chasing.md (R0.1, R2).
//
// Days on which the owner is alerted
const REMINDER_INTERVALS = {
  DUE_TODAY: 0,         // On the due date
  FIRST_REMINDER: 7,    // 7 days after due date
  SECOND_REMINDER: 14,  // 14 days after due date
  FINAL_REMINDER: 30    // 30 days after due date
}

function toUtcMidnightMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`)
}

function formatIsoDateForUk(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(dt.getTime())) {
    return isoDate
  }
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    logger.info('[Cron] Starting invoice reminders processing')
    
    const supabase = createAdminClient()
    const todayIso = getTodayIsoDate()
    const todayUtcMs = toUtcMidnightMs(todayIso)

    // Get all overdue and due today invoices
    const { data: overdueInvoices, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          email,
          contact_name,
          paypal_payments_enabled,
          contacts:invoice_vendor_contacts(
            email,
            is_primary
          )
        ),
        line_items:invoice_line_items(*),
        payments:invoice_payments(*),
        credits:credit_notes(status, amount_inc_vat)
      `)
      .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
      .in('status', ['sent', 'partially_paid', 'overdue'])
      // Never chase an invoice that was never actually delivered. status is a
      // legacy mirror; sent_at is the authoritative delivery record.
      .not('sent_at', 'is', null)
      .lte('due_date', todayIso)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })

    if (fetchError) {
      console.error('[Cron] Error fetching overdue invoices:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch overdue invoices',
        details: fetchError 
      }, { status: 500 })
    }

    logger.info('[Cron] Found invoices to process', {
      metadata: { count: overdueInvoices?.length || 0 }
    })

    const results = {
      processed: 0,
      // Always 0 while customer reminders are paused. Kept so the response shape is unchanged.
      reminders_sent: 0,
      internal_notifications: 0,
      errors: [] as Array<{
      invoice_number: string
      vendor?: string
      error: string
    }>
    }

    const internalEmail = process.env.MICROSOFT_USER_EMAIL || 'peter@orangejelly.co.uk'

    // Process each overdue invoice
    for (const invoice of overdueInvoices || []) {
      results.processed++
      let internalReminderSent = false
      let reminderSendFailed = false
      let reminderClaimHeld = false
      let reminderClaimKey: string | null = null
      let reminderClaimHash: string | null = null

      // Resolve vendor email: prefers vendor.email, then primary contact, then first contact
      const vendorEmail = invoice.vendor?.email || 
        (Array.isArray(invoice.vendor?.contacts) 
          ? (invoice.vendor.contacts.find((c: any) => c.is_primary)?.email || invoice.vendor.contacts[0]?.email)
          : null)

      try {
        const dueDateIso = String(invoice.due_date || '').slice(0, 10)
        const dueDateUtcMs = toUtcMidnightMs(dueDateIso)
        if (!dueDateIso || Number.isNaN(dueDateUtcMs)) {
          throw new Error('Invoice due date is invalid')
        }

        const daysOverdue = Math.floor((todayUtcMs - dueDateUtcMs) / (1000 * 60 * 60 * 24))
        
        logger.info('[Cron] Invoice reminder candidate', {
          metadata: { invoiceNumber: invoice.invoice_number, daysOverdue }
        })

        // Update status to overdue if not already and actually overdue
        if (daysOverdue > 0 && invoice.status !== 'overdue') {
          const { data: overdueUpdate, error: overdueUpdateError } = await supabase
            .from('invoices')
            .update({ 
              status: 'overdue',
              updated_at: new Date().toISOString()
            })
            .eq('id', invoice.id)
            .in('status', ['sent', 'partially_paid'])
            .select('id')
            .maybeSingle()

          if (overdueUpdateError) {
            throw overdueUpdateError
          }

          if (!overdueUpdate) {
            console.warn(
              `[Cron] Skipping overdue transition for invoice ${invoice.invoice_number}; state changed before update`
            )
          }
        }

        // Check if we should send a reminder based on intervals
        const shouldSendReminder = 
          daysOverdue === REMINDER_INTERVALS.DUE_TODAY ||
          daysOverdue === REMINDER_INTERVALS.FIRST_REMINDER ||
          daysOverdue === REMINDER_INTERVALS.SECOND_REMINDER ||
          daysOverdue === REMINDER_INTERVALS.FINAL_REMINDER

        if (!shouldSendReminder) {
          continue
        }

        // Determine reminder type
        let reminderType = 'First Reminder'
        if (daysOverdue === REMINDER_INTERVALS.DUE_TODAY) {
          reminderType = 'Due Today'
        } else if (daysOverdue === REMINDER_INTERVALS.SECOND_REMINDER) {
          reminderType = 'Second Reminder'
        } else if (daysOverdue === REMINDER_INTERVALS.FINAL_REMINDER) {
          reminderType = 'Final Reminder'
        }

        const reminderKeySuffix = reminderType.toLowerCase().replace(/\s+/g, '_')
        reminderClaimKey = `cron:invoice-reminder:${invoice.id}:${reminderKeySuffix}`
        reminderClaimHash = computeIdempotencyRequestHash({
          invoice_id: invoice.id,
          reminder_type: reminderType,
          days_overdue: daysOverdue
        })

        const reminderClaim = await claimIdempotencyKey(
          supabase,
          reminderClaimKey,
          reminderClaimHash,
          24 * 45
        )

        if (reminderClaim.state === 'conflict') {
          console.warn(
            `[Cron] Reminder idempotency conflict for invoice ${invoice.invoice_number} (${reminderType}); skipping`
          )
          continue
        }

        if (reminderClaim.state === 'in_progress' || reminderClaim.state === 'replay') {
          console.warn(
            `[Cron] Reminder already processed/in progress for invoice ${invoice.invoice_number} (${reminderType}); skipping duplicate`
          )
          continue
        }

        reminderClaimHeld = true

        // Calculate outstanding amount
        const outstandingAmount = invoiceBalanceDue(invoice)

        // Alert the owner. Sent by the ordinary email route, not the invoice sender, so it is not
        // saved against the invoice as if it were a customer email and carries no invoice PDF.
        // The claim above is what stops a second alert for the same stage.
        try {
          const statusText = daysOverdue > 0 ? 'overdue' : 'due'
          const internalSubject = `[${reminderType}] Invoice ${invoice.invoice_number} - ${invoice.vendor?.name || 'Unknown'} - £${outstandingAmount.toFixed(2)} ${statusText}`

          const internalBody = `
Invoice Reminder Alert

Invoice: ${invoice.invoice_number}
Vendor: ${invoice.vendor?.name || 'Unknown'}
Contact: ${invoice.vendor?.contact_name || 'N/A'}
Email: ${vendorEmail || 'No email on the client record'}

Amount Due: £${outstandingAmount.toFixed(2)}
Days Overdue: ${daysOverdue}
Due Date: ${formatIsoDateForUk(dueDateIso)}
Reminder Type: ${reminderType}

No customer email was sent. Automatic reminders are paused. Chase from the invoice page.

View invoice: ${getAppUrl()}/invoices/${invoice.id}
          `.trim()

          const internalResult = await sendEmail({
            to: internalEmail,
            subject: internalSubject,
            text: internalBody
          })

          if (internalResult.success) {
            logger.info('[Cron] Internal reminder sent', {
              metadata: { invoiceNumber: invoice.invoice_number }
            })
            results.internal_notifications++
            internalReminderSent = true
          } else {
            reminderSendFailed = true
            console.error(`[Cron] Failed to send internal reminder for invoice ${invoice.invoice_number}:`, internalResult.error)
          }
        } catch (error) {
          console.error(`[Cron] Error sending internal reminder:`, error)
          reminderSendFailed = true
        }

        if (reminderSendFailed) {
          throw new Error('The owner alert failed to send')
        }

        // Log reminder in audit trail
        const { error: auditLogError } = await supabase
          .from('audit_logs')
          .insert({
            operation_type: 'update',
            resource_type: 'invoice',
            resource_id: invoice.id,
            // No user_id: audit_logs.user_id is a uuid with a foreign key, and the 'system'
            // string this used to write made every one of these inserts fail.
            operation_status: 'success',
            additional_info: {
              action: 'reminder_alert_sent',
              reminder_type: reminderType,
              days_overdue: daysOverdue,
              invoice_number: invoice.invoice_number,
              vendor: invoice.vendor?.name,
              internal_notification: internalReminderSent,
              customer_reminder: false,
              customer_reminders_paused: true
            }
          })

        if (auditLogError) {
          console.error(`[Cron] Failed to write reminder audit log for invoice ${invoice.invoice_number}:`, auditLogError)
        }

        if (reminderClaimHeld && reminderClaimKey && reminderClaimHash) {
          await persistIdempotencyResponse(
            supabase,
            reminderClaimKey,
            reminderClaimHash,
            {
              state: 'processed',
              invoice_id: invoice.id,
              reminder_type: reminderType,
              days_overdue: daysOverdue,
              internal_sent: internalReminderSent,
              customer_sent: false
            },
            24 * 45
          )
          reminderClaimHeld = false
        }

      } catch (error) {
        if (reminderClaimHeld && reminderClaimKey && reminderClaimHash) {
          const sendAlreadyPerformed = internalReminderSent
          if (sendAlreadyPerformed) {
            try {
              await persistIdempotencyResponse(
                supabase,
                reminderClaimKey,
                reminderClaimHash,
                {
                  state: 'processed_with_error',
                  invoice_id: invoice.id,
                  internal_sent: internalReminderSent,
                  customer_sent: false,
                  error: error instanceof Error ? error.message : String(error)
                },
                24 * 45
              )
              reminderClaimHeld = false
            } catch (persistError) {
              console.error(
                `[Cron] Failed to persist reminder idempotency after partial send for invoice ${invoice.invoice_number}:`,
                persistError
              )
              // Keep claim in processing state to avoid duplicate sends after ambiguous partial success.
              reminderClaimHeld = false
            }
          } else {
            try {
              await releaseIdempotencyClaim(supabase, reminderClaimKey, reminderClaimHash)
            } catch (releaseError) {
              console.error(
                `[Cron] Failed to release reminder idempotency claim for invoice ${invoice.invoice_number}:`,
                releaseError
              )
            }
            reminderClaimHeld = false
          }
        }

        console.error(`[Cron] Error processing invoice ${invoice.invoice_number}:`, error)
        results.errors.push({
          invoice_number: invoice.invoice_number,
          vendor: invoice.vendor?.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    logger.info('[Cron] Invoice reminders processing completed', {
      metadata: { results }
    })

    // A failed alert used to end as HTTP 200 with a line in the JSON nobody reads. While the
    // owner is the only one chasing, a lost alert is a lost chase, so say so.
    if (results.errors.length > 0) {
      await reportCronFailure(
        'invoice-reminders',
        new Error(`${results.errors.length} invoice reminder alert(s) could not be sent`),
        { invoices: results.errors.map((entry) => entry.invoice_number).join(', ') }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Invoice reminders processed',
      results
    })

  } catch (error) {
    console.error('[Cron] Fatal error in invoice reminders cron:', error)
    await reportCronFailure('invoice-reminders', error)
    return NextResponse.json({
      error: 'Failed to process invoice reminders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
