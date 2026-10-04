'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { getErrorMessage } from '@/lib/errors'
import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils'

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
