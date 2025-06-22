'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  ArrowLeftIcon, 
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  XCircleIcon,
  DevicePhoneMobileIcon
} from '@heroicons/react/24/outline'
import { getPrivateBooking } from '@/app/actions/privateBookingActions'
import { sendSms } from '@/app/actions/sms'
import type { PrivateBookingWithDetails, PrivateBookingSmsQueue } from '@/types/private-bookings'

interface SmsTemplate {
  id: string
  name: string
  description: string
  template: string
}

const smsTemplates: SmsTemplate[] = [
  {
    id: 'booking_confirmation',
    name: 'Booking Confirmation',
    description: 'Send when booking is confirmed',
    template: 'Hi {customer_first_name}, your private event booking at The Anchor on {event_date} has been confirmed! We look forward to hosting your {event_type}. If you have any questions, please call us on 01753 682 707. The Anchor Team'
  },
  {
    id: 'deposit_reminder',
    name: 'Deposit Reminder',
    description: 'Remind customer about deposit payment',
    template: 'Hi {customer_first_name}, just a reminder that your £{deposit_amount} deposit for your event on {event_date} is due. Please call 01753 682 707 to arrange payment. Thank you! The Anchor'
  },
  {
    id: 'balance_reminder',
    name: 'Balance Reminder',
    description: 'Remind about final balance',
    template: 'Hi {customer_first_name}, your event at The Anchor is coming up on {event_date}! Your remaining balance of £{balance_due} is due by {balance_due_date}. Please call 01753 682 707 to settle. Looking forward to seeing you!'
  },
  {
    id: 'event_reminder',
    name: 'Event Reminder',
    description: '24 hours before event',
    template: 'Hi {customer_first_name}, just a reminder that your event at The Anchor is tomorrow at {start_time}! We\'re all set for your {guest_count} guests. If you need anything, call 01753 682 707. See you tomorrow!'
  },
  {
    id: 'setup_notification',
    name: 'Setup Time Notification',
    description: 'Notify about setup arrangements',
    template: 'Hi {customer_first_name}, confirming setup for your event on {event_date}. Your vendors/team can access the venue from {setup_time}. The event space will be ready. Any questions? Call 01753 682 707.'
  },
  {
    id: 'thank_you',
    name: 'Thank You Message',
    description: 'Send after event completion',
    template: 'Hi {customer_first_name}, thank you for choosing The Anchor for your event! We hope you and your guests had a wonderful time. We\'d love to welcome you back again soon. Best wishes, The Anchor Team'
  }
]

export default function MessagesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [bookingId, setBookingId] = useState<string>('')
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customMessage, setCustomMessage] = useState<string>('')
  const [messageToSend, setMessageToSend] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [sentMessages, setSentMessages] = useState<PrivateBookingSmsQueue[]>([])
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')

  useEffect(() => {
    params.then(p => {
      setBookingId(p.id)
      loadBooking(p.id)
    })
  }, [params])

  const loadBooking = async (id: string) => {
    setLoading(true)
    const result = await getPrivateBooking(id)
    if (result.data) {
      setBooking(result.data)
      // Load sent messages from SMS queue
      if (result.data.sms_queue) {
        setSentMessages(result.data.sms_queue.filter((msg: PrivateBookingSmsQueue) => msg.status === 'sent'))
      }
    }
    setLoading(false)
  }

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId)
    const template = smsTemplates.find(t => t.id === templateId)
    if (template && booking) {
      // Replace template variables
      let message = template.template
      const replacements: Record<string, string> = {
        customer_name: booking.customer_name, // Keep for backward compatibility
        customer_first_name: booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there',
        event_date: new Date(booking.event_date).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }),
        event_type: booking.event_type || 'event',
        guest_count: booking.guest_count?.toString() || 'your',
        start_time: booking.start_time,
        setup_time: booking.setup_time || booking.start_time,
        deposit_amount: booking.deposit_amount?.toFixed(0) || '250',
        balance_due: ((booking.calculated_total || 0) - (booking.deposit_paid_date ? (booking.deposit_amount || 0) : 0)).toFixed(0),
        balance_due_date: booking.balance_due_date ? new Date(booking.balance_due_date).toLocaleDateString('en-GB') : 'TBC'
      }

      Object.entries(replacements).forEach(([key, value]) => {
        message = message.replace(new RegExp(`{${key}}`, 'g'), value)
      })

      setMessageToSend(message)
      setCustomMessage('')
    }
  }

  const handleCustomMessageChange = (value: string) => {
    setCustomMessage(value)
    setMessageToSend(value)
    setSelectedTemplate('')
  }

  const handleSendMessage = async () => {
    if (!messageToSend.trim()) {
      setError('Please enter a message to send')
      return
    }

    if (!booking?.contact_phone) {
      setError('No phone number available for this booking')
      return
    }

    setSending(true)
    setError('')
    setSuccess('')

    try {
      const result = await sendSms({
        to: booking.contact_phone,
        body: messageToSend,
        bookingId: booking.id
      })

      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('Message sent successfully!')
        setMessageToSend('')
        setCustomMessage('')
        setSelectedTemplate('')
        // Reload to get updated SMS queue
        loadBooking(bookingId)
      }
    } catch {
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'failed':
        return <XCircleIcon className="h-5 w-5 text-red-500" />
      case 'pending':
      case 'approved':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />
      default:
        return <ExclamationCircleIcon className="h-5 w-5 text-gray-500" />
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <Link
          href={`/private-bookings/${bookingId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" />
          Back to booking
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="h-6 w-6 text-blue-600" />
                Send SMS Message
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {booking?.customer_name} - {booking?.contact_phone || 'No phone number'}
              </p>
            </div>
            {booking?.contact_phone && (
              <div className="flex items-center text-sm text-gray-500">
                <DevicePhoneMobileIcon className="h-5 w-5 mr-1" />
                SMS Ready
              </div>
            )}
          </div>
        </div>

        {!booking?.contact_phone && (
          <div className="p-4 bg-yellow-50 border-b border-yellow-200">
            <p className="text-sm text-yellow-800">
              No phone number is associated with this booking. Please add a contact phone number to send SMS messages.
            </p>
          </div>
        )}
      </div>

      {/* Message Composer */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Compose Message</h3>

          {/* Template Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Use a template
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {smsTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleTemplateSelect(template.id)}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedTemplate === template.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-gray-900">{template.name}</div>
                  <div className="text-sm text-gray-500 mt-1">{template.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Message */}
          <div className="mb-6">
            <label htmlFor="custom-message" className="block text-sm font-medium text-gray-700 mb-2">
              Or write a custom message
            </label>
            <textarea
              id="custom-message"
              rows={4}
              value={customMessage}
              onChange={(e) => handleCustomMessageChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Type your message here..."
            />
          </div>

          {/* Message Preview */}
          {messageToSend && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Preview
              </label>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{messageToSend}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {messageToSend.length} characters ({Math.ceil(messageToSend.length / 160)} SMS segment{Math.ceil(messageToSend.length / 160) > 1 ? 's' : ''})
                </p>
              </div>
            </div>
          )}

          {/* Error/Success Messages */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {/* Send Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSendMessage}
              disabled={!messageToSend || !booking?.contact_phone || sending}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PaperAirplaneIcon className="h-5 w-5 mr-2" />
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>
      </div>

      {/* Message History */}
      {sentMessages.length > 0 && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Message History</h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {sentMessages.map((message) => (
                <div key={message.id} className="flex items-start space-x-3">
                  {getStatusIcon(message.status)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">
                        {message.trigger_type === 'manual' ? 'Manual Message' : message.trigger_type}
                      </p>
                      <time className="text-sm text-gray-500">
                        {new Date(message.sent_at || message.created_at).toLocaleString('en-GB')}
                      </time>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{message.message_body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}