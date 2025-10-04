import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { isGraphConfigured } from '@/lib/microsoft-graph'
import type { InvoiceWithDetails } from '@/types/invoices'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute max

// Configuration for reminder intervals (days)
const REMINDER_INTERVALS = {
  FIRST_REMINDER: 7,    // 7 days after due date
  SECOND_REMINDER: 14,  // 14 days after due date
  FINAL_REMINDER: 30    // 30 days after due date
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[Cron] Starting invoice reminders processing')
    
    const supabase = createAdminClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get all overdue invoices
    const { data: overdueInvoices, error: fetchError } = await supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          email,
          contact_name
        ),
        line_items:invoice_line_items(*),
        payments:invoice_payments(*)
      `)
      .in('status', ['sent', 'partially_paid', 'overdue'])
      .lt('due_date', today.toISOString())
      .order('due_date', { ascending: true })

    if (fetchError) {
      console.error('[Cron] Error fetching overdue invoices:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch overdue invoices',
        details: fetchError 
      }, { status: 500 })
    }

    console.log(`[Cron] Found ${overdueInvoices?.length || 0} overdue invoices`)

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
      
      try {
        const dueDate = new Date(invoice.due_date)
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        
        console.log(`[Cron] Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`)

        // Update status to overdue if not already
        if (invoice.status !== 'overdue') {
          await supabase
            .from('invoices')
            .update({ 
              status: 'overdue',
              updated_at: new Date().toISOString()
            })
            .eq('id', invoice.id)
        }

        // Check if we should send a reminder based on intervals
        const shouldSendReminder = 
          daysOverdue === REMINDER_INTERVALS.FIRST_REMINDER ||
          daysOverdue === REMINDER_INTERVALS.SECOND_REMINDER ||
          daysOverdue === REMINDER_INTERVALS.FINAL_REMINDER

        if (!shouldSendReminder) {
          continue
        }

        // Determine reminder type
        let reminderType = 'First Reminder'
        if (daysOverdue === REMINDER_INTERVALS.SECOND_REMINDER) {
          reminderType = 'Second Reminder'
        } else if (daysOverdue === REMINDER_INTERVALS.FINAL_REMINDER) {
          reminderType = 'Final Reminder'
        }

        // Calculate outstanding amount
        const outstandingAmount = invoice.total_amount - invoice.paid_amount

        // Send internal notification
        if (emailConfigured) {
          try {
            const internalSubject = `[${reminderType}] Invoice ${invoice.invoice_number} - ${invoice.vendor?.name || 'Unknown'} - £${outstandingAmount.toFixed(2)} overdue`
            
            const internalBody = `
Invoice Reminder Alert

Invoice: ${invoice.invoice_number}
Vendor: ${invoice.vendor?.name || 'Unknown'}
Contact: ${invoice.vendor?.contact_name || 'N/A'}
Email: ${invoice.vendor?.email || 'No email'}

Amount Due: £${outstandingAmount.toFixed(2)}
Days Overdue: ${daysOverdue}
Due Date: ${dueDate.toLocaleDateString('en-GB')}
Reminder Type: ${reminderType}

${invoice.vendor?.email ? 'Customer reminder has been sent.' : 'No vendor email on file - manual follow-up required.'}

View invoice: ${process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/invoices/${invoice.id}
            `.trim()

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

              // Log internal notification
              await supabase
                .from('invoice_email_logs')
                .insert({
                  invoice_id: invoice.id,
                  sent_to: internalEmail,
                  sent_by: 'system',
                  subject: internalSubject,
                  body: `Internal ${reminderType} - ${daysOverdue} days overdue`,
                  status: 'sent'
                })
            }
          } catch (error) {
            console.error(`[Cron] Error sending internal reminder:`, error)
          }
        }

        // Send customer reminder if email available
        if (emailConfigured && invoice.vendor?.email) {
          try {
            const customerSubject = `${reminderType}: Invoice ${invoice.invoice_number} from Orange Jelly Limited`
            
            let customerBody = `Dear ${invoice.vendor.contact_name || invoice.vendor.name},

This is a friendly reminder that invoice ${invoice.invoice_number} is now ${daysOverdue} days overdue.

Invoice Details:
- Invoice Number: ${invoice.invoice_number}
- Amount Due: £${outstandingAmount.toFixed(2)}
- Due Date: ${dueDate.toLocaleDateString('en-GB')}
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

            // Support multiple recipients — first as To, others as CC
            const raw = String(invoice.vendor.email)
            const recipients = raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)
            const toAddress = recipients[0] || raw
            const ccAddresses = (recipients[0] ? recipients.slice(1) : []).filter(Boolean)

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

              // Log To and CC
              await supabase
                .from('invoice_email_logs')
                .insert({
                  invoice_id: invoice.id,
                  sent_to: toAddress,
                  sent_by: 'system',
                  subject: customerSubject,
                  body: `${reminderType} - ${daysOverdue} days overdue`,
                  status: 'sent'
                })
              for (const cc of ccAddresses) {
                await supabase
                  .from('invoice_email_logs')
                  .insert({
                    invoice_id: invoice.id,
                    sent_to: cc,
                    sent_by: 'system',
                    subject: customerSubject,
                    body: `${reminderType} - ${daysOverdue} days overdue`,
                    status: 'sent'
                  })
              }
            } else {
              console.error(`[Cron] Failed to send customer reminder for invoice ${invoice.invoice_number}:`, customerResult.error)
            }
          } catch (error) {
            console.error(`[Cron] Error sending customer reminder:`, error)
            results.errors.push({
              invoice_number: invoice.invoice_number,
              vendor: invoice.vendor?.name,
              error: 'Failed to send customer reminder'
            })
          }
        }

        // Log reminder in audit trail
        await supabase
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
              internal_notification: results.internal_notifications > 0,
              customer_reminder: invoice.vendor?.email ? true : false
            }
          })

      } catch (error) {
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
