'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.')
    return null
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

export async function getMessages() {
  console.log('=== Getting all messages ===')
  
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return { error: 'Failed to initialize database connection' }
  }
  
  // Get only inbound messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
  
  console.log('Messages query result:', { count: messages?.length, error: messagesError })
  
  if (messagesError) {
    console.error('Error fetching messages:', messagesError)
    return { error: messagesError.message }
  }
  
  if (!messages || messages.length === 0) {
    return { messages: [] }
  }
  
  // Get unique customer IDs
  const customerIds = [...new Set(messages.map(m => m.customer_id))]
  
  // Fetch customer details
  const { data: customers, error: customersError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .in('id', customerIds)
  
  if (customersError) {
    console.error('Error fetching customers:', customersError)
    return { error: customersError.message }
  }
  
  // Create a map of customers by ID
  const customerMap = new Map(customers?.map(c => [c.id, c]) || [])
  
  // Combine messages with customer data
  const messagesWithCustomers = messages.map(message => ({
    ...message,
    customer: customerMap.get(message.customer_id) || {
      id: message.customer_id,
      first_name: 'Unknown',
      last_name: '',
      mobile_number: ''
    }
  }))
  
  return { messages: messagesWithCustomers }
}

export async function getUnreadMessageCount() {
  console.log('=== Getting unread message count ===')
  
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return { count: 0 }
  }
  
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  console.log('Unread count result:', { count, error })
  
  if (error) {
    console.error('Error fetching unread count:', error)
    return { count: 0 }
  }
  
  return { count: count || 0 }
}

export async function markMessageAsRead(messageId: string) {
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    throw new Error('Failed to initialize database connection')
  }
  
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('direction', 'inbound')
  
  if (error) {
    console.error('Error marking message as read:', error)
    throw new Error(error.message)
  }
  
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
}

export async function markAllMessagesAsRead() {
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    throw new Error('Failed to initialize database connection')
  }
  
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error marking all messages as read:', error)
    throw new Error(error.message)
  }
  
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
}