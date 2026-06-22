'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { CommunicationsService, type ConversationSummary } from '@/services/communications'
import type { CustomerCommunication } from '@/types/communications'
import { createAdminClient } from '@/lib/supabase/admin'

export type { ConversationSummary }

export type InboxResponse =
  | { error: string }
  | {
      conversations: ConversationSummary[]
      totalUnread: number
      hasMoreUnread: boolean
      unmatchedCount: number
    }

export type ConversationMessagesResponse =
  | { error: string }
  | {
      customer: ConversationSummary['customer'] | null
      messages: CustomerCommunication[]
    }

export async function getMessages(): Promise<InboxResponse> {
  try {
    return await CommunicationsService.getInbox()
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load messages' }
  }
}

export async function getUnreadMessageCount() {
  try {
    const inbox = await CommunicationsService.getInbox()
    return { badge: inbox.totalUnread + inbox.unmatchedCount }
  } catch {
    return { badge: 0 }
  }
}

export async function getConversationMessages(customerId: string): Promise<ConversationMessagesResponse> {
  try {
    const result = await CommunicationsService.getCustomerTimeline(customerId)
    return {
      customer: result.customer,
      messages: result.communications,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load conversation' }
  }
}

export async function markMessageAsRead(messageId: string) {
  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('direction', 'inbound')
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to mark message as read: ${error.message}`)
  }
  if (!data) {
    throw new Error('Message not found')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidateTag('dashboard')
}

export async function markAllMessagesAsRead() {
  await CommunicationsService.markAllRead()
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidateTag('dashboard')
}

export async function markConversationAsRead(customerId: string) {
  await CommunicationsService.markConversationRead(customerId)
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
  revalidateTag('dashboard')
}

export async function markConversationAsUnread(customerId: string) {
  await CommunicationsService.markConversationUnread(customerId)
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
  revalidateTag('dashboard')
  return { success: true }
}
