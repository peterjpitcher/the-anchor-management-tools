'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { sendSms } from '@/app/actions/sms'

type FailedMessageRow = {
  id: string
  customer_id: string
  to_number: string | null
  body: string
  status: string
  template_key: string | null
}

async function requireSmsFailureManage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const canManageSettings = await checkUserPermission('settings', 'manage')
  if (!canManageSettings) return { error: 'Permission denied' }
  return { admin: createAdminClient(), user }
}

async function loadFailedMessage(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data, error } = await admin
    .from('messages')
    .select('id, customer_id, to_number, body, status, template_key')
    .eq('id', id)
    .maybeSingle()

  if (error) return { error: 'Failed to load message' }
  if (!data || data.status !== 'failed') return { error: 'Failed message not found' }
  return { message: data as FailedMessageRow }
}

export async function retrySmsFailure(messageId: string): Promise<{ success?: boolean; error?: string }> {
  const permission = await requireSmsFailureManage()
  if ('error' in permission) return { error: permission.error }

  const loaded = await loadFailedMessage(permission.admin, messageId)
  if ('error' in loaded) return { error: loaded.error }

  const message = loaded.message
  if (!message.to_number) return { error: 'Message has no recipient number' }

  const result = await sendSms({
    to: message.to_number,
    body: message.body,
    customerId: message.customer_id,
    templateKey: message.template_key || 'sms_failure_retry',
    triggerType: 'sms_failure_retry',
    metadata: {
      retry_of_message_id: message.id,
      source: 'settings_sms_failures',
    },
  })

  if (result.error) return { error: result.error }

  const { error: updateError } = await permission.admin
    .from('messages')
    .update({
      status: 'retried',
      twilio_status: 'retried',
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', message.id)
    .eq('status', 'failed')

  if (updateError) return { error: 'SMS retried but the failure row could not be updated' }

  await logAuditEvent({
    user_id: permission.user.id,
    ...(permission.user.email && { user_email: permission.user.email }),
    operation_type: 'update',
    resource_type: 'sms_failure',
    resource_id: message.id,
    operation_status: 'success',
    additional_info: {
      action: 'retry',
      retried_message_sid: result.sid ?? null,
    },
  })

  revalidatePath('/settings/sms-failures')
  return { success: true }
}

export async function dismissSmsFailure(messageId: string): Promise<{ success?: boolean; error?: string }> {
  const permission = await requireSmsFailureManage()
  if ('error' in permission) return { error: permission.error }

  const loaded = await loadFailedMessage(permission.admin, messageId)
  if ('error' in loaded) return { error: loaded.error }

  const { error } = await permission.admin
    .from('messages')
    .update({
      status: 'dismissed',
      twilio_status: 'dismissed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', messageId)
    .eq('status', 'failed')

  if (error) return { error: 'Failed to dismiss SMS failure' }

  await logAuditEvent({
    user_id: permission.user.id,
    ...(permission.user.email && { user_email: permission.user.email }),
    operation_type: 'update',
    resource_type: 'sms_failure',
    resource_id: messageId,
    operation_status: 'success',
    additional_info: { action: 'dismiss' },
  })

  revalidatePath('/settings/sms-failures')
  return { success: true }
}

export async function retrySmsFailureFromForm(formData: FormData) {
  const messageId = String(formData.get('message_id') || '')
  if (messageId) await retrySmsFailure(messageId)
}

export async function dismissSmsFailureFromForm(formData: FormData) {
  const messageId = String(formData.get('message_id') || '')
  if (messageId) await dismissSmsFailure(messageId)
}
