'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMessages, markAllMessagesAsRead } from '@/app/actions/messagesActions'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Skeleton, SkeletonCard } from '@/components/ui-v2/feedback/Skeleton'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { List, SimpleList } from '@/components/ui-v2/display/List'

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
      <Page title="Unread Messages">
        <Card>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </Card>
      </Page>
    )
  }
  
  return (
    <Page
      title="Unread Messages"
      description={`New conversations from customers${totalUnreadCount > 0 ? ` (${totalUnreadCount} unread message${totalUnreadCount !== 1 ? 's' : ''})` : ''}`}
      actions={
        <div className="flex gap-2">
          <LinkButton
            href="/messages/bulk"
            variant="primary"
          >
            Send Bulk Message
          </LinkButton>
          {totalUnreadCount > 0 && (
            <Button
              onClick={handleMarkAllAsRead}
              variant="secondary"
            >
              Mark all as read
            </Button>
          )}
        </div>
      }
    >
      
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
                <div className="flex items-center gap-4">
                  {conversation.messages.filter(m => m.direction === 'inbound' && !m.read_at).length > 0 && (
                    <Badge variant="info" size="sm">
                      {conversation.messages.filter(m => m.direction === 'inbound' && !m.read_at).length} unread
                    </Badge>
                  )}
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
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
    </Page>
  )
}