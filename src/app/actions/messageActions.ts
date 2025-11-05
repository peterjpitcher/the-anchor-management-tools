'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from './rbac'
import { revalidatePath } from 'next/cache'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { recordOutboundSmsMessage } from '@/lib/sms/logging'

export async function getUnreadMessageCounts() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return {}
  }

  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('messages')
    .select('customer_id')
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error fetching unread counts:', error)
    return {}
  }
  
  // Count unread messages per customer
  const counts: Record<string, number> = {}
  data?.forEach(message => {
    counts[message.customer_id] = (counts[message.customer_id] || 0) + 1
  })
  
  return counts
}

export async function getTotalUnreadCount() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return 0
  }

  const supabase = createAdminClient()
  
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error fetching total unread badge: ', error)
    return 0
  }
  
  return count || 0
}

export async function markMessagesAsRead(customerId: string) {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const supabase = createAdminClient()
  
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error marking messages as read:', error)
    return { error: error.message }
  }
  
  // Revalidate all relevant pages
  revalidatePath('/messages')
  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/', 'layout') // This revalidates the navigation with unread counts
  
  return { success: true }
}

export async function sendSmsReply(customerId: string, message: string) {
  const hasSendPermission =
    (await checkUserPermission('messages', 'send')) ||
    (await checkUserPermission('messages', 'manage'))

  if (!hasSendPermission) {
    return { error: 'Insufficient permissions' }
  }

  const supabase = createAdminClient()
  
  // Get customer details
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('first_name, last_name, mobile_number')
    .eq('id', customerId)
    .single()
  
  if (customerError || !customer) {
    return { error: 'Customer not found' }
  }
  
  // Check if customer has opted out
  const { data: optInData, error: optInError } = await supabase
    .from('customers')
    .select('sms_opt_in')
    .eq('id', customerId)
    .single()
  
  if (optInError || !optInData?.sms_opt_in) {
    return { error: 'Customer has opted out of SMS messages' }
  }
  
  // Import environment and status helpers
  const { TWILIO_STATUS_CALLBACK, TWILIO_STATUS_CALLBACK_METHOD, env } = await import('@/lib/env')
  const { mapTwilioStatus } = await import('@/lib/sms-status')
  
  // Send SMS via Twilio
  const accountSid = env.TWILIO_ACCOUNT_SID
  const authToken = env.TWILIO_AUTH_TOKEN
  const fromNumber = env.TWILIO_PHONE_NUMBER
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID

  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    return { error: 'SMS service not configured' }
  }

  try {
    const twilio = (await import('twilio')).default
    const client = twilio(accountSid, authToken)
    
    const supportPhone = env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || env.TWILIO_PHONE_NUMBER || null
    const messageWithSupport = ensureReplyInstruction(message, supportPhone)

    // Build message parameters with status callback
    const messageParams: any = {
      body: messageWithSupport,
      to: customer.mobile_number,
      statusCallback: TWILIO_STATUS_CALLBACK,
      statusCallbackMethod: TWILIO_STATUS_CALLBACK_METHOD,
    }
    
    // Use messaging service if configured, otherwise use from number
    if (messagingServiceSid) {
      messageParams.messagingServiceSid = messagingServiceSid
    } else {
      messageParams.from = fromNumber
    }
    
    const twilioMessage = await client.messages.create(messageParams)

    const resolvedFromNumber = twilioMessage.from || fromNumber || ''
    
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
    })
    
    return { 
      success: true, 
      messageSid: twilioMessage.sid,
      status: twilioMessage.status 
    }
    
  } catch (error) {
    console.error('Failed to send SMS:', error)
    return { error: error instanceof Error ? error.message : 'Failed to send message' }
  }
}
