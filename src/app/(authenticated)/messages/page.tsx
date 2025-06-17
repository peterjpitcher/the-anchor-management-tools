'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMessages, markMessageAsRead, markAllMessagesAsRead } from '@/app/actions/messagesActions'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

export default function MessagesPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<any[]>([])
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
    } catch (error) {
      toast.error('Failed to mark messages as read')
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-gray-500">Loading messages...</div>
      </div>
    )
  }
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Unread Messages</h1>
          <p className="text-gray-600 mb-1">New conversations from customers</p>
          {totalUnreadCount > 0 && (
            <p className="text-gray-600 font-medium">{totalUnreadCount} unread message{totalUnreadCount !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href="/messages/bulk"
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Send Bulk Message
          </Link>
          {totalUnreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>
      
      {conversations.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <p className="text-lg">No unread messages</p>
          <p className="text-sm mt-2">All customer messages have been read</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="divide-y divide-gray-200">
            {conversations.map((conversation) => (
              <Link
                key={conversation.customer.id}
                href={`/customers/${conversation.customer.id}`}
                className="block p-4 bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-1">
                      <h3 className="font-medium text-gray-900">
                        {conversation.customer.first_name} {conversation.customer.last_name}
                      </h3>
                      {conversation.unreadCount > 0 && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {conversation.unreadCount} unread
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {conversation.customer.mobile_number}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {conversation.messages.length} message{conversation.messages.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}