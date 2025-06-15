'use server'

import { supabase } from '@/lib/supabase'
import { revalidatePath } from 'next/cache'

export async function getMessages() {
  
  const { data: messages, error } = await supabase
    .from('messages')
    .select(`
      *,
      customer:customers!messages_customer_id_fkey(
        id,
        first_name,
        last_name,
        mobile_number
      )
    `)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching messages:', error)
    return { error: error.message }
  }
  
  return { messages: messages || [] }
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