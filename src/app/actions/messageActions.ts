'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

export async function getUnreadMessageCounts() {
  const supabase = getSupabaseAdminClient()
  
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
  const supabase = getSupabaseAdminClient()
  
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error fetching total unread count:', error)
    return 0
  }
  
  return count || 0
}

export async function markMessagesAsRead(customerId: string) {
  const supabase = getSupabaseAdminClient()
  
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
  const supabase = getSupabaseAdminClient()
  
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
  
  // Send SMS via Twilio
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return { error: 'SMS service not configured' }
  }

  try {
    const twilio = (await import('twilio')).default
    const client = twilio(accountSid, authToken)
    
    const twilioMessage = await client.messages.create({
      body: message,
      from: fromNumber,
      to: customer.mobile_number
    })
    
    // Calculate segments and cost
    const messageLength = message.length
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
    const costUsd = segments * 0.04 // Approximate UK SMS cost per segment
    
    // Save the message to database
    const { error: saveError } = await supabase
      .from('messages')
      .insert({
        customer_id: customerId,
        direction: 'outbound',
        message_sid: twilioMessage.sid,
        twilio_message_sid: twilioMessage.sid,
        body: message,
        status: twilioMessage.status,
        twilio_status: twilioMessage.status,
        from_number: fromNumber,
        to_number: customer.mobile_number,
        message_type: 'sms',
        segments: segments,
        cost_usd: costUsd,
        created_at: new Date().toISOString(),
        read_at: new Date().toISOString() // Mark outbound as read
      })
    
    if (saveError) {
      console.error('Failed to save outbound message:', saveError)
    }
    
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