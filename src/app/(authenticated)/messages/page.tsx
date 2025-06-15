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
  
  const messages = result.messages || []
  const unreadCount = messages.filter(m => m.direction === 'inbound' && !m.read_at).length
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Messages</h1>
          {unreadCount > 0 && (
            <p className="text-gray-600">{unreadCount} unread message{unreadCount !== 1 ? 's' : ''}</p>
          )}
        </div>
        {unreadCount > 0 && (
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
      
      {messages.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No messages yet
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="divide-y divide-gray-200">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`p-4 hover:bg-gray-50 transition-colors ${
                  message.direction === 'inbound' && !message.read_at ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <Link
                        href={`/customers/${message.customer_id}`}
                        className="font-medium text-green-600 hover:underline"
                      >
                        {message.customer.first_name} {message.customer.last_name}
                      </Link>
                      <span className="text-sm text-gray-500">
                        {message.customer.mobile_number}
                      </span>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        message.direction === 'inbound' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {message.direction === 'inbound' ? 'Received' : 'Sent'}
                      </span>
                      {message.direction === 'inbound' && !message.read_at && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Unread
                        </span>
                      )}
                    </div>
                    <p className="text-gray-900 mb-2">{message.body}</p>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span>
                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                      </span>
                      {message.twilio_status && (
                        <span>Status: {message.twilio_status}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {message.direction === 'inbound' && !message.read_at && (
                      <form action={markMessageAsRead.bind(null, message.id)}>
                        <button
                          type="submit"
                          className="text-sm text-green-600 hover:text-green-700 font-medium"
                        >
                          Mark as read
                        </button>
                      </form>
                    )}
                    <Link
                      href={`/customers/${message.customer_id}`}
                      className="text-sm text-gray-600 hover:text-gray-900"
                    >
                      View customer →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}