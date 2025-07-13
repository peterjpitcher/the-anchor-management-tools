'use client'

import { useState, useRef, useEffect } from 'react'
import { sendSmsReply } from '@/app/actions/messageActions'
import toast from 'react-hot-toast'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'

import { Message } from '@/types/database'

interface MessageThreadProps {
  messages: Message[]
  customerId: string
  customerName: string
  canReply: boolean
  onMessageSent?: () => void
}

export function MessageThread({ messages, customerId, canReply, onMessageSent }: MessageThreadProps) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  
  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }

  // Scroll to bottom only on initial load
  useEffect(() => {
    scrollToBottom()
  }, [])

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const result = await sendSmsReply(customerId, newMessage)
      
      if ('error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success('Message sent')
        setNewMessage('')
        onMessageSent?.()
        setTimeout(scrollToBottom, 100) // Scroll after message is added to the list
      }
    } catch {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = new Date(message.created_at).toLocaleDateString()
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(message)
    return groups
  }, {} as Record<string, Message[]>)

  const getMessageTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  }

  const getStatusText = (status?: string) => {
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

  return (
    <div className="flex flex-col h-[500px] bg-white rounded-lg border border-gray-200">
      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-sm">No messages yet. Start a conversation!</p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, dateMessages]) => (
          <div key={date}>
            {/* Date separator */}
            <div className="flex items-center justify-center mb-4">
              <span className="px-3 py-1 text-xs text-gray-500 bg-gray-200 rounded-full">
                {date === new Date().toLocaleDateString() ? 'Today' : date}
              </span>
            </div>
            
            {/* Messages for this date */}
            {dateMessages.map((message, index) => {
              const isInbound = message.direction === 'inbound'
              const showStatus = !isInbound && 
                index === dateMessages.length - 1 || 
                (index < dateMessages.length - 1 && dateMessages[index + 1].direction === 'inbound')
              
              return (
                <div key={message.id}>
                  <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-2`}>
                    <div className={`max-w-[70%] ${isInbound ? 'order-1' : 'order-2'}`}>
                      <div
                        className={`px-4 py-2 rounded-2xl ${
                          isInbound
                            ? 'bg-gray-200 text-black rounded-tl-sm'
                            : 'bg-blue-500 text-white rounded-tr-sm'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
                      </div>
                      <div className={`flex items-center mt-1 ${isInbound ? 'justify-start' : 'justify-end'}`}>
                        <span className="text-xs text-gray-500">
                          {getMessageTime(message.created_at)}
                        </span>
                        {showStatus && message.twilio_status && (
                          <span className="ml-2 text-xs text-gray-500">
                            • {getStatusText(message.twilio_status)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply area */}
      {canReply && (
        <div className="border-t border-gray-200 bg-white p-3">
          <div className="flex items-end space-x-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message"
                rows={1}
                className="w-full px-4 py-2.5 pr-12 text-sm bg-gray-100 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                style={{ minHeight: '40px', maxHeight: '120px' }}
                onInput={(e) => {
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 120) + 'px'
                }}
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!newMessage.trim() || sending}
                className={`absolute right-1 bottom-1 p-1.5 rounded-full transition-all ${
                  newMessage.trim() && !sending
                    ? 'bg-blue-500 text-white hover:bg-blue-600 scale-100'
                    : 'bg-blue-500 text-white scale-0'
                }`}
              >
                <PaperAirplaneIcon className="h-4 w-4 -rotate-45" />
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-gray-400 text-center">
            Text Message • SMS
          </p>
        </div>
      )}
    </div>
  )
}