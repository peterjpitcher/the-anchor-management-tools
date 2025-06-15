'use server'

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function toggleCustomerSmsOptIn(customerId: string, optIn: boolean) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { error: 'Failed to initialize database connection' };
  }

  const updateData: any = {
    sms_opt_in: optIn
  };

  // If reactivating SMS, reset failure counts
  if (optIn) {
    updateData.sms_delivery_failures = 0;
    updateData.sms_deactivated_at = null;
    updateData.sms_deactivation_reason = null;
  }

  const { error } = await supabase
    .from('customers')
    .update(updateData)
    .eq('id', customerId);

  if (error) {
    console.error('Failed to update customer SMS opt-in:', error);
    return { error: error.message };
  }

  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  return { success: true };
}

export async function getCustomerSmsStats(customerId: string) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { error: 'Failed to initialize database connection' };
  }

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
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { error: 'Failed to initialize database connection' };
  }

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
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { error: 'Failed to initialize database connection' };
  }

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
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { error: 'Failed to initialize database connection' };
  }

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