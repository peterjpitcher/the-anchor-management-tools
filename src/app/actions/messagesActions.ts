'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { CommunicationsService, type ConversationSummary } from '@/services/communications'
import type { CustomerCommunication } from '@/types/communications'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'

export type { ConversationSummary }

export type InboxResponse =
  | { error: string }
  | {
      conversations: ConversationSummary[]
      totalUnread: number
      unreadIsCapped: boolean
      hasMoreUnread: boolean
      unmatchedCount: number
    }

export type ConversationMessagesResponse =
  | { error: string }
  | {
      customer: ConversationSummary['customer'] | null
      messages: CustomerCommunication[]
      hasOlder: boolean
    }

export type ConversationSearchResponse =
  | { error: string }
  | { conversations: ConversationSummary[] }

export async function getMessages(): Promise<InboxResponse> {
  try {
    return await CommunicationsService.getInbox()
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load messages' }
  }
}

async function getUnreadMessageCount() {
  try {
    const inbox = await CommunicationsService.getInbox()
    return { badge: inbox.totalUnread + inbox.unmatchedCount }
  } catch {
    return { badge: 0 }
  }
}

export async function getConversationMessages(
  customerId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ConversationMessagesResponse> {
  try {
    const result = await CommunicationsService.getCustomerTimeline(customerId, options)
    return {
      customer: result.customer,
      messages: result.communications,
      hasOlder: result.hasOlder,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load conversation' }
  }
}

/**
 * Search beyond the inbox page.
 *
 * The list only holds the most recent 250 communications, so filtering it in the
 * browser silently could not find an older conversation. This resolves the
 * customer server-side first, so "does this person exist" has a truthful answer.
 */
export async function searchConversations(query: string): Promise<ConversationSearchResponse> {
  try {
    return { conversations: await CommunicationsService.searchConversations(query) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to search conversations' }
  }
}

export async function markMessageAsRead(messageId: string) {
  const hasPermission = await canWriteMessageReadState()
  if (!hasPermission) {
    throw new Error('Insufficient permissions')
  }

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
  const hasPermission = await canWriteMessageReadState()
  if (!hasPermission) {
    throw new Error('Insufficient permissions')
  }

  await CommunicationsService.markAllRead()
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidateTag('dashboard')
}

export async function markConversationAsRead(customerId: string) {
  const hasPermission = await canWriteMessageReadState()
  if (!hasPermission) {
    throw new Error('Insufficient permissions')
  }

  await CommunicationsService.markConversationRead(customerId)
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
  revalidateTag('dashboard')
}

export async function markConversationAsUnread(customerId: string) {
  const hasPermission = await canWriteMessageReadState()
  if (!hasPermission) {
    throw new Error('Insufficient permissions')
  }

  await CommunicationsService.markConversationUnread(customerId)
  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
  revalidateTag('dashboard')
  return { success: true }
}

async function canWriteMessageReadState() {
  const [canManage, canSendTransactional] = await Promise.all([
    checkUserPermission('messages', 'manage'),
    checkUserPermission('messages', 'send_transactional'),
  ])
  return canManage || canSendTransactional
}
