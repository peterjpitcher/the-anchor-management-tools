'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMessages, markAllMessagesAsRead } from '@/app/actions/messagesActions'
import { formatDistanceToNow } from 'date-fns'
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { SimpleList } from '@/components/ui-v2/display/List'
import { usePermissions } from '@/contexts/PermissionContext'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

type ConversationMessage = {
  id: string;
  customer_id: string;
  body: string | null;
  direction: string;
  created_at: string;
  read_at: string | null;
}

interface Conversation {
  customer: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    mobile_number: string | null;
  };
  messages: ConversationMessage[];
  unreadCount: number;
  lastMessageAt: string;
}

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const [hasMoreUnread, setHasMoreUnread] = useState(false)
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('messages', 'manage')

  const loadMessages = useCallback(async (withLoader = false) => {
    try {
      if (withLoader) {
        setLoading(true)
      }

      const result = await getMessages()
      
      if ('error' in result) {
        console.error('Failed to load messages:', result.error)
        toast.error('Failed to load messages')
        return
      }
      
      const convs = (result.conversations || []) as unknown as Conversation[]
      setConversations(convs)

      const totalUnread = 'totalUnread' in result && typeof result.totalUnread === 'number'
        ? result.totalUnread
        : convs.reduce((sum, conv) => sum + conv.unreadCount, 0)

      setTotalUnreadCount(totalUnread)
      setHasMoreUnread('hasMore' in result ? Boolean(result.hasMore) : false)
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      if (withLoader) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadMessages(true)

    // Set up periodic refresh every 15 seconds
    const interval = setInterval(() => {
      void loadMessages()
    }, 15000)

    return () => clearInterval(interval)
  }, [loadMessages])

  const handleMarkAllAsRead = async () => {
    if (!canManage) {
      toast.error('You do not have permission to mark messages as read')
      return
    }
    try {
      await markAllMessagesAsRead()
      toast.success('All messages marked as read')
      await loadMessages()
    } catch (error) {
      console.error('Failed to mark messages as read', error)
      toast.error('Failed to mark messages as read')
    }
  }

  const navItems: HeaderNavItem[] = [
    { label: 'SMS Queue Status', href: '/messages/queue' },
    { label: 'Send Bulk Message', href: '/messages/bulk' },
    ...(canManage && totalUnreadCount > 0
      ? [{ label: 'Mark all as read', onClick: handleMarkAllAsRead }]
      : []),
  ]

  if (loading) {
    return (
      <PageLayout
        title="Unread Messages"
        backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
        navItems={navItems}
      >
        <Card>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </Card>
      </PageLayout>
    )
  }
  
  return (
    <PageLayout
      title="Unread Messages"
      subtitle={`New conversations from customers${totalUnreadCount > 0 ? ` (${totalUnreadCount} unread message${totalUnreadCount !== 1 ? 's' : ''})` : ''}`}
      backButton={{ label: 'Back to Dashboard', href: '/dashboard' }}
      navItems={navItems}
    >
      {hasMoreUnread && (
        <Alert variant="warning">
          Showing the 200 most recent unread messages. Visit the customer record to review older unread conversations.
        </Alert>
      )}
      {conversations.length === 0 ? (
        <Card>
          <EmptyState
            title="No unread messages"
            description="All customer messages have been read"
          />
        </Card>
      ) : (
        <Card>
          <SimpleList
            items={conversations.map((conversation) => {
              const unreadCount = conversation.messages.filter(
                (m) => m.direction === 'inbound' && !m.read_at,
              ).length

              const fullName = [conversation.customer.first_name, conversation.customer.last_name]
                .filter(Boolean)
                .join(' ')
                .trim()

              const subtitle = conversation.customer.mobile_number || 'No phone number on record'

              return {
                id: conversation.customer.id,
                href: `/customers/${conversation.customer.id}`,
                title: fullName || subtitle,
                subtitle,
                meta: (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    {unreadCount > 0 && (
                      <Badge variant="info" size="sm" className="self-start">
                        {unreadCount} unread
                      </Badge>
                    )}
                    <div className="text-left sm:text-right">
                      <p className="text-sm text-gray-500 whitespace-nowrap">
                        {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {conversation.messages.length} message
                        {conversation.messages.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ),
                className: unreadCount > 0 ? 'bg-blue-50' : '',
              }
            })}
          />
        </Card>
      )}
    </PageLayout>
  )
}
