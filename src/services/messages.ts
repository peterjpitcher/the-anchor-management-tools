import { createAdminClient } from '@/lib/supabase/admin';
import { ensureReplyInstruction } from '@/lib/sms/support';
import { env } from '@/lib/env';
import { sendSMS } from '@/lib/twilio';
import { createHash } from 'crypto';

export class MessageService {
  static async getUnreadCounts(customerIds?: string[]) {
    const supabase = createAdminClient();

    const uniqueCustomerIds = customerIds
      ? Array.from(new Set(customerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
      : null;

    if (uniqueCustomerIds && uniqueCustomerIds.length === 0) {
      return {};
    }

    let query = supabase
      .from('messages')
      .select('customer_id')
      .eq('direction', 'inbound')
      .is('read_at', null);

    if (uniqueCustomerIds) {
      query = query.in('customer_id', uniqueCustomerIds);
    }

    const { data, error } = await query;
    
    if (error) {
      throw new Error('Failed to fetch unread counts');
    }
    
    // Count unread messages per customer
    const counts: Record<string, number> = {};
    data?.forEach(message => {
      counts[message.customer_id] = (counts[message.customer_id] || 0) + 1;
    });
    
    return counts;
  }

  static async getTotalUnreadCount() {
    const supabase = createAdminClient();
    
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .is('read_at', null);
    
    if (error) {
      throw new Error('Failed to fetch total unread count');
    }
    
    return count || 0;
  }

  static async markMessagesAsRead(customerId: string) {
    const supabase = createAdminClient();
    
    const { error } = await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('customer_id', customerId)
      .eq('direction', 'inbound')
      .is('read_at', null);
    
    if (error) {
      throw new Error('Failed to mark messages as read');
    }
  }

  static async sendReply(customerId: string, message: string) {
    const supabase = createAdminClient();
    
    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('first_name, last_name, mobile_number')
      .eq('id', customerId)
      .single();
    
    if (customerError || !customer) {
      throw new Error('Customer not found');
    }
    
    // Check if customer has opted out
    const { data: optInData, error: optInError } = await supabase
      .from('customers')
      .select('sms_opt_in')
      .eq('id', customerId)
      .single();
    
    if (optInError || !optInData?.sms_opt_in) {
      throw new Error('Customer has opted out of SMS messages');
    }
    
    const supportPhone = env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || env.TWILIO_PHONE_NUMBER || null;
    const messageWithSupport = ensureReplyInstruction(message, supportPhone);
    const messageStage = createHash('sha256').update(messageWithSupport).digest('hex').slice(0, 16);

    // Send SMS via enhanced sendSMS which handles logging
    const result = await sendSMS(customer.mobile_number, messageWithSupport, {
      customerId,
      metadata: {
        template_key: 'message_thread_reply',
        trigger_type: 'message_thread_reply',
        stage: messageStage,
        type: 'reply',
        source: 'message_thread'
      }
    });

    const smsCode = (result as any)?.code;
    const smsLogFailure = (result as any)?.logFailure === true || smsCode === 'logging_failed';

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to send SMS',
        code: smsCode,
        logFailure: smsLogFailure,
      };
    }
    
    return { 
      success: true, 
      messageSid: result.sid,
      status: result.status,
      code: smsCode,
      logFailure: smsLogFailure,
    };
  }

  static async getCustomerSmsStats(customerId: string) {
    const supabase = createAdminClient();

    // Get customer SMS status
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('sms_opt_in, sms_delivery_failures, last_sms_failure_reason, last_successful_sms_at, sms_deactivated_at, sms_deactivation_reason')
      .eq('id', customerId)
      .single();

    if (customerError) {
      throw new Error(customerError.message);
    }

    const [
      totalResult,
      deliveredResult,
      failedResult,
      recentMessagesResult
    ] = await Promise.all([
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .eq('direction', 'outbound'),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .eq('direction', 'outbound')
        .eq('twilio_status', 'delivered'),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .eq('direction', 'outbound')
        .in('twilio_status', ['failed', 'undelivered']),
      supabase
        .from('messages')
        .select('twilio_status, created_at')
        .eq('customer_id', customerId)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(10)
    ]);

    if (totalResult.error) {
      throw new Error(totalResult.error.message);
    }
    if (deliveredResult.error) {
      throw new Error(deliveredResult.error.message);
    }
    if (failedResult.error) {
      throw new Error(failedResult.error.message);
    }
    if (recentMessagesResult.error) {
      throw new Error(recentMessagesResult.error.message);
    }

    const totalMessages = totalResult.count || 0;
    const deliveredMessages = deliveredResult.count || 0;
    const failedMessages = failedResult.count || 0;
    const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0;

    return {
      customer,
      stats: {
        totalMessages,
        deliveredMessages,
        failedMessages,
        deliveryRate: deliveryRate.toFixed(1),
        recentMessages: recentMessagesResult.data || []
      }
    };
  }

  static async getCustomerMessages(customerId: string) {
    const supabase = createAdminClient();

    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return { messages: messages || [] };
  }

  static async getDeliveryFailureReport() {
    const supabase = createAdminClient();

    // Get customers with delivery failures
    const { data: customers, error } = await supabase
      .from('customers')
      .select('*, recent_messages:messages(twilio_status, error_code, error_message, created_at)')
      .or('sms_opt_in.eq.false,sms_delivery_failures.gt.0')
      .order('sms_delivery_failures', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return { customers: customers || [] };
  }

  static async getSmsDeliveryStats() {
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
      throw new Error(error.message);
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
      throw new Error(customerError.message);
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
}
