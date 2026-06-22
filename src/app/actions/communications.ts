'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { CommunicationsService } from '@/services/communications'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'

async function currentAuditUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}

export async function linkUnmatchedCommunicationAction(formData: FormData) {
  const unmatchedId = String(formData.get('unmatchedId') ?? '').trim()
  const customerId = String(formData.get('customerId') ?? '').trim()
  const user = await currentAuditUser()
  const auditBase = {
    user_id: user?.id,
    ...(user?.email && { user_email: user.email }),
    resource_type: 'unmatched_communication',
    resource_id: unmatchedId || 'unknown',
  }

  if (!unmatchedId || !customerId) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Missing communication or customer',
    })
    return { error: 'Missing communication or customer' }
  }

  try {
    await CommunicationsService.linkUnmatchedCommunication(unmatchedId, customerId)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'success',
      new_values: {
        linked_customer_id: customerId,
        status: 'linked',
      },
    })
    revalidatePath('/messages')
    revalidatePath('/messages/holding')
    revalidatePath(`/customers/${customerId}`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to link communication'
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: message,
      new_values: { linked_customer_id: customerId },
    })
    return { error: message }
  }
}

export async function ignoreUnmatchedCommunicationAction(formData: FormData) {
  const unmatchedId = String(formData.get('unmatchedId') ?? '').trim()
  const user = await currentAuditUser()
  const auditBase = {
    user_id: user?.id,
    ...(user?.email && { user_email: user.email }),
    resource_type: 'unmatched_communication',
    resource_id: unmatchedId || 'unknown',
  }

  if (!unmatchedId) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Missing communication',
    })
    return { error: 'Missing communication' }
  }

  try {
    await CommunicationsService.ignoreUnmatchedCommunication(unmatchedId)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'success',
      new_values: { status: 'ignored' },
    })
    revalidatePath('/messages')
    revalidatePath('/messages/holding')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to ignore communication'
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: message,
    })
    return { error: message }
  }
}
