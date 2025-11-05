'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'

import {
  getConversationMessages,
  getMessages,
  markAllMessagesAsRead,
  markConversationAsRead,
  markConversationAsUnread,
  type ConversationSummary,
} from '@/app/actions/messagesActions'
import { MessageThread } from '@/components/MessageThread'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import type { Message } from '@/types/database'

const REFRESH_INTERVAL = 15000

type ConversationFilter = 'all' | 'unread'

function formatCustomerName(conversation: ConversationSummary['customer']) {
  const name = [conversation.first_name, conversation.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (name) {
    return name
  }

  if (conversation.mobile_number) {
    return conversation.mobile_number
  }

  return 'Unknown customer'
}

function getPreviewText(conversation: ConversationSummary) {
  const body = conversation.lastMessage.body?.trim()

  if (body) {
    return body.length > 90 ? `${body.slice(0, 90)}…` : body
  }

  if (conversation.lastMessage.direction === 'inbound') {
    return 'Inbound message'
  }

  return 'Outbound message'
}

export default function MessagesPage() {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canSendMessages =
    hasPermission('messages', 'send') || hasPermission('messages', 'manage')

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<ConversationSummary['customer'] | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const [hasMoreUnread, setHasMoreUnread] = useState(false)
  const [filter, setFilter] = useState<ConversationFilter>('all')
  const [markingAll, setMarkingAll] = useState(false)
  const [markingUnread, setMarkingUnread] = useState(false)

  const loadConversations = useCallback(
    async (options: { withLoader?: boolean } = {}) => {
      const { withLoader = false } = options

      if (withLoader) {
        setListLoading(true)
      }

      try {
        const response = await getMessages()

        if ('error' in response) {
          toast.error(response.error)
          return
        }

        setConversations(response.conversations)
        setTotalUnreadCount(response.totalUnread)
        setHasMoreUnread(response.hasMoreUnread)
      } catch (error) {
        console.error('Error loading conversations:', error)
        toast.error('Failed to load conversations')
      } finally {
        if (withLoader) {
          setListLoading(false)
        }
      }
    },
    [],
  )

  const loadConversationMessages = useCallback(
    async (
      customerId: string,
      options: { markAsRead?: boolean; withLoader?: boolean } = {},
    ) => {
      const { markAsRead = false, withLoader = true } = options
      if (withLoader) {
        setMessagesLoading(true)
      }

      let previousConversation: ConversationSummary | null = null
      let previousUnread = 0

      if (markAsRead) {
        setConversations((prev) =>
          prev.map((conversation) => {
            if (conversation.customer.id === customerId) {
              previousConversation = conversation
              previousUnread = conversation.unreadCount
              if (conversation.unreadCount === 0) {
                return conversation
              }
              return { ...conversation, unreadCount: 0 }
            }
            return conversation
          }),
        )

        if (previousUnread > 0) {
          setTotalUnreadCount((prev) => Math.max(0, prev - previousUnread))
        }
      }

      if (markAsRead) {
        try {
          await markConversationAsRead(customerId)
        } catch (error) {
          console.error('Error marking conversation as read:', error)
          if (previousConversation) {
            const snapshot = previousConversation
            setConversations((prev) =>
              prev.map((conversation) =>
                conversation.customer.id === customerId ? snapshot : conversation,
              ),
            )
            if (previousUnread > 0) {
              setTotalUnreadCount((prev) => prev + previousUnread)
            }
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
      } catch (error) {
        console.error('Error loading conversation messages:', error)
        toast.error('Failed to load conversation')
      } finally {
        if (withLoader) {
          setMessagesLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    void loadConversations({ withLoader: true })
  }, [loadConversations])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadConversations()
      if (selectedCustomerId) {
        void loadConversationMessages(selectedCustomerId, {
          markAsRead: false,
          withLoader: false,
        })
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

    if (
      selectedCustomerId &&
      conversations.some((conversation) => conversation.customer.id === selectedCustomerId)
    ) {
      return
    }

    const firstUnread = conversations.find((conversation) => conversation.unreadCount > 0)
    const nextSelection = firstUnread?.customer.id ?? conversations[0]?.customer.id ?? null

    if (nextSelection && nextSelection !== selectedCustomerId) {
      setSelectedCustomerId(nextSelection)
    }
  }, [conversations, selectedCustomerId])

  useEffect(() => {
    if (!selectedCustomerId) {
      return
    }

    void loadConversationMessages(selectedCustomerId, { markAsRead: true })
  }, [selectedCustomerId, loadConversationMessages])

  const displayedConversations = useMemo(() => {
    if (filter === 'all') {
      return conversations
    }

    const unread = conversations.filter((conversation) => conversation.unreadCount > 0)
    if (
      selectedCustomerId &&
      !unread.some((conversation) => conversation.customer.id === selectedCustomerId)
    ) {
      const selected = conversations.find(
        (conversation) => conversation.customer.id === selectedCustomerId,
      )
      if (selected) {
        return [selected, ...unread]
      }
    }

    return unread
  }, [conversations, filter, selectedCustomerId])

  const handleRefresh = useCallback(async () => {
    await loadConversations({ withLoader: true })
    if (selectedCustomerId) {
      await loadConversationMessages(selectedCustomerId, {
        markAsRead: false,
        withLoader: false,
      })
    }
  }, [loadConversations, loadConversationMessages, selectedCustomerId])

  const handleMarkAllAsRead = useCallback(async () => {
    setMarkingAll(true)
    try {
      await markAllMessagesAsRead()
      toast.success('All conversations marked as read')
      await loadConversations({ withLoader: true })
      if (selectedCustomerId) {
        await loadConversationMessages(selectedCustomerId, {
          markAsRead: false,
          withLoader: false,
        })
      }
    } catch (error) {
      console.error('Error marking all messages as read:', error)
      toast.error('Failed to mark all messages as read')
    } finally {
      setMarkingAll(false)
    }
  }, [loadConversations, loadConversationMessages, selectedCustomerId])

  const handleMarkUnread = async () => {
    if (!selectedCustomerId) {
      return
    }

    let previousConversation: ConversationSummary | null = null
    let previousUnread = 0

    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.customer.id === selectedCustomerId) {
          previousConversation = conversation
          previousUnread = conversation.unreadCount
          const nextUnread = conversation.unreadCount > 0 ? conversation.unreadCount : 1
          return { ...conversation, unreadCount: nextUnread }
        }
        return conversation
      }),
    )

    if (previousUnread === 0) {
      setTotalUnreadCount((prev) => prev + 1)
    }

    setMarkingUnread(true)
    try {
      await markConversationAsUnread(selectedCustomerId)
      toast.success('Conversation marked as unread')
      await loadConversations()
    } catch (error) {
      console.error('Error marking conversation as unread:', error)
      if (previousConversation) {
        const snapshot = previousConversation
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.customer.id === selectedCustomerId ? snapshot : conversation,
          ),
        )
      }
      if (previousUnread === 0) {
        setTotalUnreadCount((prev) => Math.max(0, prev - 1))
      }
      toast.error('Failed to mark conversation as unread')
    } finally {
      setMarkingUnread(false)
    }
  }

  const handleMarkRead = async () => {
    if (!selectedCustomerId) {
      return
    }

    await loadConversationMessages(selectedCustomerId, {
      markAsRead: true,
      withLoader: false,
    })
    await loadConversations()
  }

  const navItems: HeaderNavItem[] = [
    { label: 'Send Bulk Message', href: '/messages/bulk' },
    {
      label: 'Refresh',
      onClick: () => {
        void handleRefresh()
      },
    },
    ...(totalUnreadCount > 0
      ? [
          {
            label: markingAll ? 'Marking…' : 'Mark all as read',
            onClick: () => {
              void handleMarkAllAsRead()
            },
            disabled: markingAll,
          },
        ]
      : []),
  ]

  const headerActions = (
    <div className="text-sm text-white/80">
      {totalUnreadCount > 0 ? `${totalUnreadCount} unread` : 'Inbox clear'}
    </div>
  )

  const selectedConversationSummary = selectedCustomerId
    ? conversations.find((conversation) => conversation.customer.id === selectedCustomerId)
    : undefined

  const customerName = selectedCustomer ? formatCustomerName(selectedCustomer) : ''

  if (listLoading && conversations.length === 0) {
    return (
      <PageLayout
        title="Messages Inbox"
        subtitle="Review and respond to customer conversations"
        backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
        navItems={navItems}
        headerActions={headerActions}
      >
        <Card>
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        </Card>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Messages Inbox"
      subtitle={
        totalUnreadCount > 0
          ? `${totalUnreadCount} unread message${totalUnreadCount === 1 ? '' : 's'}`
          : 'All caught up'
      }
      backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
      navItems={navItems}
      headerActions={headerActions}
    >
      {hasMoreUnread && (
        <Alert variant="warning" className="mb-4">
          Older unread messages exist. Open the customer profile to review everything.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card className="h-[75vh] [&_.card-body]:flex [&_.card-body]:h-full [&_.card-body]:min-h-0 [&_.card-body]:flex-col [&_.card-body]:p-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Conversations</h2>
                <p className="text-sm text-gray-500">
                  {conversations.length} active · {totalUnreadCount} unread
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={filter === 'all' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setFilter('all')}
                >
                  All
                </Button>
                <Button
                  variant={filter === 'unread' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setFilter('unread')}
                >
                  Unread
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {listLoading && conversations.length === 0 ? (
                <div className="p-4">
                  {[...Array(5)].map((_, index) => (
                    <Skeleton key={index} className="h-20" />
                  ))}
                </div>
              ) : displayedConversations.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title={filter === 'unread' ? 'No unread conversations' : 'No conversations'}
                    description={
                      filter === 'unread'
                        ? 'You have responded to every customer.'
                        : 'Conversations will appear here once a customer reaches out.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {displayedConversations.map((conversation) => {
                    const isSelected = conversation.customer.id === selectedCustomerId
                    const unread = conversation.unreadCount > 0

                    return (
                      <li key={conversation.customer.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedCustomerId(conversation.customer.id)}
                          className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition ${
                            isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-900">
                                {formatCustomerName(conversation.customer)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {conversation.customer.mobile_number ?? 'No number on record'}
                              </p>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-2 text-right">
                              {unread && (
                                <Badge variant="info" size="sm" className="whitespace-nowrap">
                                  {conversation.unreadCount} unread
                                </Badge>
                              )}
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                                  addSuffix: true,
                                })}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600">
                            {getPreviewText(conversation)}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card className="h-[75vh] [&_.card-body]:flex [&_.card-body]:h-full [&_.card-body]:min-h-0 [&_.card-body]:flex-col [&_.card-body]:p-0">
          {!selectedCustomerId || !selectedCustomer ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                title="Select a conversation"
                description="Choose a customer from the left to review recent messages."
              />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{customerName}</h2>
                  <div className="text-sm text-gray-500">
                    <p>{selectedCustomer.mobile_number ?? 'No number on record'}</p>
                    {selectedConversationSummary?.unreadCount ? (
                      <p className="mt-1 text-primary-600">
                        {selectedConversationSummary.unreadCount} unread message
                        {selectedConversationSummary.unreadCount === 1 ? '' : 's'}
                      </p>
                    ) : (
                      <p className="mt-1 text-gray-500">No unread messages</p>
                    )}
                    {selectedCustomer.sms_opt_in === false && (
                      <p className="mt-1 text-sm text-red-600">
                        This customer has opted out of SMS.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push(`/customers/${selectedCustomerId}`)}
                  >
                    View profile
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleMarkRead()
                    }}
                    disabled={messagesLoading}
                  >
                    Mark read
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleMarkUnread()
                    }}
                    loading={markingUnread}
                  >
                    Mark unread
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-0 px-4 pb-4 pt-2">
                {messagesLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                ) : (
                  <MessageThread
                    messages={messages}
                    customerId={selectedCustomerId}
                    customerName={customerName}
                    canReply={canSendMessages && selectedCustomer.sms_opt_in !== false}
                    onMessageSent={async () => {
                      if (!selectedCustomerId) {
                        return
                      }
                      await loadConversationMessages(selectedCustomerId, {
                        markAsRead: false,
                        withLoader: false,
                      })
                      await loadConversations()
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  )
}
