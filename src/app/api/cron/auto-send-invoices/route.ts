import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceWithDetails } from '@/types/invoices'
import { logAuditEvent } from '@/app/actions/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGraphConfigured()) {
    return NextResponse.json({
      processed: 0,
      sent: 0,
      skipped_no_email: 0,
      skipped_email_not_configured: true,
      errors: []
    })
  }

  const supabase = createAdminClient()
  const todayIso = getTodayIsoDate()

  const { data: draftInvoices, error } = await supabase
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
    .eq('invoice_date', todayIso)
    .eq('status', 'draft')
    .is('deleted_at', null)

  if (error) {
    console.error('[Cron] Failed to load invoices for auto-send:', error)
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 })
  }

  const results = {
    processed: draftInvoices?.length ?? 0,
    sent: 0,
    skipped_no_email: 0,
    skipped_errors: 0,
    errors: [] as Array<{ invoice_number: string; error: string }>
  }

  if (!draftInvoices || draftInvoices.length === 0) {
    return NextResponse.json(results)
  }

  for (const invoice of draftInvoices) {
    if (!invoice?.vendor?.email) {
      results.skipped_no_email++
      continue
    }

    try {
      // Prefer primary contact email if available
      let recipientEmail = invoice.vendor.email
      try {
        const { data: primaryContact } = await supabase
          .from('invoice_vendor_contacts')
          .select('email')
          .eq('vendor_id', invoice.vendor_id)
          .eq('is_primary', true)
          .maybeSingle()

        if (primaryContact?.email) {
          recipientEmail = primaryContact.email
        }
      } catch (contactError) {
        console.warn('[Cron] Failed to load primary vendor contact:', contactError)
      }

      const sendResult = await sendInvoiceEmail(
        invoice as InvoiceWithDetails,
        recipientEmail
      )

      if (!sendResult.success) {
        results.skipped_errors++
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: sendResult.error || 'Unknown error while sending invoice email'
        })
        continue
      }

      const subject = `Invoice ${invoice.invoice_number} from Orange Jelly Limited`

      await supabase
        .from('invoices')
        .update({
          status: 'sent',
          updated_at: new Date().toISOString()
        })
        .eq('id', invoice.id)

      await supabase
        .from('invoice_email_logs')
        .insert({
          invoice_id: invoice.id,
          sent_to: recipientEmail,
          sent_by: null,
          subject,
          body: 'Automatically sent on the scheduled invoice date.',
          status: 'sent'
        })

      await logAuditEvent({
        operation_type: 'auto_send',
        resource_type: 'invoice',
        resource_id: invoice.id,
        operation_status: 'success',
        additional_info: {
          invoice_number: invoice.invoice_number,
          recipient: recipientEmail,
          automated: true
        }
      })

      results.sent++
    } catch (sendError: any) {
      console.error('[Cron] Failed to auto-send invoice:', sendError)
      results.skipped_errors++
      results.errors.push({
        invoice_number: invoice.invoice_number,
        error: sendError?.message || 'Unexpected error sending invoice'
      })
    }
  }

  return NextResponse.json(results)
}
