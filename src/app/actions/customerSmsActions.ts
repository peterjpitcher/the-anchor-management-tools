'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'

export async function toggleCustomerSmsOptIn(customerId: string, optIn: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data: permissionGranted, error: permissionError } = await admin.rpc(
    'user_has_permission',
    {
      p_user_id: user.id,
      p_module_name: 'customers',
      p_action: 'edit',
    },
  )

  const auditBase = {
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    resource_type: 'customer_sms',
    resource_id: customerId,
  } as const

  if (permissionError) {
    console.error('Failed to verify customer SMS permissions:', permissionError)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Failed to verify permissions',
    })
    return { error: 'Failed to verify permissions' }
  }

  if (permissionGranted !== true) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Insufficient permissions',
    })
    return { error: 'Insufficient permissions' }
  }

  const { data: customer, error: fetchError } = await admin
    .from('customers')
    .select(
      'id, sms_opt_in, sms_delivery_failures, sms_deactivated_at, sms_deactivation_reason',
    )
    .eq('id', customerId)
    .maybeSingle()

  if (fetchError) {
    console.error('Failed to load customer before SMS update:', fetchError)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Failed to load customer',
    })
    return { error: 'Failed to load customer' }
  }

  if (!customer) {
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: 'Customer not found',
    })
    return { error: 'Customer not found' }
  }

  const updateData: Record<string, any> = {
    sms_opt_in: optIn,
  }

  if (optIn) {
    updateData.sms_delivery_failures = 0
    updateData.sms_deactivated_at = null
    updateData.sms_deactivation_reason = null
  }

  const { error: updateError } = await admin
    .from('customers')
    .update(updateData)
    .eq('id', customerId)

  if (updateError) {
    console.error('Failed to update customer SMS opt-in:', updateError)
    await logAuditEvent({
      ...auditBase,
      operation_type: 'update',
      operation_status: 'failure',
      error_message: updateError.message,
    })
    return { error: 'Failed to update customer SMS preferences' }
  }

  await logAuditEvent({
    ...auditBase,
    operation_type: 'update',
    operation_status: 'success',
    old_values: {
      sms_opt_in: customer.sms_opt_in,
      sms_delivery_failures: customer.sms_delivery_failures,
      sms_deactivated_at: customer.sms_deactivated_at,
      sms_deactivation_reason: customer.sms_deactivation_reason,
    },
    new_values: {
      sms_opt_in: optIn,
      sms_delivery_failures: updateData.sms_delivery_failures ?? customer.sms_delivery_failures,
      sms_deactivated_at: updateData.sms_deactivated_at ?? customer.sms_deactivated_at,
      sms_deactivation_reason:
        updateData.sms_deactivation_reason ?? customer.sms_deactivation_reason,
    },
  })

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  return { success: true }
}

export async function getCustomerSmsStats(customerId: string) {
  // Check permission
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  const supabase = createAdminClient();

  // Get customer SMS status
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('sms_opt_in, sms_delivery_failures, last_sms_failure_reason, last_successful_sms_at, sms_deactivated_at, sms_deactivation_reason')
    .eq('id', customerId)
    .single();

  if (customerError) {
    return { error: customerError.message };
  }

  // Get message statistics
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('twilio_status, created_at')
    .eq('customer_id', customerId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false });

  if (messagesError) {
    return { error: messagesError.message };
  }

  // Calculate statistics
  const totalMessages = messages?.length || 0;
  const deliveredMessages = messages?.filter(m => m.twilio_status === 'delivered').length || 0;
  const failedMessages = messages?.filter(m => m.twilio_status === 'failed' || m.twilio_status === 'undelivered').length || 0;
  const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0;

  return {
    customer,
    stats: {
      totalMessages,
      deliveredMessages,
      failedMessages,
      deliveryRate: deliveryRate.toFixed(1),
      recentMessages: messages?.slice(0, 10) || []
    }
  };
}

export async function getCustomerMessages(customerId: string) {
  const hasPermission = await checkUserPermission('customers', 'view');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }

  const supabase = createAdminClient();

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true });

  if (error) {
    return { error: error.message };
  }

  return { messages: messages || [] };
}

export async function getDeliveryFailureReport() {
  const [canViewSmsHealth, canViewCustomers] = await Promise.all([
    checkUserPermission('sms_health', 'view'),
    checkUserPermission('customers', 'view'),
  ]);

  if (!canViewSmsHealth || !canViewCustomers) {
    return { error: 'Insufficient permissions' };
  }

  const supabase = createAdminClient();

  // Get customers with delivery failures
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*, recent_messages:messages(twilio_status, error_code, error_message, created_at)')
    .or('sms_opt_in.eq.false,sms_delivery_failures.gt.0')
    .order('sms_delivery_failures', { ascending: false });

  if (error) {
    return { error: error.message };
  }

  return { customers: customers || [] };
}

export async function getSmsDeliveryStats() {
  const [canViewSmsHealth, canViewCustomers] = await Promise.all([
    checkUserPermission('sms_health', 'view'),
    checkUserPermission('customers', 'view'),
  ]);

  if (!canViewSmsHealth || !canViewCustomers) {
    return { error: 'Insufficient permissions' };
  }

  const supabase = createAdminClient();

  // Get overall message statistics for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: messages, error } = await supabase
    .from('messages')
    .select('twilio_status, price, created_at')
    .eq('direction', 'outbound')
    .gte('created_at', thirtyDaysAgo.toISOString());

  if (error) {
    return { error: error.message };
  }

  // Calculate statistics
  const totalMessages = messages?.length || 0;
  const statusCounts = messages?.reduce((acc: Record<string, number>, msg) => {
    const status = msg.twilio_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {}) || {};

  const totalCost = messages?.reduce((sum, msg) => sum + (msg.price || 0), 0) || 0;

  // Get active vs inactive customers
  const { data: customerStats, error: customerError } = await supabase
    .from('customers')
    .select('sms_opt_in');

  if (customerError) {
    return { error: customerError.message };
  }

  const activeCustomers = customerStats?.filter(c => c.sms_opt_in).length || 0;
  const inactiveCustomers = customerStats?.filter(c => !c.sms_opt_in).length || 0;

  return {
    messages: {
      total: totalMessages,
      byStatus: statusCounts,
      totalCost: totalCost.toFixed(2),
      deliveryRate: totalMessages > 0 ? ((statusCounts.delivered || 0) / totalMessages * 100).toFixed(1) : '0'
    },
    customers: {
      active: activeCustomers,
      inactive: inactiveCustomers,
      total: activeCustomers + inactiveCustomers
    }
  };
}
