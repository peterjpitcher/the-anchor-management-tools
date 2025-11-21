'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'
import { CustomerService } from '@/services/customers'
import { MessageService } from '@/services/messages'

export async function toggleCustomerSmsOptIn(customerId: string, optIn: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Verify permissions manually as per original logic or use checkUserPermission
  // Original used rpc 'user_has_permission'. We can use our helper if it does the same.
  // Sticking to the pattern of other actions:
  const hasPermission = await checkUserPermission('customers', 'edit', user.id);

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
    const result = await CustomerService.toggleSmsOptIn(customerId, optIn);

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
  } catch (error: any) {
    console.error('Failed to update customer SMS opt-in:', error)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: error.message || 'Failed to update',
    })
    return { error: error.message || 'Failed to update customer SMS preferences' }
  }
}

export async function getCustomerSmsStats(customerId: string) {
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getCustomerSmsStats(customerId);
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getCustomerMessages(customerId: string) {
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  try {
    return await MessageService.getCustomerMessages(customerId);
  } catch (error: any) {
    return { error: error.message };
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
  } catch (error: any) {
    return { error: error.message };
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
  } catch (error: any) {
    return { error: error.message };
  }
}