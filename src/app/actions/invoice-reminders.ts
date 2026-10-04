'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { getErrorMessage } from '@/lib/errors'
import { getTodayIsoDate, isValidIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { invoiceBalanceDue } from '@/lib/invoices/balance'
import { formatInvoiceDate } from '@/lib/invoices/email-copy'
import {
  EMAIL_HISTORY_STARTS,
  describeNextReminder,
  toInvoiceEmailHistory,
  type InvoiceEmailHistory,
  type InvoiceEmailRow,
  type NextReminderLine,
} from '@/lib/invoices/email-history'
import { invoiceRemindersGoLiveDate } from '@/lib/invoices/release-switches'
import { INVOICE_REMINDERS_JOB, loadLastClientEmailDates, toReminderInvoice } from '@/lib/invoices/reminder-job'

interface ReminderHoldResult {
  success?: boolean
  error?: string
  /** The hold as it now stands: a calendar date, or null when reminders are not held. */
  heldUntil?: string | null
}

const invoiceIdSchema = z.string().uuid('That is not a valid invoice')

const holdSchema = z.object({
  invoiceId: invoiceIdSchema,
  heldUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date to hold reminders until')
    .refine(isValidIsoDate, 'That is not a valid date'),
  reason: z.string().trim().max(500, 'Keep the reason to 500 characters or fewer').optional(),
})

const resumeSchema = z.object({ invoiceId: invoiceIdSchema })

/**
 * Holds automatic reminders for one invoice through a date (inclusive).
 *
 * This is the owner's brake: the daily summary lists what will go next, and a hold is how he
 * stops a reminder to someone whose transfer has not been entered yet. It only ever writes the
 * hold date. The two reminder columns are never touched, so a hold cannot reset what has
 * already been sent, and a hold that runs past a window means that reminder is not caught up.
 *
 * The optional reason goes in the audit log only, with who set it.
 */
export async function holdInvoiceReminders(input: {
  invoiceId: string
  heldUntil: string
  reason?: string
}): Promise<ReminderHoldResult> {
  try {
    if (!(await checkUserPermission('invoices', 'edit'))) {
      return { error: 'You do not have permission to edit invoices' }
    }

    const parsed = holdSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again' }
    }
    const { invoiceId, heldUntil, reason } = parsed.data

    // London time: the job reads the hold against the London date of its run.
    if (heldUntil < getTodayIsoDate()) {
      return { error: 'The hold date must be today or later.' }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // The admin client, after the permission check above, as `updateInvoiceDueDate` writes:
    // the permission check is the gate, so anyone it lets through can hold.
    const admin = createAdminClient()
    const { data: invoice, error: fetchError } = await admin
      .from('invoices')
      .select('id, invoice_number, status, reminders_held_until')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchError || !invoice) return { error: 'Invoice not found' }

    if (invoice.status === 'paid') {
      return { error: 'This invoice is already paid, so there are no reminders to hold.' }
    }
    if (invoice.status === 'void' || invoice.status === 'written_off') {
      return { error: 'This invoice has been withdrawn, so there are no reminders to hold.' }
    }

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update({ reminders_held_until: heldUntil, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .select('id, reminders_held_until')
      .maybeSingle()

    if (updateError || !updated) {
      return { error: 'The hold could not be saved. Reload and try again.' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { reminders_held_until: invoice.reminders_held_until ?? null },
      new_values: {
        action: 'reminders_held',
        invoice_number: invoice.invoice_number,
        reminders_held_until: heldUntil,
        reason: reason || null,
      },
    })

    revalidatePath(`/invoices/${invoiceId}`)

    return { success: true, heldUntil }
  } catch (error: unknown) {
    console.error('Error in holdInvoiceReminders:', error)
    return { error: getErrorMessage(error) }
  }
}

/** Lifts a hold. Reminders may go again from the next run, if a window is still open. */
export async function resumeInvoiceReminders(input: { invoiceId: string }): Promise<ReminderHoldResult> {
  try {
    if (!(await checkUserPermission('invoices', 'edit'))) {
      return { error: 'You do not have permission to edit invoices' }
    }

    const parsed = resumeSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again' }
    }
    const { invoiceId } = parsed.data

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const admin = createAdminClient()
    const { data: invoice, error: fetchError } = await admin
      .from('invoices')
      .select('id, invoice_number, reminders_held_until')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (fetchError || !invoice) return { error: 'Invoice not found' }

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update({ reminders_held_until: null, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()

    if (updateError || !updated) {
      return { error: 'The hold could not be lifted. Reload and try again.' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      old_values: { reminders_held_until: invoice.reminders_held_until ?? null },
      new_values: {
        action: 'reminders_resumed',
        invoice_number: invoice.invoice_number,
        reminders_held_until: null,
      },
    })

    revalidatePath(`/invoices/${invoiceId}`)

    return { success: true, heldUntil: null }
  } catch (error: unknown) {
    console.error('Error in resumeInvoiceReminders:', error)
    return { error: getErrorMessage(error) }
  }
}

interface InvoiceEmailHistoryResult {
  error?: string
  /** Null when there is no such invoice: an unknown, deleted or malformed id. */
  history?: InvoiceEmailHistory | null
}

/** The most emails the panel lists. An invoice has a handful; this only bounds a runaway. */
const EMAIL_HISTORY_LIMIT = 100

/** The London calendar date of an instant, or null when there is none to read. */
function londonDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : toLocalIsoDate(date)
}

/**
 * Every customer email about one invoice, newest first, with the line that says what the
 * reminder job will do next.
 *
 * The permission is checked on every call. The read then uses the admin client, so that check
 * is the gate, whatever row level security says about `email_messages`. The wording of each
 * email comes back as plain text for the panel to show escaped. It can hold personal details
 * and a payment link, so it is never logged, here or in the browser.
 */
export async function getInvoiceEmailHistory(invoiceId: string): Promise<InvoiceEmailHistoryResult> {
  try {
    if (!(await checkUserPermission('invoices', 'view'))) {
      return { error: 'You do not have permission to view invoices' }
    }

    const parsedId = invoiceIdSchema.safeParse(invoiceId)
    if (!parsedId.success) return { history: null }

    const admin = createAdminClient()
    const { data: invoice, error: invoiceError } = await admin
      .from('invoices')
      .select(
        'id, vendor_id, status, invoice_date, due_date, total_amount, paid_amount, sent_at, deleted_at, reminders_held_until, reminder_first_sent_at, reminder_second_sent_at, credits:credit_notes(status, amount_inc_vat)'
      )
      .eq('id', parsedId.data)
      .is('deleted_at', null)
      .maybeSingle()

    if (invoiceError) {
      console.error('Error loading invoice for email history:', invoiceError.message)
      return { error: 'The email history could not be loaded' }
    }
    if (!invoice) return { history: null }

    // One more than the limit, to know whether the list was cut short.
    const { data: rows, error: rowsError } = await admin
      .from('email_messages')
      .select('id, to_address, subject, status, error, created_at, sent_at, body_text, metadata, resend_message_id')
      .eq('invoice_id', invoice.id)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(EMAIL_HISTORY_LIMIT + 1)

    if (rowsError) {
      console.error('Error loading invoice email history:', rowsError.message)
      return { error: 'The email history could not be loaded' }
    }

    const emailRows = (rows ?? []) as InvoiceEmailRow[]
    const today = getTodayIsoDate()
    const sentDate = londonDateOf(invoice.sent_at)
    const firstReminderDate = londonDateOf(invoice.reminder_first_sent_at)
    const secondReminderDate = londonDateOf(invoice.reminder_second_sent_at)

    let nextReminder: NextReminderLine
    try {
      const { data: bookingLink, error: bookingLinkError } = await admin
        .from('private_booking_invoices')
        .select('invoice_id')
        .eq('invoice_id', invoice.id)
        .maybeSingle()
      // Private hire invoices are never chased automatically. If that cannot be checked, say
      // nothing about a next reminder: a forecast here would be a guess.
      if (bookingLinkError) throw new Error(bookingLinkError.message)

      // Only sharpens the forecast (a client emailed in the last three days is left alone), so
      // a failure here is not worth losing the line over.
      let lastClientEmailDate: string | null = null
      try {
        const dates = await loadLastClientEmailDates(admin, [invoice.vendor_id], today)
        lastClientEmailDate = dates.get(invoice.vendor_id) ?? null
      } catch (error) {
        console.warn('Could not read recent client emails for the reminder forecast:', getErrorMessage(error))
      }

      const { data: todayRun } = await admin
        .from('cron_job_runs')
        .select('status')
        .eq('job_name', INVOICE_REMINDERS_JOB)
        .eq('run_key', today)
        .maybeSingle()

      nextReminder = describeNextReminder({
        invoice: toReminderInvoice(invoice, Boolean(bookingLink), invoiceBalanceDue(invoice)),
        today,
        goLiveDate: invoiceRemindersGoLiveDate(),
        lastClientEmailDate,
        todayRunDone: todayRun?.status === 'completed',
      })
    } catch (error) {
      console.error('Error working out the next invoice reminder:', getErrorMessage(error))
      nextReminder = { line: 'The next automatic reminder could not be worked out', detail: 'Reload the page to try again.' }
    }

    const dated = (date: string | null, missing: string): string =>
      date ? formatInvoiceDate(date, { withYear: true }) : missing

    return {
      history: {
        nextReminder,
        crossCheck: [
          { label: 'Invoice emailed', value: dated(sentDate, 'No record') },
          { label: 'First reminder', value: dated(firstReminderDate, 'Not sent') },
          { label: 'Second reminder', value: dated(secondReminderDate, 'Not sent') },
        ],
        earlierEmailsNotRecorded: (sentDate ?? String(invoice.invoice_date ?? '').slice(0, 10)) < EMAIL_HISTORY_STARTS,
        emails: toInvoiceEmailHistory(emailRows.slice(0, EMAIL_HISTORY_LIMIT)),
        truncated: emailRows.length > EMAIL_HISTORY_LIMIT,
      },
    }
  } catch (error: unknown) {
    console.error('Error in getInvoiceEmailHistory:', getErrorMessage(error))
    return { error: 'The email history could not be loaded' }
  }
}
