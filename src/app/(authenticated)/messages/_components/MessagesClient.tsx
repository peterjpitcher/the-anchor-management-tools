'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'

import {
  PageHeader,
  Card,
  CardHeader,
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
import type { Message } from '@/types/database'

const REFRESH_INTERVAL = 15000

type ConversationFilter = 'all' | 'unread'

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
  if (body) return body.length > 90 ? `${body.slice(0, 90)}...` : body
  return conversation.lastMessage.direction === 'inbound' ? 'Inbound message' : 'Outbound message'
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

/* ------------------------------------------------------------------ */
/*  MessagesClient                                                     */
/* ------------------------------------------------------------------ */

export function MessagesClient() {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canSendMessages =
    hasPermission('messages', 'send') || hasPermission('messages', 'manage')
  const canManageTemplates = hasPermission('messages', 'manage_templates')

  // Conversation list state
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const [hasMoreUnread, setHasMoreUnread] = useState(false)
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [markingAll, setMarkingAll] = useState(false)

  // Thread state
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<ConversationSummary['customer'] | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
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

  // Group messages by date
  const groupedMessages = messages.reduce<Record<string, Message[]>>((groups, message) => {
    const date = new Date(message.created_at).toLocaleDateString()
    if (!groups[date]) groups[date] = []
    groups[date].push(message)
    return groups
  }, {})

  /* ---- Filter nav ---- */

  const filterItems = [
    { id: 'all', label: 'All', count: conversations.length },
    { id: 'unread', label: 'Unread', count: totalUnreadCount },
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

      {/* 3-panel layout: 320px conversation list + 1fr thread + 280px contact sidebar */}
      <Card className="h-[560px] overflow-hidden">
        <div className="grid grid-cols-[320px_1fr_280px] h-full">
          {/* ============ LEFT PANEL: Conversation List ============ */}
          <div className="flex flex-col border-r border-border h-full">
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
                          onClick={() => setSelectedCustomerId(conversation.customer.id)}
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
                              {getPreviewText(conversation)}
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
          <div className="flex flex-col h-full">
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
                    <Avatar name={customerName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-strong truncate">{customerName}</p>
                      <p className="text-xs text-text-muted">
                        {selectedConversation?.unreadCount
                          ? `${selectedConversation.unreadCount} unread`
                          : 'No unread messages'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
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
                            {date === new Date().toLocaleDateString() ? 'Today' : date}
                          </span>
                        </div>

                        {dateMessages.map((message, index) => {
                          const isOutbound = message.direction !== 'inbound'
                          const showStatus =
                            isOutbound &&
                            (index === dateMessages.length - 1 ||
                              (index < dateMessages.length - 1 && dateMessages[index + 1].direction === 'inbound'))

                          return (
                            <div key={message.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-2`}>
                              <div className="max-w-[70%]">
                                <div
                                  className={
                                    isOutbound
                                      ? 'ml-auto bg-primary text-primary-fg rounded-2xl rounded-br-sm px-4 py-2'
                                      : 'mr-auto bg-surface-hover text-text rounded-2xl rounded-bl-sm px-4 py-2'
                                  }
                                >
                                  <p className="text-[13px] whitespace-pre-wrap break-words">{message.body}</p>
                                </div>
                                <div className={`flex items-center gap-1.5 mt-0.5 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                  <span className="text-[11px] text-text-muted">
                                    {getMessageTime(message.created_at)}
                                  </span>
                                  {showStatus && message.twilio_status && (
                                    <span className="text-[11px] text-text-muted">
                                      {getStatusText(message.twilio_status)}
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
                  <div className="border-t border-border p-3 flex gap-2">
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
          <div className="flex flex-col border-l border-border h-full overflow-y-auto">
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
                      {(selectedCustomer as Record<string, unknown>).email
                        ? String((selectedCustomer as Record<string, unknown>).email)
                        : 'Not on file'}
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
      </Card>
    </div>
  )
}
