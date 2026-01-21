import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/app/actions/sms';

export type QueueSmsInput = {
  booking_id: string;
  trigger_type: string;
  template_key: string;
  message_body: string;
  customer_phone?: string | null;
  customer_name: string;
  customer_id?: string;
  created_by?: string;
  priority?: number;
  metadata?: any;
};

export class SmsQueueService {
  private static async resolvePrivateBookingRecipientPhone(
    supabase: ReturnType<typeof createAdminClient>,
    data: QueueSmsInput
  ): Promise<{ phone: string | null; customerId?: string }> {
    const directPhone = data.customer_phone?.trim();
    if (directPhone) {
      return { phone: directPhone, customerId: data.customer_id };
    }

    let customerId = data.customer_id;

    const { data: booking, error: bookingError } = await supabase
      .from('private_bookings')
      .select('contact_phone, customer_id')
      .eq('id', data.booking_id)
      .maybeSingle();

    if (bookingError) {
      console.error('[SmsQueueService] Failed to resolve booking phone:', bookingError);
    }

    const bookingPhone = booking?.contact_phone?.trim();
    if (bookingPhone) {
      return { phone: bookingPhone, customerId: customerId ?? booking?.customer_id ?? undefined };
    }

    customerId = customerId ?? booking?.customer_id ?? undefined;
    if (!customerId) {
      return { phone: null, customerId };
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('mobile_number')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) {
      console.error('[SmsQueueService] Failed to resolve customer phone:', customerError);
    }

    const customerPhone = customer?.mobile_number?.trim();
    return { phone: customerPhone || null, customerId };
  }

  // Function to automatically send private booking SMS
  static async sendPrivateBookingSms(
    bookingId: string,
    triggerType: string,
    phone: string,
    messageBody: string,
    customerId?: string
  ) {
    // Only auto-send for specific trigger types
    const autoSendTriggers = [
      'booking_created',
      'deposit_received', 
      'final_payment_received',
      'payment_received',
      'booking_confirmed',
      'booking_completed',
      'date_changed',
      'booking_cancelled',
      'booking_expired',
      'deposit_reminder_7day',
      'deposit_reminder_1day',
      'balance_reminder_14day',
      'event_reminder_1d',
      'setup_reminder',
      'manual'
    ];
    
    if (!autoSendTriggers.includes(triggerType)) {
      console.log(`[SmsQueueService] Trigger type ${triggerType} requires manual approval`);
      return { requiresApproval: true };
    }
    
    try {
      let resolvedCustomerId = customerId;

      // If no customerId provided, look it up
      if (!resolvedCustomerId) {
        const admin = createAdminClient();
        const { data: booking } = await admin
          .from('private_bookings')
          .select('customer_id')
          .eq('id', bookingId)
          .single();
        resolvedCustomerId = booking?.customer_id || undefined;
      }

      // Send the SMS immediately
      const result = await sendSms({
        to: phone,
        body: messageBody,
        bookingId: bookingId,
        customerId: resolvedCustomerId
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
    const supabase = createAdminClient();

    const { phone: resolvedPhone, customerId: resolvedCustomerId } =
      await SmsQueueService.resolvePrivateBookingRecipientPhone(supabase, data);

    if (!resolvedPhone) {
      console.error('[SmsQueueService] No phone number available for SMS', {
        bookingId: data.booking_id,
        triggerType: data.trigger_type
      });
      return { error: 'No phone number available for SMS' };
    }
    
    // Insert into queue for record keeping
    const { data: smsRecord, error: insertError } = await supabase
      .from('private_booking_sms_queue')
      .insert({
        booking_id: data.booking_id,
        trigger_type: data.trigger_type,
        template_key: data.template_key,
        scheduled_for: new Date().toISOString(),
        message_body: data.message_body,
        customer_phone: resolvedPhone,
        customer_name: data.customer_name,
        recipient_phone: resolvedPhone,
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
      resolvedPhone,
      data.message_body,
      resolvedCustomerId
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
      
      // Log to audit trail
      const admin = createAdminClient();
      await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_sent',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: data.customer_phone,
          sid: autoSendResult.sid
        },
        performed_by: data.created_by || null, // System if undefined
      });

      return { 
        success: true, 
        sent: true,
        queueId: smsRecord.id,
        sid: autoSendResult.sid,
        messageId: autoSendResult.messageId
      };
    } else if (autoSendResult.requiresApproval) {
      // Message requires manual approval
      
      // Log to audit trail
      const admin = createAdminClient();
      await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_queued',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: data.customer_phone
        },
        performed_by: data.created_by || null,
      });

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
      
      // Log to audit trail
      const admin = createAdminClient();
      await admin.from('private_booking_audit').insert({
        booking_id: data.booking_id,
        action: 'sms_failed',
        field_name: 'sms',
        new_value: data.template_key,
        metadata: {
          trigger: data.trigger_type,
          message: data.message_body,
          recipient: data.customer_phone,
          error: autoSendResult.error
        },
        performed_by: data.created_by || null,
      });

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
      
      // Log to audit trail
      await admin.from('private_booking_audit').insert({
        booking_id: sms.booking_id,
        action: 'sms_failed',
        field_name: 'sms',
        new_value: sms.template_key,
        metadata: {
          trigger: sms.trigger_type,
          message: sms.message_body,
          recipient: sms.recipient_phone,
          error: result.error,
          queue_id: smsId
        },
        performed_by: sms.approved_by || null,
      });

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
    
    // Log to audit trail
    await admin.from('private_booking_audit').insert({
      booking_id: sms.booking_id,
      action: 'sms_sent',
      field_name: 'sms',
      new_value: sms.template_key,
      metadata: {
        trigger: sms.trigger_type,
        message: sms.message_body,
        recipient: sms.recipient_phone,
        sid: result.sid,
        queue_id: smsId
      },
      performed_by: sms.approved_by || null,
    });

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
