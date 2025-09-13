import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { generateInvoiceFromRecurring } from '@/app/actions/recurring-invoices'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { generateInvoiceHTML } from '@/lib/invoice-template'
import { isGraphConfigured } from '@/lib/microsoft-graph'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute max

export async function GET(request: Request) {
  // In production, verify this is called by Vercel Cron
  if (process.env.NODE_ENV === 'production') {
    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    console.log('[Cron] Starting recurring invoices processing')
    
    const supabase = createAdminClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get all active recurring invoices due for processing
    const { data: dueRecurringInvoices, error: fetchError } = await supabase
      .from('recurring_invoices')
      .select(`
        *,
        vendor:invoice_vendors(
          id,
          name,
          email,
          contact_name
        )
      `)
      .eq('is_active', true)
      .lte('next_invoice_date', today.toISOString())
      .order('next_invoice_date', { ascending: true })

    if (fetchError) {
      console.error('[Cron] Error fetching recurring invoices:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch recurring invoices',
        details: fetchError 
      }, { status: 500 })
    }

    console.log(`[Cron] Found ${dueRecurringInvoices?.length || 0} recurring invoices to process`)

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as Array<{
      recurring_invoice_id: string
      vendor?: string
      error: string
    }>
    }

    // Process each recurring invoice
    for (const recurringInvoice of dueRecurringInvoices || []) {
      results.processed++
      
      try {
        console.log(`[Cron] Processing recurring invoice ${recurringInvoice.id}`)
        
        // Check if end date has passed
        if (recurringInvoice.end_date && new Date(recurringInvoice.end_date) < today) {
          console.log(`[Cron] Recurring invoice ${recurringInvoice.id} has passed end date, deactivating`)
          
          await supabase
            .from('recurring_invoices')
            .update({ 
              is_active: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', recurringInvoice.id)
          
          continue
        }

        // Generate the invoice
        const generateResult = await generateInvoiceFromRecurring(recurringInvoice.id)
        
        if (generateResult.error) {
          console.error(`[Cron] Failed to generate invoice for ${recurringInvoice.id}:`, generateResult.error)
          results.failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: generateResult.error
          })
          continue
        }

        if (!generateResult.invoice) {
          console.error(`[Cron] No invoice returned for ${recurringInvoice.id}`)
          results.failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: 'No invoice generated'
          })
          continue
        }

        console.log(`[Cron] Successfully generated invoice ${generateResult.invoice.invoice_number}`)
        
        // If email is configured and vendor has email, send the invoice
        if (isGraphConfigured() && recurringInvoice.vendor?.email) {
          try {
            // Get full invoice details for email
            const { data: fullInvoice, error: invoiceError } = await supabase
              .from('invoices')
              .select(`
                *,
                vendor:invoice_vendors(*),
                line_items:invoice_line_items(*),
                payments:invoice_payments(*)
              `)
              .eq('id', generateResult.invoice.id)
              .single()

              if (!invoiceError && fullInvoice) {
                // Support multiple recipients (comma/semicolon separated) — first is To, rest CC
                const raw = String(recurringInvoice.vendor.email)
                const recipients = raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)
                const toAddress = recipients[0] || raw
                const ccAddresses = (recipients[0] ? recipients.slice(1) : []).filter(Boolean)

                const emailResult = await sendInvoiceEmail(
                  fullInvoice,
                  toAddress,
                  `Invoice ${fullInvoice.invoice_number} from Orange Jelly Limited`,
                  `Dear ${recurringInvoice.vendor.contact_name || recurringInvoice.vendor.name},\n\nPlease find attached invoice ${fullInvoice.invoice_number} for your records.\n\nThis is an automatically generated recurring invoice.\n\nBest regards,\nOrange Jelly Limited`,
                  ccAddresses
                )

                if (emailResult.success) {
                  console.log(`[Cron] Email sent for invoice ${fullInvoice.invoice_number}`)
                  // Update invoice status to sent
                  await supabase
                    .from('invoices')
                    .update({ 
                      status: 'sent',
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', fullInvoice.id)

                  // Log to and cc entries
                  await supabase.from('invoice_email_logs').insert({
                    invoice_id: fullInvoice.id,
                    sent_to: toAddress,
                    sent_by: 'system',
                    subject: `Invoice ${fullInvoice.invoice_number} from Orange Jelly Limited`,
                    body: 'Automatically generated recurring invoice',
                    status: 'sent'
                  })
                  for (const cc of ccAddresses) {
                    await supabase.from('invoice_email_logs').insert({
                      invoice_id: fullInvoice.id,
                      sent_to: cc,
                      sent_by: 'system',
                      subject: `Invoice ${fullInvoice.invoice_number} from Orange Jelly Limited`,
                      body: 'Automatically generated recurring invoice',
                      status: 'sent'
                    })
                  }
                } else {
                  console.error(`[Cron] Failed to send email for invoice ${fullInvoice.invoice_number}:`, emailResult.error)
                }
              }
          } catch (emailError) {
            console.error(`[Cron] Error sending email for invoice:`, emailError)
            // Don't fail the whole process if email fails
          }
        }

        results.successful++
        
        // Log success in audit trail
        await supabase
          .from('audit_logs')
          .insert({
            operation_type: 'create',
            resource_type: 'invoice',
            resource_id: generateResult.invoice.id,
            user_id: 'system',
            operation_status: 'success',
            operation_details: {
              source: 'recurring_invoice_cron',
              recurring_invoice_id: recurringInvoice.id,
              invoice_number: generateResult.invoice.invoice_number,
              vendor: recurringInvoice.vendor?.name
            }
          })

      } catch (error) {
        console.error(`[Cron] Error processing recurring invoice ${recurringInvoice.id}:`, error)
        results.failed++
        results.errors.push({
          recurring_invoice_id: recurringInvoice.id,
          vendor: recurringInvoice.vendor?.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    console.log('[Cron] Recurring invoices processing completed:', results)

    return NextResponse.json({
      success: true,
      message: 'Recurring invoices processed',
      results
    })

  } catch (error) {
    console.error('[Cron] Fatal error in recurring invoices cron:', error)
    return NextResponse.json({ 
      error: 'Failed to process recurring invoices',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
