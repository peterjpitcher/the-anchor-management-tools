'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { sendEmail } from '@/lib/email/emailService'
import { revalidatePath } from 'next/cache'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Send a one-off email to a customer from their detail page.
 *
 * Mirrors the SMS reply permission gate (`messages.send_transactional` OR
 * `messages.manage`) and the audit pattern used elsewhere in customer actions.
 * The customer's email is looked up server-side; `sendEmail` handles the
 * suppression list and auto-logs the send to `email_messages` via `customerId`.
 */
export async function sendCustomerEmail(
  customerId: string,
  subject: string,
  body: string,
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const [canSend, canManage] = await Promise.all([
    checkUserPermission('messages', 'send_transactional', user.id),
    checkUserPermission('messages', 'manage', user.id),
  ])

  const auditBase = {
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    resource_type: 'customer_email',
    resource_id: customerId,
  } as const

  if (!canSend && !canManage) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'send',
      operation_status: 'failure',
      error_message: 'Insufficient permissions',
    })
    return { error: 'Insufficient permissions' }
  }

  const trimmedSubject = subject.trim()
  const trimmedBody = body.trim()

  if (!trimmedSubject) {
    return { error: 'Subject is required' }
  }

  if (!trimmedBody) {
    return { error: 'Message body is required' }
  }

  try {
    const admin = createAdminClient()
    const { data: customer, error: lookupError } = await admin
      .from('customers')
      .select('email, first_name, last_name')
      .eq('id', customerId)
      .single()

    if (lookupError) {
      throw lookupError
    }

    const customerEmail = customer?.email?.trim()
    if (!customerEmail) {
      await logAuditEvent({
        ...auditBase,
        operation_type: 'send',
        operation_status: 'failure',
        error_message: 'This customer has no email address on file',
      })
      return { error: 'This customer has no email address on file' }
    }

    const result = await sendEmail({
      to: customerEmail,
      subject: trimmedSubject,
      text: trimmedBody,
      customerId,
      commType: 'customer_direct',
    })

    if (!result.success) {
      const message = result.error ?? 'Failed to send email'
      await logAuditEvent({
        ...auditBase,
        operation_type: 'send',
        operation_status: 'failure',
        error_message: message,
      })
      return { error: message }
    }

    await logAuditEvent({
      ...auditBase,
      operation_type: 'send',
      operation_status: 'success',
      new_values: { subject: trimmedSubject, message_id: result.messageId ?? null },
    })

    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to send email')
    console.error('Failed to send customer email:', error)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'send',
      operation_status: 'failure',
      error_message: message,
    })
    return { error: message }
  }
}
