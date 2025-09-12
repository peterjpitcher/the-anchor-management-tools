'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMessages, markAllMessagesAsRead } from '@/app/actions/messagesActions'
import { formatDistanceToNow } from 'date-fns'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { SimpleList } from '@/components/ui-v2/display/List'

interface Conversation {
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    mobile_number: string;
  };
  messages: any[];
  unreadCount: number;
  lastMessageAt: string;
}

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)

  const loadMessages = useCallback(async () => {
    try {
      const result = await getMessages()
      
      if ('error' in result) {
        console.error('Failed to load messages:', result.error)
        toast.error('Failed to load messages')
        return
      }
      
      const convs = result.conversations || []
      setConversations(convs)
      setTotalUnreadCount(convs.reduce((sum, conv) => sum + conv.unreadCount, 0))
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMessages()

    // Set up periodic refresh every 5 seconds
    const interval = setInterval(() => {
      loadMessages()
    }, 5000)

    return () => clearInterval(interval)
  }, [loadMessages])

  const handleMarkAllAsRead = async () => {
    try {
      await markAllMessagesAsRead()
      toast.success('All messages marked as read')
      await loadMessages() // Refresh the list
    } catch {
      toast.error('Failed to mark messages as read')
    }
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader
          title="Unread Messages"
          backButton={{ label: "Back to Dashboard", href: "/dashboard" }}
        />
        <PageContent>
          <Card>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </Card>
        </PageContent>
      </PageWrapper>
    )
  }
  
  return (
    <PageWrapper>
      <PageHeader
        title="Unread Messages"
        subtitle={`New conversations from customers${totalUnreadCount > 0 ? ` (${totalUnreadCount} unread message${totalUnreadCount !== 1 ? 's' : ''})` : ''}`}
        backButton={{ label: "Back to Dashboard", href: "/dashboard" }}
        actions={
          <div className="flex gap-2">
            <NavLink href="/messages/queue">
              SMS Queue Status
            </NavLink>
            <NavLink href="/messages/bulk">
              Send Bulk Message
            </NavLink>
            {totalUnreadCount > 0 && (
              <NavLink onClick={handleMarkAllAsRead}>
                Mark all as read
              </NavLink>
            )}
          </div>
        }
      />
      <PageContent>
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
              items={conversations.map((conversation) => ({
                id: conversation.customer.id,
                href: `/customers/${conversation.customer.id}`,
                title: `${conversation.customer.first_name} ${conversation.customer.last_name}`,
                subtitle: conversation.customer.mobile_number,
                meta: (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    {conversation.messages.filter(m => m.direction === 'inbound' && !m.read_at).length > 0 && (
                      <Badge variant="info" size="sm" className="self-start">
                        {conversation.messages.filter(m => m.direction === 'inbound' && !m.read_at).length} unread
                      </Badge>
                    )}
                    <div className="text-left sm:text-right">
                      <p className="text-sm text-gray-500 whitespace-nowrap">
                        {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {conversation.messages.length} message{conversation.messages.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ),
                className: conversation.messages.filter(m => m.direction === 'inbound' && !m.read_at).length > 0 ? "bg-blue-50" : "",
              }))}
            />
          </Card>
        )}
      </PageContent>
    </PageWrapper>
  )
}
