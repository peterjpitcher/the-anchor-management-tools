import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ConsentService } from '@/services/consent'
import { detectOptOut, type OptOutScope } from '@/lib/sms/opt-out-keywords'
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

/**
 * Only the columns the inbox list actually renders.
 *
 * The inbox polls on a timer from every open tab, and select('*') dragged the
 * whole view across the wire on each tick: body_html, the aggregated
 * delivery_history jsonb, attachments, engagement and context, none of which the
 * conversation list touches. Those three columns alone were over half the
 * payload of a 250 row page.
 */
const INBOX_COLUMNS =
  'id, customer_id, channel, direction, created_at, read_at, staff_read_at, has_attachments, subject, body_text'

type InboxRow = Pick<
  CustomerCommunication,
  | 'id'
  | 'customer_id'
  | 'channel'
  | 'direction'
  | 'created_at'
  | 'read_at'
  | 'staff_read_at'
  | 'has_attachments'
  | 'subject'
  | 'body_text'
>

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'object' && error && 'message' in error) {
    return new Error(String((error as { message?: unknown }).message))
  }
  return new Error(String(error))
}

function isUnread(row: InboxRow): boolean {
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

function buildLastMessage(row: InboxRow): ConversationSummary['lastMessage'] {
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

function inboxRow(row: any): InboxRow {
  return { ...row, has_attachments: Boolean(row.has_attachments) } as InboxRow
}

/*
 * Opt-out keywords and matching now live in src/lib/sms/opt-out-keywords.ts, so
 * this path and the inbound webhook cannot drift apart. That module imports
 * nothing, which is what keeps the webhook's request path clear of the RBAC
 * server actions this service pulls in.
 */

/**
 * Apply an opt-out that arrived from a number we could not match to a customer.
 *
 * The inbound webhook can only honour STOP when it already knows who sent it. A
 * STOP from an unrecognised number is parked in the holding queue instead, and
 * nothing ever went back and applied it, so the venue carried on texting someone
 * who had explicitly asked it to stop. Linking is the moment we learn who they
 * are, so it is the moment the opt-out has to take effect.
 *
 * Every still-unmatched message from the same number on the same channel is
 * checked, not just the one being linked: a customer who texts "STOP" and then
 * "what time do you open?" would otherwise have their opt-out dropped whenever
 * staff linked the newer message.
 */
async function honourOptOutFromHoldingQueue(
  adminClient: any,
  input: {
    customerId: string
    channel: string
    fromAddress: string | null
    bodyText: string | null
    twilioMessageSid: string | null
    unmatchedId: string
  }
): Promise<void> {
  // STOP is an SMS and WhatsApp carrier convention. Email unsubscribes come
  // through a different mechanism entirely, so there is nothing to honour here.
  if (input.channel !== 'sms' && input.channel !== 'whatsapp') return

  const bodies: Array<{ body: string | null; sid: string | null }> = [
    { body: input.bodyText, sid: input.twilioMessageSid },
  ]

  if (input.fromAddress) {
    const { data: siblings, error: siblingsError } = await (
      adminClient.from('unmatched_communications') as any
    )
      .select('body_text, twilio_message_sid')
      .eq('status', 'unmatched')
      .eq('channel', input.channel)
      .eq('from_address', input.fromAddress)
      .neq('id', input.unmatchedId)

    if (siblingsError) {
      // Fail loudly. Quietly skipping the sweep would mean silently dropping an
      // opt-out that is sitting in the queue right now.
      throw new Error(
        `Failed to check the holding queue for opt-outs from this number: ${siblingsError.message}`
      )
    }

    for (const sibling of siblings ?? []) {
      bodies.push({ body: sibling.body_text, sid: sibling.twilio_message_sid })
    }
  }

  // A full STOP outranks a marketing-only keyword, so take the widest scope
  // present rather than whichever message happens to be linked.
  let strongest: { scope: OptOutScope; keyword: string; sid: string | null } | null = null
  for (const candidate of bodies) {
    const detected = detectOptOut(candidate.body)
    if (!detected) continue
    if (!strongest || (strongest.scope === 'marketing_only' && detected.scope === 'all')) {
      strongest = { ...detected, sid: candidate.sid }
    }
  }

  if (!strongest) return

  const isWhatsApp = input.channel === 'whatsapp'
  const marketingOnly = strongest.scope === 'marketing_only'
  const optedOutAt = new Date().toISOString()

  const optOutPayload = isWhatsApp
    ? (marketingOnly
        ? {
            marketing_whatsapp_opt_in: false,
            marketing_whatsapp_opted_out_at: optedOutAt,
          }
        : {
            whatsapp_opt_in: false,
            marketing_whatsapp_opt_in: false,
            whatsapp_status: 'opted_out',
            whatsapp_opted_out_at: optedOutAt,
            marketing_whatsapp_opted_out_at: optedOutAt,
          })
    : (marketingOnly
        ? {
            marketing_sms_opt_in: false,
            marketing_sms_opted_out_at: optedOutAt,
          }
        : {
            sms_opt_in: false,
            sms_status: 'opted_out',
            marketing_sms_opt_in: false,
            marketing_sms_opted_out_at: optedOutAt,
          })

  const { data: optedOutCustomer, error: optOutError } = await adminClient
    .from('customers')
    .update(optOutPayload)
    .eq('id', input.customerId)
    .select('id')
    .maybeSingle()

  if (optOutError) {
    throw new Error(`Failed to apply opt-out from linked communication: ${optOutError.message}`)
  }
  if (!optedOutCustomer) {
    throw new Error('Opt-out from linked communication affected no customer rows')
  }

  try {
    await ConsentService.recordOptOut(
      input.customerId,
      isWhatsApp ? 'whatsapp' : 'sms',
      isWhatsApp ? 'twilio_inbound_whatsapp' : 'twilio_inbound_sms',
      {
        captureMethod: 'inbound_keyword',
        relatedEntityType: 'message',
        metadata: {
          keyword: strongest.keyword,
          twilio_message_sid: strongest.sid,
          channel: input.channel,
          scope: strongest.scope,
          linked_from_unmatched_id: input.unmatchedId,
        },
      },
      marketingOnly ? ['marketing'] : ['service', 'marketing']
    )
  } catch (consentError) {
    // The preference itself is already saved, which is what stops the messages.
    // A missing audit row must not roll that back.
    logger.error('Failed to write consent audit row for opt-out linked from holding queue', {
      error: consentError instanceof Error ? consentError : new Error(String(consentError)),
      metadata: {
        customerId: input.customerId,
        channel: input.channel,
        unmatchedId: input.unmatchedId,
      },
    })
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
        .select(INBOX_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(RECENT_COMMUNICATION_FETCH_LIMIT),
      (adminClient.from('customer_communications') as any)
        .select(INBOX_COLUMNS)
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
      ...((unreadResult.data ?? []) as any[]).map(inboxRow),
      ...((recentResult.data ?? []) as any[]).map(inboxRow),
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

  /**
   * The exact inverse of markConversationRead.
   *
   * Opening a thread marks every inbound message and email in it read, but this
   * used to restore only the single most recent inbound row, so the unread count
   * never came back to what it was and the rest stayed read for good. It also
   * resolved that row through the customer_communications view, whose ids are
   * channel-prefixed and which also carries feedback rows that exist in neither
   * table: the first feedback entry on a customer would send a feedback id into
   * the messages table and make Mark unread fail outright for that customer.
   *
   * Operating on the same two tables, with the same filters and the opposite
   * values, keeps the pair symmetrical and removes the view from the path.
   */
  static async markConversationUnread(customerId: string) {
    await requireMessagesView()
    const adminClient = createAdminClient()

    const [messagesResult, emailResult] = await Promise.all([
      adminClient
        .from('messages')
        .update({ read_at: null })
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .not('read_at', 'is', null),
      (adminClient.from('email_messages') as any)
        .update({ staff_read_at: null, status: 'received', updated_at: new Date().toISOString() })
        .eq('customer_id', customerId)
        .eq('direction', 'inbound')
        .not('staff_read_at', 'is', null),
    ])

    if (messagesResult.error || emailResult.error) {
      throw new Error(
        messagesResult.error?.message ??
          emailResult.error?.message ??
          'Failed to mark conversation as unread'
      )
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

    // Applied before anything is written. If honouring the opt-out fails, the
    // whole link fails with nothing mutated and the row stays in the queue for a
    // clean retry, rather than leaving a linked customer who is still opted in.
    await honourOptOutFromHoldingQueue(adminClient, {
      customerId,
      channel: unmatched.channel,
      fromAddress: unmatched.from_address ?? null,
      bodyText: unmatched.body_text ?? null,
      twilioMessageSid: unmatched.twilio_message_sid ?? null,
      unmatchedId,
    })

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
