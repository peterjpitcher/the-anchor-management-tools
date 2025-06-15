'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { sendSmsReply } from '@/app/actions/messageActions'
import toast from 'react-hot-toast'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'

interface SmsReplyFormProps {
  customerId: string
  customerName: string
  onMessageSent?: () => void
}

export function SmsReplyForm({ customerId, customerName, onMessageSent }: SmsReplyFormProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim()) {
      toast.error('Please enter a message')
      return
    }

    setSending(true)
    try {
      const result = await sendSmsReply(customerId, message)
      
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Message sent successfully')
        setMessage('')
        onMessageSent?.()
      }
    } catch (error) {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="reply-message" className="block text-sm font-medium text-gray-700">
          Reply to {customerName}
        </label>
        <div className="mt-1">
          <textarea
            id="reply-message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
            disabled={sending}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Standard SMS rates apply. Messages are sent via Twilio.
        </p>
      </div>
      
      <div className="flex justify-end">
        <Button type="submit" disabled={sending || !message.trim()}>
          {sending ? (
            'Sending...'
          ) : (
            <>
              <PaperAirplaneIcon className="h-4 w-4 mr-2" />
              Send SMS
            </>
          )}
        </Button>
      </div>
    </form>
  )
}