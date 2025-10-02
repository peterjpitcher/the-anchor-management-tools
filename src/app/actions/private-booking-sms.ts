'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendSms } from './sms'

// Function to automatically send private booking SMS
export async function sendPrivateBookingSms(
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
  ]
  
  if (!autoSendTriggers.includes(triggerType)) {
    console.log(`[sendPrivateBookingSms] Trigger type ${triggerType} requires manual approval`)
    return { requiresApproval: true }
  }
  
  try {
    const admin = createAdminClient()

    // Look up customer for logging
    const { data: booking } = await admin
      .from('private_bookings')
      .select('customer_id')
      .eq('id', bookingId)
      .single()

    // Send the SMS immediately
    const result = await sendSms({
      to: phone,
      body: messageBody,
      bookingId: bookingId,
      customerId: booking?.customer_id || undefined
    })
    
    if (result.error) {
      console.error('[sendPrivateBookingSms] Failed to send SMS:', result.error)
      return { error: result.error }
    }
    
    console.log(`[sendPrivateBookingSms] Successfully sent ${triggerType} SMS for booking ${bookingId}`)
    return {
      success: true,
      sid: result.sid,
      sent: true,
      messageId: result.messageId,
      customerId: result.customerId
    }
  } catch (error) {
    console.error('[sendPrivateBookingSms] Exception sending SMS:', error)
    return { error: 'Failed to send SMS' }
  }
}

// Function to queue and auto-send private booking SMS
export async function queueAndSendPrivateBookingSms(data: {
  booking_id: string
  trigger_type: string
  template_key: string
  message_body: string
  customer_phone: string
  customer_name: string
  created_by?: string
  priority?: number
  metadata?: any
}) {
  const supabase = await createClient()
  
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
    .single()
  
  if (insertError) {
    console.error('[queueAndSendPrivateBookingSms] Failed to queue SMS:', insertError)
    return { error: insertError.message }
  }
  
  // Auto-send for specific triggers
  const autoSendResult = await sendPrivateBookingSms(
    data.booking_id,
    data.trigger_type,
    data.customer_phone,
    data.message_body
  )
  
  if (autoSendResult.sent && autoSendResult.sid) {
    const mergedMetadata = {
      ...(smsRecord.metadata ?? {}),
      ...(autoSendResult.customerId ? { customer_id: autoSendResult.customerId } : {}),
      ...(autoSendResult.messageId ? { message_id: autoSendResult.messageId } : {})
    }

    // Update the queue record with sent status
    await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        twilio_message_sid: autoSendResult.sid,
        metadata: mergedMetadata
      })
      .eq('id', smsRecord.id)
    
    return { 
      success: true, 
      sent: true,
      queueId: smsRecord.id,
      sid: autoSendResult.sid,
      messageId: autoSendResult.messageId
    }
  } else if (autoSendResult.requiresApproval) {
    // Message requires manual approval
    return { 
      success: true, 
      requiresApproval: true,
      queueId: smsRecord.id
    }
  } else {
    // Failed to send
    await supabase
      .from('private_booking_sms_queue')
      .update({
        status: 'failed',
        error_message: autoSendResult.error || 'Failed to send'
      })
      .eq('id', smsRecord.id)
    
    return { 
      error: autoSendResult.error || 'Failed to send SMS',
      queueId: smsRecord.id
    }
  }
}
