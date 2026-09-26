'use client'

import { useState, useRef, useEffect } from 'react'
import { sendSmsReply } from '@/app/actions/messageActions'
import toast from 'react-hot-toast'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'
import { Badge, Textarea } from '@/ds'
import { cn } from '@/lib/utils'
import { formatDateInLondon, formatDateTimeInLondon } from '@/lib/dateUtils'

import type { CommunicationChannel, CustomerCommunication } from '@/types/communications'

interface MessageThreadProps {
  messages: CustomerCommunication[]
  customerId: string
  customerName: string
  canReply: boolean
  onMessageSent?: () => void
}

export function MessageThread({ messages, customerId, canReply, onMessageSent }: MessageThreadProps) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledRef = useRef(false)

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      container.scrollTo({ top: container.scrollHeight, behavior })
    }
  }

  useEffect(() => {
    hasAutoScrolledRef.current = false
  }, [customerId])

  useEffect(() => {
    if (!messagesContainerRef.current || messages.length === 0) {
      return
    }

    const container = messagesContainerRef.current
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight

    if (!hasAutoScrolledRef.current) {
      scrollToBottom()
      hasAutoScrolledRef.current = true
      return
    }

    if (distanceFromBottom < 60) {
      // Keep the latest message in view when the user is already near the bottom
      scrollToBottom('smooth')
    }
  }, [messages])

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
        setTimeout(() => scrollToBottom('smooth'), 100) // Scroll after message is added to the list
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
    const date = formatDateInLondon(message.created_at)
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(message)
    return groups
  }, {} as Record<string, CustomerCommunication[]>)

  const getMessageTime = (timestamp: string) => {
    // en-US: en-GB with hour12 renders noon as "0pm" on Node 20.
    return formatDateTimeInLondon(timestamp, { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }, 'en-US')
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

  const getChannelLabel = (channel: CommunicationChannel) => {
    if (channel === 'sms') return 'SMS'
    if (channel === 'whatsapp') return 'WhatsApp'
    if (channel === 'email') return 'Email'
    if (channel === 'feedback') return 'Feedback'
    return channel
  }

  return (
    <div className="flex flex-col h-[400px] sm:h-[500px] md:h-[600px] bg-surface rounded-lg border border-border">
      {/* Messages area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-2">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm sm:text-base text-center">No messages yet. Start a conversation!</p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, dateMessages]) => (
          <div key={date}>
            {/* Date separator */}
            <div className="flex items-center justify-center mb-4">
              <span className="rounded-pill border border-border bg-surface px-3 py-0.5 text-meta font-medium text-text-muted shadow-sm">
                {date === formatDateInLondon(new Date()) ? 'Today' : date}
              </span>
            </div>
            
            {/* Messages for this date */}
            {dateMessages.map((message, index) => {
              const isInbound = message.direction === 'inbound'
              const isFailed =
                !isInbound && (message.status === 'failed' || message.status === 'undelivered')
              // A failed message is always shown. The status previously rendered
              // only on the last message of a date group (or one followed by an
              // inbound reply), so a failure followed by another outbound message
              // the same day was invisible and staff believed the customer had
              // been contacted.
              const showStatus = !isInbound && (
                isFailed ||
                index === dateMessages.length - 1 ||
                (index < dateMessages.length - 1 && dateMessages[index + 1].direction === 'inbound')
              )
              const messageText = message.body_text || message.subject || (message.has_attachments ? 'Attachment' : '')
	              
              return (
                <div key={message.id}>
                  <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-2`}>
                    <div className={`max-w-[85%] sm:max-w-[70%] ${isInbound ? 'order-1' : 'order-2'}`}>
                      <div className={`mb-1 flex items-center gap-1 ${isInbound ? 'justify-start' : 'justify-end'}`}>
                        <Badge tone="neutral">{getChannelLabel(message.channel)}</Badge>
                        {message.has_attachments && <Badge tone="info">Attachment</Badge>}
                      </div>
                      {/* Same bubbles as the /messages inbox (ConversationThread), so a conversation
                          looks the same wherever staff read it. */}
                      <div
                        className={cn(
                          'rounded-xl px-3.5 py-2',
                          isInbound
                            ? 'border border-border bg-surface text-text rounded-bl-sm'
                            : 'bg-primary text-primary-fg rounded-br-sm',
                          isFailed && 'ring-2 ring-danger/50',
                        )}
                      >
                        {message.subject && (
                          <p className="mb-1 text-xs font-semibold">{message.subject}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words text-ui leading-relaxed">{messageText}</p>
                      </div>
                      <div className={`flex items-center mt-1 ${isInbound ? 'justify-start' : 'justify-end'}`}>
                        <span className="text-xs sm:text-sm text-text-muted">
                          {getMessageTime(message.created_at)}
                        </span>
                        {showStatus && message.status && (
                          isFailed ? (
                            <Badge tone="danger" className="ml-2">
                              {getStatusText(message.status) || message.status}
                            </Badge>
                          ) : (
                            <span className="ml-2 text-xs sm:text-sm text-text-muted">
                              • {getStatusText(message.status) || message.status}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )))}
      </div>

      {/* Reply area */}
      {canReply && (
        <div className="border-t border-border bg-surface p-3">
          <div className="flex items-end space-x-2">
            <div className="flex-1 relative">
              <Textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message"
                aria-label="Message"
                rows={1}
                className="min-h-touch max-h-[120px] resize-none pr-12"
                onInput={(e) => {
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 120) + 'px'
                }}
                disabled={sending}
              />
              {/* Stays a plain button: it floats inside the field and scales in once there is
                  text, which the DS IconButton's fixed sizes cannot do. Below the shell
                  breakpoint every button is at least 44px, as tall as the one-line field, so
                  it sits flush with the field's bottom rather than poking out of its top. */}
              <button type="button"
                onClick={handleSend}
                disabled={!newMessage.trim() || sending}
                aria-label="Send message"
                className={`absolute right-1 bottom-1 max-shell:bottom-0 p-2 sm:p-1.5 rounded-full bg-primary text-primary-fg transition-all touch-manipulation focus-visible:outline-hidden focus-visible:shadow-ring ${
                  newMessage.trim() && !sending
                    ? 'hover:bg-primary-hover scale-100'
                    : 'scale-0'
                }`}
              >
                <PaperAirplaneIcon className="h-5 w-5 sm:h-4 sm:w-4 -rotate-45" />
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-xs sm:text-sm text-text-soft text-center">
            Text Message • SMS
          </p>
        </div>
      )}
    </div>
  )
}
