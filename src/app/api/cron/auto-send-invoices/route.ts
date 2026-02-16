import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceWithDetails } from '@/types/invoices'
import { logAuditEvent } from '@/app/actions/audit'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

export const runtime = 'nodejs'
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
    skipped_already_sent: 0,
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

    let claimKey: string | null = null
    let claimHash: string | null = null
    let claimHeld = false
    let emailSent = false
    let recipientEmailForClaim: string | null = null

    try {
      claimKey = `cron:auto-send-invoice:${invoice.id}:${todayIso}`
      claimHash = computeIdempotencyRequestHash({
        invoice_id: invoice.id,
        invoice_date: invoice.invoice_date,
        vendor_id: invoice.vendor_id
      })

      const { data: existingSentLog, error: sentLogCheckError } = await supabase
        .from('invoice_email_logs')
        .select('id')
        .eq('invoice_id', invoice.id)
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (sentLogCheckError) {
        console.error('[Cron] Failed to verify prior invoice send logs:', sentLogCheckError)
        results.skipped_errors++
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: 'Failed to verify prior invoice send log state'
        })
        continue
      }

      if (existingSentLog) {
        results.skipped_already_sent++
        continue
      }

      const sendClaim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 90)
      if (sendClaim.state === 'conflict') {
        results.skipped_errors++
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: 'Auto-send idempotency conflict'
        })
        continue
      }
      if (sendClaim.state === 'in_progress' || sendClaim.state === 'replay') {
        results.skipped_already_sent++
        continue
      }
      claimHeld = true

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
      recipientEmailForClaim = recipientEmail

      if (!sendResult.success) {
        if (claimHeld) {
          await releaseIdempotencyClaim(supabase, claimKey, claimHash)
          claimHeld = false
        }
        results.skipped_errors++
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: sendResult.error || 'Unknown error while sending invoice email'
        })
        continue
      }
      emailSent = true

      const subject = `Invoice ${invoice.invoice_number} from Orange Jelly Limited`

      const { data: updatedInvoice, error: statusUpdateError } = await supabase
        .from('invoices')
        .update({
          status: 'sent',
          updated_at: new Date().toISOString()
        })
        .eq('id', invoice.id)
        .eq('status', 'draft')
        .select('id')
        .maybeSingle()

      if (statusUpdateError || !updatedInvoice) {
        console.error('[Cron] Failed to finalize invoice status after send:', statusUpdateError)
        const { error: fallbackLogError } = await supabase
          .from('invoice_email_logs')
          .insert({
            invoice_id: invoice.id,
            sent_to: recipientEmail,
            sent_by: null,
            subject,
            body: 'Invoice email sent, but status update failed. Manual reconciliation required.',
            status: 'sent'
          })

        if (fallbackLogError) {
          console.error('[Cron] Failed to write fallback invoice email log:', fallbackLogError)
        }

        results.skipped_errors++
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: 'Email sent but failed to finalize invoice status'
        })

        if (claimHeld) {
          await persistIdempotencyResponse(
            supabase,
            claimKey,
            claimHash,
            {
              state: 'processed_with_error',
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              sent: true,
              recipient: recipientEmail,
              error: 'status_update_failed'
            },
            24 * 90
          )
          claimHeld = false
        }
        continue
      }

      const { error: emailLogError } = await supabase
        .from('invoice_email_logs')
        .insert({
          invoice_id: invoice.id,
          sent_to: recipientEmail,
          sent_by: null,
          subject,
          body: 'Automatically sent on the scheduled invoice date.',
          status: 'sent'
        })

      if (emailLogError) {
        console.error('[Cron] Failed to write invoice email log after send:', emailLogError)
        results.errors.push({
          invoice_number: invoice.invoice_number,
          error: 'Invoice sent but email log insert failed'
        })
      }

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

      if (claimHeld) {
        await persistIdempotencyResponse(
          supabase,
          claimKey,
          claimHash,
          {
            state: 'processed',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            sent: true,
            recipient: recipientEmail
          },
          24 * 90
        )
        claimHeld = false
      }

      results.sent++
    } catch (sendError: any) {
      if (claimHeld && claimKey && claimHash) {
        if (emailSent) {
          try {
            await persistIdempotencyResponse(
              supabase,
              claimKey,
              claimHash,
              {
                state: 'processed_with_error',
                invoice_id: invoice.id,
                invoice_number: invoice.invoice_number,
                sent: true,
                recipient: recipientEmailForClaim,
                error: sendError?.message || 'post_send_failure'
              },
              24 * 90
            )
            claimHeld = false
          } catch (persistError) {
            console.error('[Cron] Failed to persist post-send auto-send idempotency response:', persistError)
          }
        } else {
          try {
            await releaseIdempotencyClaim(supabase, claimKey, claimHash)
          } catch (releaseError) {
            console.error('[Cron] Failed to release auto-send idempotency claim:', releaseError)
          }
          claimHeld = false
        }
      }
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
