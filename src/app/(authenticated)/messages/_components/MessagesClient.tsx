'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { formatDateInLondon, getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

import {
  PageHeader,
  Card,
  CardBody,
  CustomerLink,
  SectionNav,
} from '@/ds'
import {
  Button,
  Badge,
  Avatar,
  SearchInput,
  Textarea,
  Skeleton,
  Empty,
  Spinner,
  Alert,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { toast } from '@/ds'
import { usePermissions } from '@/contexts/PermissionContext'

import {
  getConversationMessages,
  getMessages,
  markAllMessagesAsRead,
  markConversationAsRead,
  markConversationAsUnread,
  type ConversationSummary,
} from '@/app/actions/messagesActions'
import { sendSmsReply } from '@/app/actions/messageActions'
import type { CommunicationChannel, CustomerCommunication } from '@/types/communications'

const REFRESH_INTERVAL = 15000
const SMS_SEGMENT_LENGTH = 160
const SMS_SEGMENT_LENGTH_UNICODE = 70

type ConversationFilter = 'all' | 'unread' | 'email' | 'sms' | 'whatsapp'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCustomerName(customer: ConversationSummary['customer']): string {
  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (name) return name
  if (customer.mobile_number) return customer.mobile_number
  return 'Unknown customer'
}

function getPreviewText(conversation: ConversationSummary): string {
  const body = conversation.lastMessage.body?.trim()
  const subject = conversation.lastMessage.subject?.trim()
  if (subject) return subject.length > 90 ? `${subject.slice(0, 90)}...` : subject
  if (body) return body.length > 90 ? `${body.slice(0, 90)}...` : body
  return conversation.lastMessage.has_attachments ? 'Attachment' : 'Communication'
}

function getMessageTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getStatusText(status?: string): string {
  switch (status) {
    case 'delivered':
    case 'read':
      return 'Delivered'
    case 'sent':
      return 'Sent'
    case 'failed':
    case 'undelivered':
      return 'Not delivered'
    default:
      return ''
  }
}

function channelLabel(channel: CommunicationChannel): string {
  switch (channel) {
    case 'sms':
      return 'SMS'
    case 'whatsapp':
      return 'WhatsApp'
    case 'email':
      return 'Email'
    case 'feedback':
      return 'Feedback'
    default:
      return channel
  }
}

function countSmsSegments(text: string): { chars: number; segments: number; isUnicode: boolean } {
  const chars = text.length
  if (chars === 0) return { chars: 0, segments: 0, isUnicode: false }
  const isUnicode = /[^\x00-\x7F\u00A0\u00A3\u00A4\u00A5\u00A7\u00BF\u00C4-\u00C6\u00C9\u00D1\u00D6\u00D8\u00DC\u00DF\u00E0\u00E4-\u00E9\u00EC\u00F1\u00F2\u00F6\u00F8\u00F9\u00FC]/.test(text)
  const limit = isUnicode ? SMS_SEGMENT_LENGTH_UNICODE : SMS_SEGMENT_LENGTH
  return { chars, segments: Math.ceil(chars / limit), isUnicode }
}

/* ------------------------------------------------------------------ */
/*  MessagesClient                                                     */
/* ------------------------------------------------------------------ */

export function MessagesClient() {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canSendMessages =
    hasPermission('messages', 'send_transactional') || hasPermission('messages', 'manage')
  const canManageTemplates = hasPermission('messages', 'manage_templates')

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const [hasMoreUnread, setHasMoreUnread] = useState(false)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [markingAll, setMarkingAll] = useState(false)

  // Thread state
  const [messages, setMessages] = useState<CustomerCommunication[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<ConversationSummary['customer'] | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [showMobileThread, setShowMobileThread] = useState(false)
  const [markingUnread, setMarkingUnread] = useState(false)

  // Composer state
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledRef = useRef(false)

  /* ---- Data loading ---- */

  const loadConversations = useCallback(async (options: { withLoader?: boolean } = {}) => {
    const { withLoader = false } = options
    if (withLoader) setListLoading(true)

    try {
      const response = await getMessages()
      if ('error' in response) {
        toast.error(response.error)
        return
      }
      setConversations(response.conversations)
      setTotalUnreadCount(response.totalUnread)
      setHasMoreUnread(response.hasMoreUnread)
      setUnmatchedCount(response.unmatchedCount)
    } catch {
      toast.error('Failed to load conversations')
    } finally {
      if (withLoader) setListLoading(false)
    }
  }, [])

  const loadConversationMessages = useCallback(
    async (customerId: string, options: { markAsRead?: boolean; withLoader?: boolean } = {}) => {
      const { markAsRead = false, withLoader = true } = options
      if (withLoader) setMessagesLoading(true)

      let previousConversation: ConversationSummary | null = null
      let previousUnread = 0

      if (markAsRead) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.customer.id === customerId) {
              previousConversation = c
              previousUnread = c.unreadCount
              return c.unreadCount === 0 ? c : { ...c, unreadCount: 0 }
            }
            return c
          }),
        )
        if (previousUnread > 0) setTotalUnreadCount((prev) => Math.max(0, prev - previousUnread))

        try {
          await markConversationAsRead(customerId)
        } catch {
          if (previousConversation) {
            const snapshot = previousConversation
            setConversations((prev) =>
              prev.map((c) => (c.customer.id === customerId ? snapshot : c)),
            )
            if (previousUnread > 0) setTotalUnreadCount((prev) => prev + previousUnread)
          }
          toast.error('Failed to mark conversation as read')
        }
      }

      try {
        const response = await getConversationMessages(customerId)
        if ('error' in response) {
          toast.error(response.error)
          return
        }
        setMessages(response.messages)
        setSelectedCustomer(response.customer)
      } catch {
        toast.error('Failed to load conversation')
      } finally {
        if (withLoader) setMessagesLoading(false)
      }
    },
    [],
  )

  /* ---- Effects ---- */

  useEffect(() => {
    void loadConversations({ withLoader: true })
  }, [loadConversations])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadConversations()
      if (selectedCustomerId) {
        void loadConversationMessages(selectedCustomerId, { markAsRead: false, withLoader: false })
      }
    }, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [loadConversations, loadConversationMessages, selectedCustomerId])

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedCustomerId(null)
      setShowMobileThread(false)
      setMessages([])
      setSelectedCustomer(null)
      return
    }
    if (selectedCustomerId && conversations.some((c) => c.customer.id === selectedCustomerId)) return
    const firstUnread = conversations.find((c) => c.unreadCount > 0)
    const nextSelection = firstUnread?.customer.id ?? conversations[0]?.customer.id ?? null
    if (nextSelection && nextSelection !== selectedCustomerId) setSelectedCustomerId(nextSelection)
  }, [conversations, selectedCustomerId])

  useEffect(() => {
    if (!selectedCustomerId) return
    hasAutoScrolledRef.current = false
    void loadConversationMessages(selectedCustomerId, { markAsRead: true })
  }, [selectedCustomerId, loadConversationMessages])

  // Auto-scroll message thread
  useEffect(() => {
    if (!messagesContainerRef.current || messages.length === 0) return
    const container = messagesContainerRef.current
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (!hasAutoScrolledRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      hasAutoScrolledRef.current = true
      return
    }
    if (distanceFromBottom < 60) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  /* ---- Actions ---- */

  const displayedConversations = useMemo(() => {
    let filtered = conversations
    if (filter === 'unread') {
      const unread = conversations.filter((c) => c.unreadCount > 0)
      if (selectedCustomerId && !unread.some((c) => c.customer.id === selectedCustomerId)) {
        const selected = conversations.find((c) => c.customer.id === selectedCustomerId)
        if (selected) filtered = [selected, ...unread]
        else filtered = unread
      } else {
        filtered = unread
      }
    } else if (filter === 'email' || filter === 'sms' || filter === 'whatsapp') {
      filtered = filtered.filter((c) => c.channels.includes(filter))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter((c) => {
        const name = formatCustomerName(c.customer).toLowerCase()
        const phone = (c.customer.mobile_number || '').toLowerCase()
        return name.includes(q) || phone.includes(q)
      })
    }
    return filtered
  }, [conversations, filter, selectedCustomerId, searchQuery])

  const handleRefresh = useCallback(async () => {
    await loadConversations({ withLoader: true })
    if (selectedCustomerId) {
      await loadConversationMessages(selectedCustomerId, { markAsRead: false, withLoader: false })
    }
  }, [loadConversations, loadConversationMessages, selectedCustomerId])

  const handleMarkAllAsRead = useCallback(async () => {
    setMarkingAll(true)
    try {
      await markAllMessagesAsRead()
      toast.success('All conversations marked as read')
      await loadConversations({ withLoader: true })
    } catch {
      toast.error('Failed to mark all messages as read')
    } finally {
      setMarkingAll(false)
    }
  }, [loadConversations])

  const handleMarkUnread = async () => {
    if (!selectedCustomerId) return
    let previousConversation: ConversationSummary | null = null
    let previousUnread = 0
    setConversations((prev) =>
      prev.map((c) => {
        if (c.customer.id === selectedCustomerId) {
          previousConversation = c
          previousUnread = c.unreadCount
          return { ...c, unreadCount: c.unreadCount > 0 ? c.unreadCount : 1 }
        }
        return c
      }),
    )
    if (previousUnread === 0) setTotalUnreadCount((prev) => prev + 1)
    setMarkingUnread(true)
    try {
      await markConversationAsUnread(selectedCustomerId)
      toast.success('Conversation marked as unread')
      await loadConversations()
    } catch {
      if (previousConversation) {
        const snapshot = previousConversation
        setConversations((prev) =>
          prev.map((c) => (c.customer.id === selectedCustomerId ? snapshot : c)),
        )
      }
      if (previousUnread === 0) setTotalUnreadCount((prev) => Math.max(0, prev - 1))
      toast.error('Failed to mark conversation as unread')
    } finally {
      setMarkingUnread(false)
    }
  }

  const handleMarkRead = async () => {
    if (!selectedCustomerId) return
    await loadConversationMessages(selectedCustomerId, { markAsRead: true, withLoader: false })
    await loadConversations()
  }

  const handleSend = async () => {
    if (!newMessage.trim() || sending || !selectedCustomerId) return
    setSending(true)
    try {
      const result = await sendSmsReply(selectedCustomerId, newMessage)
      if ('error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success('Message sent')
        setNewMessage('')
        await loadConversationMessages(selectedCustomerId, { markAsRead: false, withLoader: false })
        await loadConversations()
      }
    } catch {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  /* ---- Derived ---- */

  const selectedConversation = selectedCustomerId
    ? conversations.find((c) => c.customer.id === selectedCustomerId)
    : undefined
  const customerName = selectedCustomer ? formatCustomerName(selectedCustomer) : ''
  const canReply = canSendMessages && selectedCustomer?.sms_opt_in !== false
  const replySmsInfo = useMemo(() => countSmsSegments(newMessage), [newMessage])

  // Group messages by date
  const groupedMessages = messages.reduce<Record<string, CustomerCommunication[]>>((groups, message) => {
    const date = toLocalIsoDate(new Date(message.created_at))
    if (!groups[date]) groups[date] = []
    groups[date].push(message)
    return groups
  }, {})

  /* ---- Filter nav ---- */

  const filterItems = [
    { id: 'all', label: 'All', count: conversations.length },
    { id: 'unread', label: 'Unread', count: totalUnreadCount },
    { id: 'email', label: 'Email', count: conversations.filter((c) => c.channels.includes('email')).length },
    { id: 'sms', label: 'SMS', count: conversations.filter((c) => c.channels.includes('sms')).length },
    { id: 'whatsapp', label: 'WhatsApp', count: conversations.filter((c) => c.channels.includes('whatsapp')).length },
  ]

  /* ---- Loading skeleton ---- */

  if (listLoading && conversations.length === 0) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Messages' }]}
          title="Messages"
          actions={
            canSendMessages ? (
              <Button variant="primary" size="sm" onClick={() => router.push('/messages/bulk')}>
                New Message
              </Button>
            ) : undefined
          }
        />
        <Card>
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      </div>
    )
  }

  /* ---- Render ---- */

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Messages' }]}
        title="Messages"
        subtitle={
          totalUnreadCount > 0
            ? `${totalUnreadCount} unread message${totalUnreadCount === 1 ? '' : 's'}`
            : 'All caught up'
        }
        actions={
          <div className="flex items-center gap-2">
            {canSendMessages && (
              <Button variant="primary" size="sm" onClick={() => router.push('/messages/bulk')}>
                New Message
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => void handleRefresh()}>
              Refresh
            </Button>
            {totalUnreadCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleMarkAllAsRead()}
                loading={markingAll}
              >
                Mark all read
              </Button>
            )}
            {unmatchedCount > 0 && (
              <Button variant="secondary" size="sm" onClick={() => router.push('/messages/holding')}>
                Holding queue ({unmatchedCount})
              </Button>
            )}
            {canManageTemplates && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/settings/message-templates')}
              >
                Templates
              </Button>
            )}
          </div>
        }
      />

      {hasMoreUnread && (
        <Alert tone="warning" className="mb-4">
          Older unread messages exist. Open the customer profile to review everything.
        </Alert>
      )}

      {/* 3-panel layout on desktop; single-column list/thread on mobile. */}
      <Card className="h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden lg:h-[calc(100vh-14rem)]">
        <CardBody className="p-0 h-full">
        <div className="grid h-full grid-cols-1 lg:grid-cols-[320px_1fr_280px]">
          {/* ============ LEFT PANEL: Conversation List ============ */}
          <div className={`${showMobileThread ? 'hidden lg:flex' : 'flex'} flex-col border-r border-border h-full min-h-0`}>
            {/* Filter + Search */}
            <div className="p-3 border-b border-border space-y-2">
              <SectionNav items={filterItems} activeId={filter} onSelect={(id) => setFilter(id as ConversationFilter)} />
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search conversations..."
              />
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto">
              {displayedConversations.length === 0 ? (
                <div className="p-6">
                  <Empty
                    title={filter === 'unread' ? 'No unread conversations' : 'No conversations'}
                    description={
                      filter === 'unread'
                        ? 'You have responded to every customer.'
                        : 'Conversations will appear here once a customer reaches out.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {displayedConversations.map((conversation) => {
                    const isSelected = conversation.customer.id === selectedCustomerId
                    const unread = conversation.unreadCount > 0

                    return (
                      <li key={conversation.customer.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCustomerId(conversation.customer.id)
                            setShowMobileThread(true)
                          }}
                          className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
                            isSelected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                          }`}
                        >
                          <Avatar
                            name={formatCustomerName(conversation.customer)}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[13px] truncate ${unread ? 'font-semibold text-text-strong' : 'font-medium text-text'}`}>
                                {formatCustomerName(conversation.customer)}
                              </span>
                              <span className="text-[11px] text-text-muted whitespace-nowrap flex-shrink-0">
                                {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}
                              </span>
                            </div>
	                            <p className="text-xs text-text-muted truncate mt-0.5">
	                              {channelLabel(conversation.lastMessage.channel)} · {getPreviewText(conversation)}
	                            </p>
                            {unread && (
                              <Badge tone="info" className="mt-1">
                                {conversation.unreadCount} unread
                              </Badge>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ============ MIDDLE PANEL: Message Thread ============ */}
          <div className={`${showMobileThread ? 'flex' : 'hidden lg:flex'} flex-col h-full min-h-0`}>
            {!selectedCustomerId || !selectedCustomer ? (
              <div className="flex h-full items-center justify-center p-6">
                <Empty
                  title="Select a conversation"
                  description="Choose a customer from the left to view messages."
                />
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    {showMobileThread && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="lg:hidden"
                        onClick={() => setShowMobileThread(false)}
                      >
                        Back
                      </Button>
                    )}
                    <Avatar name={customerName} size="sm" />
                    <div className="min-w-0">
	                      <CustomerLink customerId={selectedCustomerId} name={customerName} className="block truncate text-sm font-semibold" />
                      <p className="text-xs text-text-muted">
                        {selectedConversation?.unreadCount
                          ? `${selectedConversation.unreadCount} unread`
                          : 'No unread messages'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 flex-shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => void handleMarkRead()}>
                      Mark read
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleMarkUnread()} loading={markingUnread}>
                      Mark unread
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => router.push(`/customers/${selectedCustomerId}`)}>
                      View profile
                    </Button>
                  </div>
                </div>

                {/* Messages area */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-2">
                  {messagesLoading ? (
                    <div className="flex h-full items-center justify-center">
                      <Spinner />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <Empty
                        title="No messages yet"
                        description="Start the conversation by sending a message."
                      />
                    </div>
                  ) : (
                    Object.entries(groupedMessages).map(([date, dateMessages]) => (
                      <div key={date}>
                        {/* Date separator */}
                        <div className="flex items-center justify-center mb-3">
                          <span className="px-3 py-0.5 text-[11px] font-medium text-text-muted bg-surface rounded-pill">
                            {date === getTodayIsoDate()
                              ? 'Today'
                              : formatDateInLondon(date, { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        </div>

	                        {dateMessages.map((message, index) => {
	                          const isOutbound = message.direction !== 'inbound'
	                          const showStatus =
	                            isOutbound &&
	                            (index === dateMessages.length - 1 ||
	                              (index < dateMessages.length - 1 && dateMessages[index + 1].direction === 'inbound'))
                            const messageText = message.body_text || message.subject || (message.has_attachments ? 'Attachment' : '')

	                          return (
	                            <div key={message.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-2`}>
	                              <div className="max-w-[85%] lg:max-w-[70%]">
                                  <div className={`mb-1 flex items-center gap-1.5 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                    <Badge tone="neutral">{channelLabel(message.channel)}</Badge>
                                    {message.has_attachments && <Badge tone="info">Attachment</Badge>}
                                  </div>
	                                <div
	                                  className={
	                                    isOutbound
                                      ? 'ml-auto bg-primary text-primary-fg rounded-2xl rounded-br-sm px-4 py-2'
                                      : 'mr-auto bg-surface-hover text-text rounded-2xl rounded-bl-sm px-4 py-2'
                                  }
                                >
                                    {message.subject && (
                                      <p className="mb-1 text-[12px] font-semibold">{message.subject}</p>
                                    )}
	                                  <p className="text-[13px] whitespace-pre-wrap break-words">{messageText}</p>
	                                </div>
                                <div className={`flex items-center gap-1.5 mt-0.5 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                  <span className="text-[11px] text-text-muted">
                                    {getMessageTime(message.created_at)}
                                  </span>
	                                  {showStatus && message.status && (
	                                    <span className="text-[11px] text-text-muted">
	                                      {getStatusText(message.status) || message.status}
	                                    </span>
	                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                {canReply && (
                  <div className="border-t border-border p-3">
                    <div className="flex gap-2">
                      <Textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message..."
                        rows={1}
                        className="flex-1 min-h-[36px] max-h-[120px] resize-none"
                        disabled={sending}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSend()}
                        loading={sending}
                        disabled={!newMessage.trim() || sending}
                        icon={<Icon name="message" size={16} />}
                      >
                        Send
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                      <span>{replySmsInfo.chars} characters</span>
                      <span>
                        {replySmsInfo.segments} SMS segment{replySmsInfo.segments === 1 ? '' : 's'}
                      </span>
                      {replySmsInfo.isUnicode && <Badge tone="warning">Unicode</Badge>}
                    </div>
                  </div>
                )}
                {selectedCustomer?.sms_opt_in === false && (
                  <div className="px-4 py-2 border-t border-border bg-surface-2">
                    <p className="text-xs text-danger">This customer has opted out of SMS.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ============ RIGHT PANEL: Contact Sidebar ============ */}
          <div className="hidden flex-col border-l border-border h-full overflow-y-auto lg:flex">
            {selectedCustomer ? (
              <div className="p-4 space-y-5">
                {/* Avatar + name */}
                <div className="flex flex-col items-center text-center">
                  <Avatar name={customerName} size="lg" />
                  <h3 className="text-sm font-semibold text-text-strong mt-3">{customerName}</h3>
                  <p className="text-xs text-text-muted">Customer</p>
                </div>

                {/* Detail rows */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Phone</p>
                    <p className="text-[13px] text-text mt-0.5">
	                      {selectedCustomer.mobile_number ?? 'Not on file'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Email</p>
                    <p className="text-[13px] text-text mt-0.5">
	                      {selectedCustomer.email ?? 'Not on file'}
                    </p>
	                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">WhatsApp</p>
                    <p className="text-[13px] text-text mt-0.5">
                      {selectedCustomer.whatsapp_opt_in ? (
                        <Badge tone="success">{selectedCustomer.whatsapp_status ?? 'Active'}</Badge>
                      ) : (
                        <Badge tone="warning">Not opted in</Badge>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">SMS Opt-in</p>
                    <p className="text-[13px] text-text mt-0.5">
                      {selectedCustomer.sms_opt_in === false ? (
                        <Badge tone="warning">Opted out</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => router.push(`/customers/${selectedCustomerId}`)}
                  >
                    View Full Profile
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-4">
                <p className="text-xs text-text-muted text-center">Select a conversation to see contact details</p>
              </div>
            )}
          </div>
        </div>
        </CardBody>
      </Card>
    </div>
  )
}
