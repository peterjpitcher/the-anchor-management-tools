'use server'

import type { Message } from '@/types/database'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'

type CustomerSummary = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  sms_opt_in: boolean | null
}

export type ConversationSummary = {
  customer: CustomerSummary
  unreadCount: number
  lastMessage: {
    id: string
    body: string | null
    direction: string
    created_at: string
    read_at: string | null
  }
  lastMessageAt: string
}

export type InboxResponse =
  | { error: string }
  | {
      conversations: ConversationSummary[]
      totalUnread: number
      hasMoreUnread: boolean
    }

export type ConversationMessagesResponse =
  | { error: string }
  | {
      customer: CustomerSummary | null
      messages: Message[]
    }

type RawMessage = {
  id: string
  customer_id: string
  body: string | null
  direction: string
  created_at: string
  read_at: string | null
  customers?: CustomerSummary | CustomerSummary[] | null
}

type ConversationAccumulator = {
  customer: CustomerSummary
  unreadCount: number
  lastMessage: ConversationSummary['lastMessage']
  lastMessageAt: string
}

const RECENT_CONVERSATION_LIMIT = 25
const RECENT_MESSAGE_FETCH_LIMIT = 400
const UNREAD_MESSAGE_FETCH_LIMIT = 500

function extractCustomer(message: RawMessage): CustomerSummary {
  const customerRecord = Array.isArray(message.customers)
    ? message.customers[0]
    : message.customers

  if (customerRecord) {
    return {
      id: customerRecord.id,
      first_name: customerRecord.first_name ?? null,
      last_name: customerRecord.last_name ?? null,
      mobile_number: customerRecord.mobile_number ?? null,
      sms_opt_in: customerRecord.sms_opt_in ?? null,
    }
  }

  return {
    id: message.customer_id,
    first_name: 'Unknown',
    last_name: '',
    mobile_number: null,
    sms_opt_in: null,
  }
}

function ensureConversation(
  map: Map<string, ConversationAccumulator>,
  message: RawMessage,
  customer: CustomerSummary,
): ConversationAccumulator {
  const existing = map.get(customer.id)
  if (existing) {
    return existing
  }

  const lastMessage = {
    id: message.id,
    body: message.body,
    direction: message.direction,
    created_at: message.created_at,
    read_at: message.read_at,
  }

  const conversation: ConversationAccumulator = {
    customer,
    unreadCount: 0,
    lastMessage,
    lastMessageAt: message.created_at,
  }

  map.set(customer.id, conversation)
  return conversation
}

function updateLastMessage(
  conversation: ConversationAccumulator,
  message: RawMessage,
) {
  const current = new Date(conversation.lastMessageAt).getTime()
  const incoming = new Date(message.created_at).getTime()

  if (incoming >= current) {
    conversation.lastMessage = {
      id: message.id,
      body: message.body,
      direction: message.direction,
      created_at: message.created_at,
      read_at: message.read_at,
    }
    conversation.lastMessageAt = message.created_at
  }
}

export async function getMessages(): Promise<InboxResponse> {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const supabase = createAdminClient()

  const [recentResult, unreadResult, unreadCountResult] = await Promise.all([
    supabase
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
            mobile_number,
            sms_opt_in
          )
        `,
      )
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGE_FETCH_LIMIT),
    supabase
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
            mobile_number,
            sms_opt_in
          )
        `,
      )
      .eq('direction', 'inbound')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(UNREAD_MESSAGE_FETCH_LIMIT),
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'inbound')
      .is('read_at', null),
  ])

  const { data: recentMessages, error: recentError } = recentResult
  const { data: unreadMessages, error: unreadError } = unreadResult
  const { count: unreadCountRaw, error: unreadCountError } = unreadCountResult

  if (recentError) {
    console.error('Error fetching recent messages:', recentError)
    return { error: 'Failed to load messages' }
  }

  if (unreadError) {
    console.error('Error fetching unread messages:', unreadError)
    return { error: 'Failed to load messages' }
  }

  if (unreadCountError) {
    console.error('Error counting unread messages:', unreadCountError)
  }

  const conversationMap = new Map<string, ConversationAccumulator>()
  const unreadConversationIds = new Set<string>()
  const recentConversationIds: string[] = []
  const recentConversationIdSet = new Set<string>()
  const processedMessageIds = new Set<string>()

  for (const raw of unreadMessages ?? []) {
    const message = raw as RawMessage
    const customer = extractCustomer(message)
    const conversation = ensureConversation(conversationMap, message, customer)

    if (message.direction === 'inbound' && !message.read_at) {
      conversation.unreadCount += 1
    }

    updateLastMessage(conversation, message)
    unreadConversationIds.add(customer.id)
    processedMessageIds.add(message.id)
  }

  for (const raw of recentMessages ?? []) {
    const message = raw as RawMessage
    const customer = extractCustomer(message)
    const conversation = ensureConversation(conversationMap, message, customer)

    const shouldCountUnread = !processedMessageIds.has(message.id)
    if (
      shouldCountUnread &&
      message.direction === 'inbound' &&
      !message.read_at
    ) {
      conversation.unreadCount += 1
    }

    updateLastMessage(conversation, message)

    if (
      !recentConversationIdSet.has(customer.id) &&
      recentConversationIds.length < RECENT_CONVERSATION_LIMIT
    ) {
      recentConversationIds.push(customer.id)
      recentConversationIdSet.add(customer.id)
    }
  }

  const finalConversationIds = new Set<string>([
    ...recentConversationIds,
    ...Array.from(unreadConversationIds),
  ])

  const conversations = Array.from(finalConversationIds)
    .map((id) => conversationMap.get(id))
    .filter((conversation): conversation is ConversationAccumulator => Boolean(conversation))
    .map<ConversationSummary>((conversation) => ({
      customer: conversation.customer,
      unreadCount: conversation.unreadCount,
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
    }))
    .sort((a, b) => {
      const unreadDifference =
        Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
      if (unreadDifference !== 0) {
        return unreadDifference
      }

      return (
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
      )
    })

  const totalUnread =
    typeof unreadCountRaw === 'number'
      ? unreadCountRaw
      : conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0)

  const hasMoreUnread =
    typeof unreadCountRaw === 'number'
      ? unreadCountRaw > UNREAD_MESSAGE_FETCH_LIMIT
      : false

  return {
    conversations,
    totalUnread,
    hasMoreUnread,
  }
}

export async function getUnreadMessageCount() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { badge: 0 }
  }

  const supabase = createAdminClient()

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

export async function getConversationMessages(
  customerId: string,
): Promise<ConversationMessagesResponse> {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }

  const supabase = createAdminClient()

  const [messagesResult, customerResult] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true }),
    supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, sms_opt_in')
      .eq('id', customerId)
      .maybeSingle(),
  ])

  const { data: messages, error: messagesError } = messagesResult
  if (messagesError) {
    console.error('Error loading conversation messages:', messagesError)
    return { error: 'Failed to load conversation' }
  }

  const { data: customer, error: customerError } = customerResult
  if (customerError) {
    console.error('Error loading conversation customer:', customerError)
  }

  return {
    messages: (messages ?? []) as Message[],
    customer:
      customer ?? {
        id: customerId,
        first_name: 'Unknown',
        last_name: '',
        mobile_number: null,
        sms_opt_in: null,
      },
  }
}

export async function markMessageAsRead(messageId: string) {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()

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
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
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
    throw new Error('Failed to mark all messages as read')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
}

export async function markConversationAsRead(customerId: string) {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
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
    throw new Error('Failed to mark conversation as read')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)
}

export async function markConversationAsUnread(customerId: string) {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()

  const { data: latestInbound, error: fetchError } = await supabase
    .from('messages')
    .select('id')
    .eq('customer_id', customerId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fetchError) {
    console.error('Error finding latest inbound message:', fetchError)
    throw new Error('Failed to mark conversation as unread')
  }

  if (!latestInbound?.id) {
    return { success: true }
  }

  const { error: updateError } = await supabase
    .from('messages')
    .update({ read_at: null })
    .eq('id', latestInbound.id)

  if (updateError) {
    console.error('Error marking conversation as unread:', updateError)
    throw new Error('Failed to mark conversation as unread')
  }

  revalidatePath('/messages')
  revalidatePath('/', 'layout')
  revalidatePath(`/customers/${customerId}`)

  return { success: true }
}
