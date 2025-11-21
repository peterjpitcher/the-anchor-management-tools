import { createAdminClient } from '@/lib/supabase/admin';
import { ensureReplyInstruction } from '@/lib/sms/support';
import { recordOutboundSmsMessage } from '@/lib/sms/logging';
import { mapTwilioStatus } from '@/lib/sms-status';
import { env, TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD } from '@/lib/env';
import twilio from 'twilio';

export class MessageService {
  static async getUnreadCounts() {
    const supabase = createAdminClient();
    
    const { data, error } = await supabase
      .from('messages')
      .select('customer_id')
      .eq('direction', 'inbound')
      .is('read_at', null);
    
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
      .select('*', { count: 'exact', head: true })
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
    
    // Send SMS via Twilio
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const fromNumber = env.TWILIO_PHONE_NUMBER;
    const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
    const statusCallback = TWILIO_STATUS_CALLBACK;
    const statusCallbackMethod = TWILIO_STATUS_CALLBACK_METHOD;

    if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
      throw new Error('SMS service not configured');
    }

    const client = twilio(accountSid, authToken);
    
    const supportPhone = env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || env.TWILIO_PHONE_NUMBER || null;
    const messageWithSupport = ensureReplyInstruction(message, supportPhone);

    // Build message parameters with status callback
    const messageParams: any = {
      body: messageWithSupport,
      to: customer.mobile_number,
      statusCallback: statusCallback,
      statusCallbackMethod: statusCallbackMethod,
    };
    
    // Use messaging service if configured, otherwise use from number
    if (messagingServiceSid) {
      messageParams.messagingServiceSid = messagingServiceSid;
    } else {
      messageParams.from = fromNumber;
    }
    
    const twilioMessage = await client.messages.create(messageParams);
    const resolvedFromNumber = twilioMessage.from || fromNumber || '';
    
    await recordOutboundSmsMessage({
      supabase,
      customerId,
      to: customer.mobile_number,
      body: messageWithSupport,
      sid: twilioMessage.sid,
      fromNumber: resolvedFromNumber,
      status: mapTwilioStatus(twilioMessage.status),
      twilioStatus: twilioMessage.status,
      sentAt: twilioMessage.status === 'sent' ? new Date().toISOString() : null,
      readAt: new Date().toISOString()
    });
    
    return { 
      success: true, 
      messageSid: twilioMessage.sid,
      status: twilioMessage.status 
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

    // Get message statistics
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('twilio_status, created_at')
      .eq('customer_id', customerId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false });

    if (messagesError) {
      throw new Error(messagesError.message);
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
