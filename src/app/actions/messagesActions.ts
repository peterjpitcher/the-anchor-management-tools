'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'

export async function getMessages() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  console.log('=== Getting all messages ===')
  
  const supabase = createAdminClient()
  
  // Get only unread inbound messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'inbound')
    .is('read_at', null)
    .order('created_at', { ascending: false })
  
  console.log('Messages query result:', { badge: messages?.length, error: messagesError })
  
  if (messagesError) {
    console.error('Error fetching messages:', messagesError)
    return { error: messagesError.message }
  }
  
  if (!messages || messages.length === 0) {
    return { conversations: [] }
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
  
  // Group messages by customer
  interface Customer {
    id: string
    first_name: string
    last_name: string
    mobile_number: string
  }
  
  interface Message {
    id: string
    customer_id: string
    created_at: string
    [key: string]: unknown
  }
  
  const conversationMap = new Map<string, {
    customer: Customer,
    messages: Message[],
    unreadCount: number,
    lastMessageAt: string
  }>()
  
  messages.forEach(message => {
    const customerId = message.customer_id
    if (!conversationMap.has(customerId)) {
      conversationMap.set(customerId, {
        customer: customerMap.get(customerId) || {
          id: customerId,
          first_name: 'Unknown',
          last_name: '',
          mobile_number: ''
        },
        messages: [],
        unreadCount: 0,
        lastMessageAt: message.created_at
      })
    }
    
    const conversation = conversationMap.get(customerId)!
    conversation.messages.push(message)
    conversation.unreadCount++ // All messages are unread since we're only fetching unread ones
    // Update last message time if this is more recent
    if (message.created_at > conversation.lastMessageAt) {
      conversation.lastMessageAt = message.created_at
    }
  })
  
  // Convert to array and sort by last message time
  const conversations = Array.from(conversationMap.values())
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  
  return { conversations }
}

export async function getUnreadMessageCount() {
  console.log('=== Getting unread message count ===')
  
  const supabase = createAdminClient()
  
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  console.log('Unread count result:', { count, error })
  
  if (error) {
    console.error('Error fetching unread badge: ', error)
    return { badge: 0 }
  }
  
  return { badge: count || 0 }
}

export async function markMessageAsRead(messageId: string) {
  const supabase = createAdminClient()
  
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
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()
  
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

export async function markConversationAsRead(customerId: string) {
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()
  
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .eq('direction', 'inbound')
    .is('read_at', null)
  
  if (error) {
    console.error('Error marking conversation as read:', error)
    throw new Error(error.message)
  }
  
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
}
