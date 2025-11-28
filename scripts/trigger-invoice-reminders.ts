
import {
  createAdminClient
} from '@/lib/supabase/admin'
import {
  sendInvoiceEmail
} from '@/lib/microsoft-graph'
import {
  isGraphConfigured
} from '@/lib/microsoft-graph'
import type {
  InvoiceWithDetails
} from '@/types/invoices'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const REMINDER_INTERVALS = {
  DUE_TODAY: 0, // On the due date
  FIRST_REMINDER: 7, // 7 days after due date
  SECOND_REMINDER: 14, // 14 days after due date
  FINAL_REMINDER: 30 // 30 days after due date
}

async function main() {
  try {
    console.log('[Cron] Starting invoice reminders processing (Script Mode)')

    const supabase = createAdminClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get all overdue and due today invoices
    const { data: overdueInvoices, error: fetchError } = await supabase
      .from('invoices')
      .select(
        `
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
      `
      )
      .in('status', ['sent', 'partially_paid', 'overdue'])
      .lte('due_date', today.toISOString())
      .order('due_date', { ascending: true })

    if (fetchError) {
      console.error('[Cron] Error fetching overdue invoices:', fetchError)
      process.exit(1)
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

      // Resolve vendor email: prefers vendor.email, then primary contact, then first contact
      const vendorEmail = invoice.vendor?.email || 
        (Array.isArray(invoice.vendor?.contacts) 
          ? (invoice.vendor.contacts.find((c: any) => c.is_primary)?.email || invoice.vendor.contacts[0]?.email)
          : null)

      try {
        const dueDate = new Date(invoice.due_date)
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        
        console.log(`[Cron] Invoice ${invoice.invoice_number} is ${daysOverdue} days overdue`)

        // Update status to overdue if not already and actually overdue
        if (daysOverdue > 0 && invoice.status !== 'overdue') {
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

        // Calculate outstanding amount
        const outstandingAmount = invoice.total_amount - invoice.paid_amount

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
Due Date: ${dueDate.toLocaleDateString('en-GB')}
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
              console.error('[Cron] Error checking existing internal reminder logs:', internalCheckError)
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
            }
          } catch (error) {
            console.error(`[Cron] Error sending internal reminder:`, error)
          }
        }

        // Send customer reminder if email available
        if (emailConfigured && vendorEmail) {
          try {
            const customerSubject = daysOverdue === 0
              ? `Payment Due Today: Invoice ${invoice.invoice_number} from Orange Jelly Limited`
              : `${reminderType}: Invoice ${invoice.invoice_number} from Orange Jelly Limited`
            
            let customerBody = `Dear ${invoice.vendor.contact_name || invoice.vendor.name},

`

            if (daysOverdue === 0) {
              customerBody += `This is a friendly reminder that invoice ${invoice.invoice_number} is due for payment today.

`
            } else {
              customerBody += `This is a friendly reminder that invoice ${invoice.invoice_number} is now ${daysOverdue} days overdue.

`
            }

            customerBody += `Invoice Details:
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

            const { data: existingCustomerReminder, error: customerCheckError } = await supabase
              .from('invoice_email_logs')
              .select('id')
              .eq('invoice_id', invoice.id)
              .eq('status', 'sent')
              .eq('subject', customerSubject)
              .maybeSingle()

            if (customerCheckError) {
              console.error('[Cron] Error checking existing customer reminder logs:', customerCheckError)
            }

            if (existingCustomerReminder) {
              console.log(`[Cron] Customer reminder already sent for invoice ${invoice.invoice_number} (${reminderType}); skipping duplicate`)
            } else {
              // Support multiple recipients — first as To, others as CC
              const raw = String(vendorEmail)
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
                customerReminderSent = true

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
              internal_notification: internalReminderSent,
              customer_reminder: customerReminderSent
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
  } catch (error) {
    console.error('[Cron] Fatal error in invoice reminders cron:', error)
    process.exit(1)
  }
}

main()
