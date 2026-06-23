'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'
import { MessageService } from '@/services/messages'
import { ConsentService } from '@/services/consent'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export async function toggleCustomerSmsOptIn(customerId: string, optIn: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const hasPermission = await checkUserPermission('customers', 'manage_contact_preferences', user.id);

  const auditBase = {
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    resource_type: 'customer_sms',
    resource_id: customerId,
  } as const

  if (!hasPermission) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Insufficient permissions',
    })
    return { error: 'Insufficient permissions' }
  }

  try {
    const result = await ConsentService.toggleSmsServiceOptIn(customerId, optIn, user.id);

    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'success',
      old_values: result.oldValues,
      new_values: result.newValues,
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to update customer SMS preferences')
    console.error('Failed to update customer SMS opt-in:', error)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: message,
    })
    return { error: message }
  }
}

export async function toggleCustomerWhatsAppOptIn(customerId: string, optIn: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const hasPermission = await checkUserPermission('customers', 'manage_whatsapp_opt_in', user.id)

  const auditBase = {
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    resource_type: 'customer_whatsapp',
    resource_id: customerId,
  } as const

  if (!hasPermission) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Insufficient permissions',
    })
    return { error: 'Insufficient permissions' }
  }

  try {
    const result = await ConsentService.toggleWhatsAppServiceOptIn(customerId, optIn, user.id)

    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'success',
      old_values: result.oldValues,
      new_values: result.newValues,
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to update customer WhatsApp preferences')
    console.error('Failed to update customer WhatsApp opt-in:', error)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: message,
    })
    return { error: message }
  }
}

export async function getCustomerSmsStats(customerId: string) {
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getCustomerSmsStats(customerId);
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to load customer SMS stats') };
  }
}

export async function getCustomerMessages(customerId: string) {
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getCustomerMessages(customerId);
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to load customer messages') };
  }
}

function csvValue(value: unknown): string {
  if (value == null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function getCustomerConsentAudit(customerId: string) {
  const hasPermission = await checkUserPermission('messages', 'view_consent_audit')
  if (!hasPermission) {
    return { error: 'Insufficient permissions' }
  }

  try {
    return { data: await ConsentService.listCustomerConsents(customerId) }
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to load customer consent audit') }
  }
}

export async function exportCustomerConsentAudit(customerId: string) {
  const hasPermission = await checkUserPermission('messages', 'export_consent_audit')
  if (!hasPermission) {
    return { error: 'Insufficient permissions' }
  }

  try {
    const rows = await ConsentService.listCustomerConsents(customerId)
    const headers = [
      'captured_at',
      'channel',
      'purpose',
      'status',
      'legal_basis',
      'source',
      'capture_method',
      'consent_text_version',
      'related_entity_type',
      'related_entity_id',
      'metadata',
    ]
    const csv = [
      headers.join(','),
      ...rows.map((row: any) => headers.map((header) => csvValue(row?.[header])).join(',')),
    ].join('\n')

    return {
      data: csv,
      fileName: `customer-consent-audit-${customerId}.csv`,
    }
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to export customer consent audit') }
  }
}

export async function getDeliveryFailureReport() {
  const [canViewSmsHealth, canViewCustomers] = await Promise.all([
    checkUserPermission('sms_health', 'view'),
    checkUserPermission('customers', 'view'),
  ]);

  if (!canViewSmsHealth || !canViewCustomers) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getDeliveryFailureReport();
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to load delivery failure report') };
  }
}

export async function getSmsDeliveryStats() {
  const [canViewSmsHealth, canViewCustomers] = await Promise.all([
    checkUserPermission('sms_health', 'view'),
    checkUserPermission('customers', 'view'),
  ]);

  if (!canViewSmsHealth || !canViewCustomers) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getSmsDeliveryStats();
  } catch (error: unknown) {
    return { error: getErrorMessage(error, 'Failed to load SMS delivery stats') };
  }
}
