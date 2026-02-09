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

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute max

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[Cron] Starting recurring invoices processing')
    
    const supabase = createAdminClient()
    const emailConfigured = isGraphConfigured()
    const todayIso = getTodayIsoDate()

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
        error: 'Failed to fetch recurring invoices',
        details: fetchError 
      }, { status: 500 })
    }

    console.log(`[Cron] Found ${dueRecurringInvoices?.length || 0} recurring invoices to process`)

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
      
      try {
        console.log(`[Cron] Processing recurring invoice ${recurringInvoice.id}`)
        
        // Check if end date has passed
        if (recurringInvoice.end_date && recurringInvoice.end_date < todayIso) {
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
        const invoiceDateIso = recurringInvoice.next_invoice_date
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

        const nextInvoiceDateIso = calculateNextInvoiceIsoDate(
          invoiceDateIso,
          recurringInvoice.frequency as RecurringFrequency
        )

        const { error: recurringUpdateError } = await supabase
          .from('recurring_invoices')
          .update({
            next_invoice_date: nextInvoiceDateIso,
            last_invoice_id: newInvoice.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', recurringInvoice.id)

        if (recurringUpdateError) {
          throw new Error(recurringUpdateError.message || 'Failed to update recurring invoice schedule')
        }

        console.log(`[Cron] Successfully generated invoice ${newInvoice.invoice_number}`)

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
          continue
        }

        if (!recipientResult.to) {
          results.skipped_send_no_recipient++
          results.successful++
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
          continue
        }

        const subject = `Invoice ${fullInvoice.invoice_number} from Orange Jelly Limited`
        const greetingName = fullInvoice.vendor?.contact_name || fullInvoice.vendor?.name || 'there'
        const body = `Dear ${greetingName},\n\nPlease find attached invoice ${fullInvoice.invoice_number} for your records.\n\nThis invoice was generated automatically from a recurring schedule.\n\nBest regards,\nOrange Jelly Limited`

        const emailResult = await sendInvoiceEmail(
          fullInvoice as InvoiceWithDetails,
          recipientResult.to,
          subject,
          body,
          recipientResult.cc
        )

        if (!emailResult.success) {
          results.send_failed++
          results.errors.push({
            recurring_invoice_id: recurringInvoice.id,
            vendor: recurringInvoice.vendor?.name,
            error: emailResult.error || 'Unknown error sending invoice email'
          })

          await supabase
            .from('invoice_email_logs')
            .insert({
              invoice_id: fullInvoice.id,
              sent_to: recipientResult.to,
              sent_by: null,
              subject,
              body,
              status: 'failed'
            })

          results.successful++
          continue
        }

        const { error: invoiceUpdateError } = await supabase
          .from('invoices')
          .update({
            status: 'sent',
            updated_at: new Date().toISOString()
          })
          .eq('id', fullInvoice.id)

        if (invoiceUpdateError) {
          throw new Error(invoiceUpdateError.message || 'Failed to update invoice status to sent')
        }

        await supabase
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
