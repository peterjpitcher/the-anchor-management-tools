import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { CommunicationChannel, CustomerCommunication } from '@/types/communications'

type CustomerSummary = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  email: string | null
  sms_opt_in: boolean | null
  whatsapp_opt_in: boolean | null
  whatsapp_status: string | null
}

export type ConversationSummary = {
  customer: CustomerSummary
  unreadCount: number
  channels: CommunicationChannel[]
  lastMessage: {
    id: string
    body: string | null
    subject: string | null
    channel: CommunicationChannel
    direction: string
    created_at: string
    read_at: string | null
    staff_read_at: string | null
    has_attachments: boolean
  }
  lastMessageAt: string
}

export type InboxResult = {
  conversations: ConversationSummary[]
  totalUnread: number
  hasMoreUnread: boolean
  unmatchedCount: number
}

const RECENT_COMMUNICATION_FETCH_LIMIT = 250
const UNREAD_COMMUNICATION_FETCH_LIMIT = 500

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'object' && error && 'message' in error) {
    return new Error(String((error as { message?: unknown }).message))
  }
  return new Error(String(error))
}

function isUnread(row: CustomerCommunication): boolean {
  if (row.direction !== 'inbound') return false
  if (row.channel === 'email') return !row.staff_read_at
  if (row.channel === 'sms' || row.channel === 'whatsapp') return !row.read_at
  return false
}

function rawCommunication(row: any): CustomerCommunication {
  return {
    ...row,
    delivery_history: Array.isArray(row.delivery_history) ? row.delivery_history : [],
    attachments: Array.isArray(row.attachments) ? row.attachments : row.attachments ?? null,
    engagement: row.engagement ?? {},
    context: row.context ?? {},
  } as CustomerCommunication
}

function buildLastMessage(row: CustomerCommunication): ConversationSummary['lastMessage'] {
  return {
    id: row.id,
    body: row.body_text,
    subject: row.subject,
    channel: row.channel,
    direction: row.direction,
    created_at: row.created_at,
    read_at: row.read_at,
    staff_read_at: row.staff_read_at,
    has_attachments: row.has_attachments,
  }
}

async function requireMessagesView() {
  const canView = await checkUserPermission('messages', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }
}

async function requireMessagesManage() {
  const canManage = await checkUserPermission('messages', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }
}

async function loadCustomers(adminClient: any, customerIds: string[]) {
  if (customerIds.length === 0) {
    return new Map<string, CustomerSummary>()
  }

  const { data, error } = await adminClient
    .from('customers')
    .select('id, first_name, last_name, mobile_number, email, sms_opt_in, whatsapp_opt_in, whatsapp_status')
    .in('id', Array.from(new Set(customerIds)))

  if (error) {
    throw new Error(`Failed to load communication customers: ${error.message}`)
  }

  return new Map<string, CustomerSummary>(
    (data ?? []).map((customer: CustomerSummary) => [customer.id, customer])
  )
}

function fallbackCustomer(customerId: string): CustomerSummary {
  return {
    id: customerId,
    first_name: 'Unknown',
    last_name: '',
    mobile_number: null,
    email: null,
    sms_opt_in: null,
    whatsapp_opt_in: null,
    whatsapp_status: null,
  }
}

export class CommunicationsService {
  static async getInbox(): Promise<InboxResult> {
    await requireMessagesView()
    const adminClient = createAdminClient()

    const unreadFilter =
      'and(direction.eq.inbound,channel.in.(sms,whatsapp),read_at.is.null),' +
      'and(direction.eq.inbound,channel.eq.email,staff_read_at.is.null)'

    const [recentResult, unreadResult, unmatchedResult] = await Promise.all([
      (adminClient.from('customer_communications') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(RECENT_COMMUNICATION_FETCH_LIMIT),
      (adminClient.from('customer_communications') as any)
        .select('*')
        .or(unreadFilter)
        .order('created_at', { ascending: false })
        .limit(UNREAD_COMMUNICATION_FETCH_LIMIT),
      (adminClient.from('unmatched_communications') as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'unmatched'),
    ])

    if (recentResult.error) {
      logger.error('Error fetching recent communications', { error: toError(recentResult.error) })
      throw new Error('Failed to load messages')
    }

    if (unreadResult.error) {
      logger.error('Error fetching unread communications', { error: toError(unreadResult.error) })
      throw new Error('Failed to load messages')
    }

    if (unmatchedResult.error) {
      logger.warn('Error counting unmatched communications', { error: toError(unmatchedResult.error) })
    }

    const rows = [
      ...((unreadResult.data ?? []) as any[]).map(rawCommunication),
      ...((recentResult.data ?? []) as any[]).map(rawCommunication),
    ]
    const customerMap = await loadCustomers(adminClient, rows.map(row => row.customer_id))
    const conversations = new Map<string, ConversationSummary>()
    const seenRows = new Set<string>()

    for (const row of rows) {
      if (seenRows.has(row.id)) continue
      seenRows.add(row.id)

      const customer = customerMap.get(row.customer_id) ?? fallbackCustomer(row.customer_id)
      const current = conversations.get(customer.id)
      const unread = isUnread(row) ? 1 : 0

      if (!current) {
        conversations.set(customer.id, {
          customer,
          unreadCount: unread,
          channels: [row.channel],
          lastMessage: buildLastMessage(row),
          lastMessageAt: row.created_at,
        })
        continue
      }

      if (!current.channels.includes(row.channel)) {
        current.channels.push(row.channel)
      }
      current.unreadCount += unread

      if (new Date(row.created_at).getTime() >= new Date(current.lastMessageAt).getTime()) {
        current.lastMessage = buildLastMessage(row)
        current.lastMessageAt = row.created_at
      }
    }

    const sorted = Array.from(conversations.values()).sort((a, b) => {
      const unreadDifference = Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
      if (unreadDifference !== 0) return unreadDifference
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })

    return {
      conversations: sorted,
      totalUnread: sorted.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
      hasMoreUnread: (unreadResult.data?.length ?? 0) >= UNREAD_COMMUNICATION_FETCH_LIMIT,
      unmatchedCount: unmatchedResult.count ?? 0,
    }
  }

  static async getCustomerTimeline(customerId: string) {
    await requireMessagesView()
    const adminClient = createAdminClient()

    const [communicationsResult, customerResult] = await Promise.all([
      (adminClient.from('customer_communications') as any)
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true }),
      adminClient
        .from('customers')
        .select('id, first_name, last_name, mobile_number, email, sms_opt_in, whatsapp_opt_in, whatsapp_status')
        .eq('id', customerId)
        .maybeSingle(),
    ])

    if (communicationsResult.error) {
      logger.error('Error loading customer communications', {
        error: toError(communicationsResult.error),
        metadata: { customerId },
      })
      throw new Error('Failed to load conversation')
    }

    if (customerResult.error) {
      logger.warn('Error loading communication customer', {
        error: toError(customerResult.error),
        metadata: { customerId },
      })
    }

    return {
      customer: (customerResult.data as CustomerSummary | null) ?? fallbackCustomer(customerId),
      communications: ((communicationsResult.data ?? []) as any[]).map(rawCommunication),
    }
  }

  static async markAllRead() {
    await requireMessagesView()
    const adminClient = createAdminClient()
    const nowIso = new Date().toISOString()

    const [messagesResult, emailResult] = await Promise.all([
      adminClient
        .from('messages')
        .update({ read_at: nowIso })
        .eq('direction', 'inbound')
        .is('read_at', null),
      (adminClient.from('email_messages') as any)
        .update({ staff_read_at: nowIso, status: 'read', updated_at: nowIso })
        .eq('direction', 'inbound')
        .is('staff_read_at', null),
    ])

    if (messagesResult.error || emailResult.error) {
      throw new Error(messagesResult.error?.message ?? emailResult.error?.message ?? 'Failed to mark messages as read')
    }
  }

  static async markConversationRead(customerId: string) {
    await requireMessagesView()
    const adminClient = createAdminClient()
    const nowIso = new Date().toISOString()

    const [messagesResult, emailResult] = await Promise.all([
      adminClient
        .from('messages')
        .update({ read_at: nowIso })
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .is('read_at', null),
      (adminClient.from('email_messages') as any)
        .update({ staff_read_at: nowIso, status: 'read', updated_at: nowIso })
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .is('staff_read_at', null),
    ])

    if (messagesResult.error || emailResult.error) {
      throw new Error(messagesResult.error?.message ?? emailResult.error?.message ?? 'Failed to mark conversation as read')
    }
  }

  static async markConversationUnread(customerId: string) {
    await requireMessagesView()
    const adminClient = createAdminClient()

    let data: any = null
    let error: any = null

    try {
      const result = await (adminClient.from('customer_communications') as any)
        .select('id, channel')
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      data = result.data
      error = result.error
    } catch {
      const fallback = await adminClient
        .from('messages')
        .select('id')
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      data = fallback.data ? { id: `sms:${fallback.data.id}`, channel: 'sms' } : null
      error = fallback.error
    }

    if (error) {
      throw new Error(`Failed to find latest inbound communication: ${error.message}`)
    }

    if (!data?.id) {
      return
    }

    const [channel, rawId] = String(data.id).split(':')
    if (!rawId) {
      return
    }

    const result = channel === 'email'
      ? await (adminClient.from('email_messages') as any)
        .update({ staff_read_at: null, status: 'received', updated_at: new Date().toISOString() })
        .eq('id', rawId)
        .select('id')
        .maybeSingle()
      : await adminClient
        .from('messages')
        .update({ read_at: null })
        .eq('id', rawId)
        .select('id')
        .maybeSingle()

    if (result.error) {
      throw new Error(`Failed to mark conversation as unread: ${result.error.message}`)
    }
    if (!result.data) {
      throw new Error('Message not found')
    }
  }

  static async getUnmatchedCommunications() {
    await requireMessagesView()
    const adminClient = createAdminClient()

    const { data, error } = await (adminClient.from('unmatched_communications') as any)
      .select('*')
      .eq('status', 'unmatched')
      .order('received_at', { ascending: false })
      .limit(100)

    if (error) {
      throw new Error(`Failed to load unmatched communications: ${error.message}`)
    }

    return data ?? []
  }

  static async linkUnmatchedCommunication(unmatchedId: string, customerId: string) {
    await requireMessagesManage()
    const adminClient = createAdminClient()

    const { data: unmatched, error: unmatchedError } = await (adminClient.from('unmatched_communications') as any)
      .select('*')
      .eq('id', unmatchedId)
      .eq('status', 'unmatched')
      .maybeSingle()

    if (unmatchedError) {
      throw new Error(`Failed to load unmatched communication: ${unmatchedError.message}`)
    }
    if (!unmatched) {
      throw new Error('Unmatched communication not found')
    }

    const { data: customer, error: customerError } = await adminClient
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .maybeSingle()

    if (customerError) {
      throw new Error(`Failed to load customer: ${customerError.message}`)
    }
    if (!customer) {
      throw new Error('Customer not found')
    }

    const nowIso = new Date().toISOString()
    let linkedMessageId: string | null = null
    let linkedEmailMessageId: string | null = null

    if (unmatched.channel === 'email') {
      const { data, error } = await (adminClient.from('email_messages') as any)
        .insert({
          customer_id: customerId,
          direction: 'inbound',
          to_address: unmatched.to_address ?? '',
          from_address: unmatched.from_address,
          subject: unmatched.subject,
          body_text: unmatched.body_text,
          body_html: unmatched.body_html,
          resend_message_id: unmatched.resend_message_id,
          status: 'received',
          received_at: unmatched.received_at,
          has_attachments: Array.isArray(unmatched.attachments) && unmatched.attachments.length > 0,
          attachments: unmatched.attachments,
          metadata: { linked_from_unmatched_id: unmatchedId },
          updated_at: nowIso,
        })
        .select('id')
        .maybeSingle()

      if (error) {
        throw new Error(`Failed to create linked email message: ${error.message}`)
      }
      linkedEmailMessageId = data?.id ?? null
    } else {
      const messageSid = unmatched.twilio_message_sid ?? `unmatched:${unmatched.id}`
      const { data, error } = await adminClient
        .from('messages')
        .insert({
          customer_id: customerId,
          direction: 'inbound',
          message_sid: messageSid,
          twilio_message_sid: unmatched.twilio_message_sid,
          body: unmatched.body_text ?? '',
          status: 'received',
          twilio_status: 'received',
          from_number: unmatched.from_address,
          to_number: unmatched.to_address,
          message_type: unmatched.channel,
          created_at: unmatched.received_at,
          has_attachments: Array.isArray(unmatched.attachments) && unmatched.attachments.length > 0,
          attachments: unmatched.attachments,
        })
        .select('id')
        .maybeSingle()

      if (error) {
        throw new Error(`Failed to create linked message: ${error.message}`)
      }
      linkedMessageId = data?.id ?? null
    }

    const { error: updateError } = await (adminClient.from('unmatched_communications') as any)
      .update({
        status: 'linked',
        linked_customer_id: customerId,
        linked_message_id: linkedMessageId,
        linked_email_message_id: linkedEmailMessageId,
        updated_at: nowIso,
      })
      .eq('id', unmatchedId)

    if (updateError) {
      throw new Error(`Failed to update unmatched communication: ${updateError.message}`)
    }

    return { linkedMessageId, linkedEmailMessageId }
  }

  static async ignoreUnmatchedCommunication(unmatchedId: string) {
    await requireMessagesManage()
    const adminClient = createAdminClient()

    const { error } = await (adminClient.from('unmatched_communications') as any)
      .update({ status: 'ignored', updated_at: new Date().toISOString() })
      .eq('id', unmatchedId)
      .eq('status', 'unmatched')

    if (error) {
      throw new Error(`Failed to ignore unmatched communication: ${error.message}`)
    }
  }
}
