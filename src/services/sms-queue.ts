import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/app/actions/sms';

export type QueueSmsInput = {
  booking_id: string;
  trigger_type: string;
  template_key: string;
  message_body: string;
  customer_phone: string;
  customer_name: string;
  created_by?: string;
  priority?: number;
  metadata?: any;
};

export class SmsQueueService {
  // Function to automatically send private booking SMS
  static async sendPrivateBookingSms(
    bookingId: string,
    triggerType: string,
    phone: string,
    messageBody: string
  ) {
    // Only auto-send for specific trigger types
    const autoSendTriggers = [
      'booking_created',
      'deposit_received', 
      'final_payment_received',
      'payment_received',
      'booking_confirmed',
      'date_changed'
    ];
    
    if (!autoSendTriggers.includes(triggerType)) {
      console.log(`[SmsQueueService] Trigger type ${triggerType} requires manual approval`);
      return { requiresApproval: true };
    }
    
    try {
      const admin = createAdminClient();

      // Look up customer for logging
      const { data: booking } = await admin
        .from('private_bookings')
        .select('customer_id')
        .eq('id', bookingId)
        .single();

      // Send the SMS immediately
      const result = await sendSms({
        to: phone,
        body: messageBody,
        bookingId: bookingId,
        customerId: booking?.customer_id || undefined
      });
      
      if (result.error) {
        console.error('[SmsQueueService] Failed to send SMS:', result.error);
        return { error: result.error };
      }
      
      console.log(`[SmsQueueService] Successfully sent ${triggerType} SMS for booking ${bookingId}`);
      return {
        success: true,
        sid: result.sid,
        sent: true,
        messageId: result.messageId,
        customerId: result.customerId
      };
    } catch (error) {
      console.error('[SmsQueueService] Exception sending SMS:', error);
      return { error: 'Failed to send SMS' };
    }
  }

  // Function to queue and auto-send private booking SMS
  static async queueAndSend(data: QueueSmsInput) {
    const supabase = await createClient();
    
    // Insert into queue for record keeping
    const { data: smsRecord, error: insertError } = await supabase
      .from('private_booking_sms_queue')
      .insert({
        booking_id: data.booking_id,
        trigger_type: data.trigger_type,
        template_key: data.template_key,
        scheduled_for: new Date().toISOString(),
        message_body: data.message_body,
        customer_phone: data.customer_phone,
        customer_name: data.customer_name,
        recipient_phone: data.customer_phone,
        status: 'pending',
        created_by: data.created_by,
        priority: data.priority || 2,
        metadata: data.metadata || {}
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('[SmsQueueService] Failed to queue SMS:', insertError);
      return { error: insertError.message };
    }
    
    // Auto-send for specific triggers
    const autoSendResult = await SmsQueueService.sendPrivateBookingSms(
      data.booking_id,
      data.trigger_type,
      data.customer_phone,
      data.message_body
    );
    
    if (autoSendResult.sent && autoSendResult.sid) {
      const mergedMetadata = {
        ...(smsRecord.metadata ?? {}),
        ...(autoSendResult.customerId ? { customer_id: autoSendResult.customerId } : {}),
        ...(autoSendResult.messageId ? { message_id: autoSendResult.messageId } : {})
      };

      // Update the queue record with sent status
      await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          twilio_message_sid: autoSendResult.sid,
          metadata: mergedMetadata
        })
        .eq('id', smsRecord.id);
      
      return { 
        success: true, 
        sent: true,
        queueId: smsRecord.id,
        sid: autoSendResult.sid,
        messageId: autoSendResult.messageId
      };
    } else if (autoSendResult.requiresApproval) {
      // Message requires manual approval
      return { 
        success: true, 
        requiresApproval: true,
        queueId: smsRecord.id
      };
    } else {
      // Failed to send
      await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'failed',
          error_message: autoSendResult.error || 'Failed to send'
        })
        .eq('id', smsRecord.id);
      
      return { 
        error: autoSendResult.error || 'Failed to send SMS',
        queueId: smsRecord.id
      };
    }
  }

  static async approveSms(smsId: string, userId: string) {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId
      })
      .eq('id', smsId)
      .eq('status', 'pending');
    
    if (error) {
      console.error('Error approving SMS:', error);
      throw new Error(error.message || 'Failed to approve SMS');
    }
    
    return { success: true };
  }

  static async rejectSms(smsId: string, userId: string) {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'cancelled',
        approved_at: new Date().toISOString(),
        approved_by: userId
      })
      .eq('id', smsId)
      .eq('status', 'pending');
    
    if (error) {
      console.error('Error rejecting SMS:', error);
      throw new Error(error.message || 'Failed to reject SMS');
    }
    
    return { success: true };
  }

  static async sendApprovedSms(smsId: string) {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Get the SMS details
    const { data: sms, error: fetchError } = await supabase
      .from('private_booking_sms_queue')
      .select('*')
      .eq('id', smsId)
      .eq('status', 'approved')
      .single();
    
    if (fetchError || !sms) {
      console.error('Error fetching SMS:', fetchError);
      throw new Error('SMS not found or not approved');
    }
    
    // Look up the booking to capture customer id for logging
    const { data: booking } = await admin
      .from('private_bookings')
      .select('customer_id')
      .eq('id', sms.booking_id)
      .single();

    // Send the SMS
    const result = await sendSms({
      to: sms.recipient_phone,
      body: sms.message_body,
      bookingId: sms.booking_id,
      customerId: booking?.customer_id || undefined
    });
    
    if (result.error) {
      // Update status to failed
      await supabase
        .from('private_booking_sms_queue')
        .update({
          status: 'failed',
          sent_at: new Date().toISOString(),
          error_message: result.error
        })
        .eq('id', smsId);
      
      throw new Error(result.error);
    }
    
    // Update status to sent
    const updatedMetadata = {
      ...(sms.metadata ?? {}),
      ...(result.customerId ? { customer_id: result.customerId } : {}),
      ...(result.messageId ? { message_id: result.messageId } : {})
    };

    await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        twilio_message_sid: result.sid as string,
        metadata: updatedMetadata
      })
      .eq('id', smsId);
    
    return { success: true };
  }

  static async getQueue(statusFilter?: string[]) {
    const supabase = await createClient();
    
    let query = supabase
      .from('private_booking_sms_queue')
      .select(`
        *,
        booking:private_bookings(
          id,
          customer_name,
          customer_first_name,
          customer_last_name,
          event_date,
          event_type,
          status
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter && statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching SMS queue:', error);
      throw new Error(error.message || 'Failed to fetch SMS queue');
    }

    return data;
  }
}
