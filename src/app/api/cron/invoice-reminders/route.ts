import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { isGraphConfigured } from '@/lib/microsoft-graph'
import type { InvoiceWithDetails } from '@/types/invoices'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute max

// Configuration for reminder intervals (days)
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
    console.log('[Cron] Starting invoice reminders processing')
    
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
          contacts:invoice_vendor_contacts(
            email,
            is_primary
          )
        ),
        line_items:invoice_line_items(*),
        payments:invoice_payments(*)
      `)
      .in('status', ['sent', 'partially_paid', 'overdue'])
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

    console.log(`[Cron] Found ${overdueInvoices?.length || 0} invoices to process`)

    const results = {
      processed: 0,
      reminders_sent: 0,
      internal_notifications: 0,
      errors: [] as Array<{
      invoice_number: string
      vendor?: string
      error: string
    }>
    }

    // Check if email is configured
    const emailConfigured = isGraphConfigured()
    const internalEmail = process.env.MICROSOFT_USER_EMAIL || 'peter@orangejelly.co.uk'

    // Process each overdue invoice
    for (const invoice of overdueInvoices || []) {
      results.processed++
      let internalReminderSent = false
      let customerReminderSent = false
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
        
        console.log(`[Cron] Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`)

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

        if (emailConfigured) {
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
            console.log(
              `[Cron] Reminder already processed/in progress for invoice ${invoice.invoice_number} (${reminderType}); skipping duplicate`
            )
            continue
          }

          reminderClaimHeld = true
        }

        // Calculate outstanding amount
        const outstandingAmount = Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0))

        // Send internal notification
        if (emailConfigured) {
          try {
            const statusText = daysOverdue > 0 ? 'overdue' : 'due'
            const internalSubject = `[${reminderType}] Invoice ${invoice.invoice_number} - ${invoice.vendor?.name || 'Unknown'} - £${outstandingAmount.toFixed(2)} ${statusText}`
            
            const internalBody = `
Invoice Reminder Alert

Invoice: ${invoice.invoice_number}
Vendor: ${invoice.vendor?.name || 'Unknown'}
Contact: ${invoice.vendor?.contact_name || 'N/A'}
Email: ${vendorEmail || 'No email'}

Amount Due: £${outstandingAmount.toFixed(2)}
Days Overdue: ${daysOverdue}
Due Date: ${formatIsoDateForUk(dueDateIso)}
Reminder Type: ${reminderType}

${vendorEmail ? 'Customer reminder has been sent.' : 'No vendor email on file - manual follow-up required.'}

View invoice: ${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/invoices/${invoice.id}
            `.trim()

            const { data: existingInternalReminder, error: internalCheckError } = await supabase
              .from('invoice_email_logs')
              .select('id')
              .eq('invoice_id', invoice.id)
              .eq('status', 'sent')
              .eq('subject', internalSubject)
              .maybeSingle()

            if (internalCheckError) {
              throw new Error(internalCheckError.message || 'Failed to check existing internal reminder logs')
            }

            if (existingInternalReminder) {
              console.log(`[Cron] Internal reminder already sent for invoice ${invoice.invoice_number} (${reminderType}); skipping duplicate`)
            } else {
              // Create a simple invoice object for internal notification
              const internalInvoice = {
                ...invoice,
                invoice_number: `REMINDER: ${invoice.invoice_number}`
              }

              const internalResult = await sendInvoiceEmail(
                internalInvoice as InvoiceWithDetails,
                internalEmail,
                internalSubject,
                internalBody
              )

              if (internalResult.success) {
                console.log(`[Cron] Internal reminder sent for invoice ${invoice.invoice_number}`)
                results.internal_notifications++
                internalReminderSent = true

                // Log internal notification
                const { error: internalLogError } = await supabase
                  .from('invoice_email_logs')
                  .insert({
                    invoice_id: invoice.id,
                    sent_to: internalEmail,
                    sent_by: 'system',
                    subject: internalSubject,
                    body: `Internal ${reminderType} - ${daysOverdue} days overdue`,
                    status: 'sent'
                  })

                if (internalLogError) {
                  reminderSendFailed = true
                  throw new Error(internalLogError.message || 'Failed to persist internal reminder log')
                }
              } else {
                reminderSendFailed = true
                console.error(`[Cron] Failed to send internal reminder for invoice ${invoice.invoice_number}:`, internalResult.error)
              }
            }
          } catch (error) {
            console.error(`[Cron] Error sending internal reminder:`, error)
            reminderSendFailed = true
          }
        }

        // Send customer reminder if email available
        if (emailConfigured && vendorEmail) {
          try {
            const customerSubject = daysOverdue === 0
              ? `Payment Due Today: Invoice ${invoice.invoice_number} from Orange Jelly Limited`
              : `${reminderType}: Invoice ${invoice.invoice_number} from Orange Jelly Limited`
            
            let customerBody = `Dear ${invoice.vendor?.contact_name || invoice.vendor?.name || 'there'},\n\n`

            if (daysOverdue === 0) {
              customerBody += `This is a friendly reminder that invoice ${invoice.invoice_number} is due for payment today.\n\n`
            } else {
              customerBody += `This is a friendly reminder that invoice ${invoice.invoice_number} is now ${daysOverdue} days overdue.\n\n`
            }

            customerBody += `Invoice Details:
- Invoice Number: ${invoice.invoice_number}
- Amount Due: £${outstandingAmount.toFixed(2)}
- Due Date: ${formatIsoDateForUk(dueDateIso)}
`

            if (daysOverdue >= REMINDER_INTERVALS.FINAL_REMINDER) {
              customerBody += `
This is our final reminder. Please arrange payment immediately to avoid any disruption to services.
`
            } else {
              customerBody += `
Please arrange payment at your earliest convenience.
`
            }

            customerBody += `
If you have already made payment, please disregard this reminder. If you have any questions about this invoice, please don't hesitate to contact us.

Best regards,
Orange Jelly Limited
`

            const { data: existingCustomerReminder, error: customerCheckError } = await supabase
              .from('invoice_email_logs')
              .select('id')
              .eq('invoice_id', invoice.id)
              .eq('status', 'sent')
              .eq('subject', customerSubject)
              .maybeSingle()

            if (customerCheckError) {
              throw new Error(customerCheckError.message || 'Failed to check existing customer reminder logs')
            }

            if (existingCustomerReminder) {
              console.log(`[Cron] Customer reminder already sent for invoice ${invoice.invoice_number} (${reminderType}); skipping duplicate`)
            } else {
              // Support multiple recipients — first as To, others as CC
              const raw = String(vendorEmail)
              const recipients = raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)
              const toAddress = recipients[0] || raw
              const ccAddresses = (recipients[0] ? recipients.slice(1) : []).filter(Boolean)

              // We need to ensure we pass the resolved email, so we construct a modified invoice object
              // or pass it explicitly if sendInvoiceEmail supported it. 
              // Looking at sendInvoiceEmail signature: (invoice: InvoiceWithDetails, to: string, ...)
              // It takes 'to' separately, so we are good!

              const customerResult = await sendInvoiceEmail(
                invoice as InvoiceWithDetails,
                toAddress,
                customerSubject,
                customerBody,
                ccAddresses
              )

              if (customerResult.success) {
                console.log(`[Cron] Customer reminder sent for invoice ${invoice.invoice_number}`)
                results.reminders_sent++
                customerReminderSent = true

                const customerLogRows = [
                  {
                    invoice_id: invoice.id,
                    sent_to: toAddress,
                    sent_by: 'system',
                    subject: customerSubject,
                    body: `${reminderType} - ${daysOverdue} days overdue`,
                    status: 'sent' as const
                  },
                  ...ccAddresses.map((cc) => ({
                    invoice_id: invoice.id,
                    sent_to: cc,
                    sent_by: 'system',
                    subject: customerSubject,
                    body: `${reminderType} - ${daysOverdue} days overdue`,
                    status: 'sent' as const
                  }))
                ]

                const { error: customerLogError } = await supabase
                  .from('invoice_email_logs')
                  .insert(customerLogRows)

                if (customerLogError) {
                  reminderSendFailed = true
                  throw new Error(customerLogError.message || 'Failed to persist customer reminder logs')
                }
              } else {
                console.error(`[Cron] Failed to send customer reminder for invoice ${invoice.invoice_number}:`, customerResult.error)
                reminderSendFailed = true
              }
            }
          } catch (error) {
            console.error(`[Cron] Error sending customer reminder:`, error)
            reminderSendFailed = true
          }
        }

        if (reminderSendFailed) {
          throw new Error('One or more reminder emails failed to send')
        }

        // Log reminder in audit trail
        const { error: auditLogError } = await supabase
          .from('audit_logs')
          .insert({
            operation_type: 'update',
            resource_type: 'invoice',
            resource_id: invoice.id,
            user_id: 'system',
            operation_status: 'success',
            operation_details: {
              action: 'reminder_sent',
              reminder_type: reminderType,
              days_overdue: daysOverdue,
              invoice_number: invoice.invoice_number,
              vendor: invoice.vendor?.name,
              internal_notification: internalReminderSent,
              customer_reminder: customerReminderSent
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
              customer_sent: customerReminderSent
            },
            24 * 45
          )
          reminderClaimHeld = false
        }

      } catch (error) {
        if (reminderClaimHeld && reminderClaimKey && reminderClaimHash) {
          const sendAlreadyPerformed = internalReminderSent || customerReminderSent
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
                  customer_sent: customerReminderSent,
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

    console.log('[Cron] Invoice reminders processing completed:', results)

    return NextResponse.json({
      success: true,
      message: 'Invoice reminders processed',
      results
    })

  } catch (error) {
    console.error('[Cron] Fatal error in invoice reminders cron:', error)
    return NextResponse.json({ 
      error: 'Failed to process invoice reminders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
