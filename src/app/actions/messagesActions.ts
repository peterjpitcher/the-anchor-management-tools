'use server'

import { supabase } from '@/lib/supabase'
import { revalidatePath } from 'next/cache'

export async function getMessages() {
  // First get all messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
  
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
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error fetching unread count:', error)
    return { count: 0 }
  }
  
  return { count: count || 0 }
}

export async function markMessageAsRead(messageId: string) {
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