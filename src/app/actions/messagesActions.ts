'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'

type ConversationMessage = {
  id: string
  customer_id: string
  body: string | null
  direction: string
  created_at: string
  read_at: string | null
}

type Conversation = {
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
  }
  messages: ConversationMessage[]
  unreadCount: number
  lastMessageAt: string
}

export async function getMessages() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('messages')
    .select(
      `
        id,
        customer_id,
        body,
        direction,
        created_at,
        read_at,
        customers:customers (
          id,
          first_name,
          last_name,
          mobile_number
        )
      `,
    )
    .eq('direction', 'inbound')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('Error fetching unread messages:', error)
    return { error: 'Failed to load messages' }
  }

  if (!data || data.length === 0) {
    return { conversations: [] }
  }

  const conversationMap = new Map<string, Conversation>()

  data.forEach((message) => {
    const customerRecord = Array.isArray(message.customers)
      ? message.customers[0]
      : message.customers

    const customer = customerRecord ?? {
      id: message.customer_id,
      first_name: 'Unknown',
      last_name: '',
      mobile_number: '',
    }

    if (!conversationMap.has(message.customer_id)) {
      conversationMap.set(message.customer_id, {
        customer: {
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          mobile_number: customer.mobile_number,
        },
        messages: [],
        unreadCount: 0,
        lastMessageAt: message.created_at,
      })
    }

    const conversation = conversationMap.get(message.customer_id)!
    const simplifiedMessage: ConversationMessage = {
      id: message.id,
      customer_id: message.customer_id,
      body: message.body,
      direction: message.direction,
      created_at: message.created_at,
      read_at: message.read_at,
    }

    conversation.messages.push(simplifiedMessage)
    conversation.unreadCount += 1

    if (message.created_at > conversation.lastMessageAt) {
      conversation.lastMessageAt = message.created_at
    }
  })

  const conversations = Array.from(conversationMap.values()).sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  )

  return { conversations }
}

export async function getUnreadMessageCount() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { badge: 0 }
  }

  const supabase = await createClient()

  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)

  if (error) {
    console.error('Error fetching unread count:', error)
    return { badge: 0 }
  }

  return { badge: count || 0 }
}

export async function markMessageAsRead(messageId: string) {
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('direction', 'inbound')

  if (error) {
    console.error('Error marking message as read:', error)
    throw new Error('Failed to mark message as read')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
}

export async function markAllMessagesAsRead() {
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('direction', 'inbound')
    .is('read_at', null)

  if (error) {
    console.error('Error marking all messages as read:', error)
    throw new Error('Failed to mark all messages as read')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
}

export async function markConversationAsRead(customerId: string) {
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .eq('direction', 'inbound')
    .is('read_at', null)

  if (error) {
    console.error('Error marking conversation as read:', error)
    throw new Error('Failed to mark conversation as read')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
}
