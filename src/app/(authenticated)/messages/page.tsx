import { getMessages, markMessageAsRead, markAllMessagesAsRead } from '@/app/actions/messagesActions'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function MessagesPage() {
  const result = await getMessages()
  
  if ('error' in result) {
    console.error('Failed to load messages:', result.error)
    redirect('/dashboard')
  }
  
  const conversations = result.conversations || []
  const totalUnreadCount = conversations.reduce((sum, conv) => sum + conv.unreadCount, 0)
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Messages</h1>
          <p className="text-gray-600 mb-1">Conversations with customers</p>
          {totalUnreadCount > 0 && (
            <p className="text-gray-600 font-medium">{totalUnreadCount} unread message{totalUnreadCount !== 1 ? 's' : ''}</p>
          )}
        </div>
        {totalUnreadCount > 0 && (
          <form action={markAllMessagesAsRead}>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Mark all as read
            </button>
          </form>
        )}
      </div>
      
      {conversations.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <p className="text-lg">No messages yet</p>
          <p className="text-sm mt-2">When customers text your number, their conversations will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="divide-y divide-gray-200">
            {conversations.map((conversation) => (
              <Link
                key={conversation.customer.id}
                href={`/customers/${conversation.customer.id}`}
                className={`block p-4 hover:bg-gray-50 transition-colors ${
                  conversation.unreadCount > 0 ? 'bg-blue-50 hover:bg-blue-100' : ''
                }`}
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