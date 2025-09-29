'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
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
import { formatDateFull, formatTime12Hour, formatDateTime12Hour } from '@/lib/dateUtils'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter, useParams } from 'next/navigation';
interface SmsTemplate {
  id: string
  name: string
  message: string
  template: string
}

const smsTemplates: SmsTemplate[] = [
  {
    id: 'booking_confirmation',
    name: 'Booking Confirmation',
    message: 'Send when booking is confirmed',
    template: 'Hi {customer_first_name}, your private event booking at The Anchor on {event_date} has been confirmed! We look forward to hosting your {event_type}. If you have any questions, please call us on 01753 682 707. The Anchor Team'
  },
  {
    id: 'deposit_reminder',
    name: 'Deposit Reminder',
    message: 'Remind customer about deposit payment',
    template: 'Hi {customer_first_name}, just a reminder that your £{deposit_amount} deposit for your event on {event_date} is due. Please call 01753 682 707 to arrange payment. Thank you! The Anchor'
  },
  {
    id: 'balance_reminder',
    name: 'Balance Reminder',
    message: 'Remind about final balance',
    template: 'Hi {customer_first_name}, your event at The Anchor is coming up on {event_date}! Your remaining balance of £{balance_due} is due by {balance_due_date}. Please call 01753 682 707 to settle. Looking forward to seeing you!'
  },
  {
    id: 'event_reminder',
    name: 'Event Reminder',
    message: '24 hours before event',
    template: 'Hi {customer_first_name}, just a reminder that your event at The Anchor is tomorrow at {start_time}! We\'re all set for your {guest_count} guests. If you need anything, call 01753 682 707. See you tomorrow!'
  },
  {
    id: 'setup_notification',
    name: 'Setup Time Notification',
    message: 'Notify about setup arrangements',
    template: 'Hi {customer_first_name}, confirming setup for your event on {event_date}. Your vendors/team can access the venue from {setup_time}. The event space will be ready. Any questions? Call 01753 682 707.'
  },
  {
    id: 'thank_you',
    name: 'Thank You Message',
    message: 'Send after event completion',
    template: 'Hi {customer_first_name}, thank you for choosing The Anchor for your event! We hope you and your guests had a wonderful time. We\'d love to welcome you back again soon. Best wishes, The Anchor Team'
  }
]

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (value === null || value === undefined) {
    return fallback
  }
  return fallback
}

const normalizeBooking = (booking: PrivateBookingWithDetails): PrivateBookingWithDetails => {
  const guestCount = booking.guest_count === null || booking.guest_count === undefined
    ? undefined
    : toNumber(booking.guest_count)

  const discountAmount = booking.discount_amount === null || booking.discount_amount === undefined
    ? undefined
    : toNumber(booking.discount_amount)

  const calculatedTotal = booking.calculated_total === null || booking.calculated_total === undefined
    ? undefined
    : toNumber(booking.calculated_total)

  return {
    ...booking,
    guest_count: guestCount,
    deposit_amount: toNumber(booking.deposit_amount),
    total_amount: toNumber(booking.total_amount),
    discount_amount: discountAmount,
    calculated_total: calculatedTotal,
  }
}

export default function MessagesPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const bookingId = Array.isArray(params?.id) ? params.id[0] : params?.id ?? ''
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customMessage, setCustomMessage] = useState<string>('')
  const [messageToSend, setMessageToSend] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [sentMessages, setSentMessages] = useState<PrivateBookingSmsQueue[]>([])

  const loadBooking = useCallback(async (id: string) => {
    setLoading(true)
    const result = await getPrivateBooking(id)

    if ('error' in result && result.error) {
      toast.error(result.error)
      setLoading(false)
      return
    }

    if (result.data) {
      const normalized = normalizeBooking(result.data)
      setBooking(normalized)
      if (normalized.sms_queue) {
        setSentMessages(
          normalized.sms_queue.filter((msg) => msg.status === 'sent')
        )
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    if (!bookingId) {
      return
    }
    loadBooking(bookingId)
  }, [bookingId, loadBooking])

  const refreshBooking = useCallback(() => {
    if (!bookingId) {
      return
    }
    loadBooking(bookingId)
  }, [bookingId, loadBooking])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId)
    const template = smsTemplates.find(t => t.id === templateId)
    if (template && booking) {
      // Replace template variables
      let message = template.template
      const depositAmountValue = booking.deposit_amount != null
        ? toNumber(booking.deposit_amount)
        : 250
      const totalValue = toNumber(booking.calculated_total ?? booking.total_amount)
      const depositApplied = booking.deposit_paid_date ? depositAmountValue : 0
      const balanceDueValue = Math.max(0, Math.round(totalValue - depositApplied))
      const depositDisplay = Math.max(0, Math.round(depositAmountValue))

      const replacements: Record<string, string> = {
        customer_name: booking.customer_name, // Keep for backward compatibility
        customer_first_name: booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there',
        event_date: formatDateFull(booking.event_date),
        event_type: booking.event_type || 'event',
        guest_count: booking.guest_count !== undefined ? booking.guest_count.toString() : 'your',
        start_time: formatTime12Hour(booking.start_time),
        setup_time: formatTime12Hour(booking.setup_time || booking.start_time),
        deposit_amount: depositDisplay.toString(),
        balance_due: balanceDueValue.toString(),
        balance_due_date: booking.balance_due_date ? formatDateFull(booking.balance_due_date) : 'TBC'
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
      toast.error('Please enter a message to send')
      return
    }

    if (!booking?.contact_phone) {
      toast.error('No phone number available for this booking')
      return
    }

    const confirmed = typeof window !== 'undefined'
      ? window.confirm('Send this SMS message now?')
      : true

    if (!confirmed) {
      toast.info('SMS sending cancelled')
      return
    }

    setSending(true)

    try {
      const result = await sendSms({
        to: booking.contact_phone,
        body: messageToSend,
        bookingId: booking.id,
        customerId: booking.customer_id || booking.customer?.id || undefined
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Message sent successfully!')
        setMessageToSend('')
        setCustomMessage('')
        setSelectedTemplate('')
        // Reload to get updated SMS queue
        refreshBooking()
      }
    } catch {
      toast.error('Failed to send message')
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
      <Page title="Send SMS Message"
      actions={<BackButton label="Back to Booking" onBack={() => router.back()} />}
    >
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="Send SMS Message"
      description={`${booking?.customer_name} - ${booking?.contact_phone || 'No phone number'}`}
      actions={
        <LinkButton href={`/private-bookings/${bookingId}`} variant="secondary">Back</LinkButton>
      }
    >
      {/* Header Card */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChatBubbleLeftRightIcon className="h-6 w-6 text-blue-600" />
            <div>
              <h3 className="font-medium">SMS Messaging</h3>
              <p className="text-sm text-gray-500">Send messages to the customer</p>
            </div>
          </div>
          {booking?.contact_phone ? (
            <Badge variant="success">
              <DevicePhoneMobileIcon className="h-4 w-4 mr-1" />
              SMS Ready
            </Badge>
          ) : (
            <Badge variant="warning">No Phone Number</Badge>
          )}
        </div>

        {!booking?.contact_phone && (
          <Alert variant="warning" className="mt-4">
            No phone number is associated with this booking. Please add a contact phone number to send SMS messages.
          </Alert>
        )}
      </Card>

      {/* Message Composer */}
      <Card className="mb-6">
        <Section title="Compose Message">
          {/* Template Selection */}
          <FormGroup label="Use a template">
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
                  <div className="text-sm text-gray-500 mt-1">{template.message}</div>
                </button>
              ))}
            </div>
          </FormGroup>

          {/* Custom Message */}
          <FormGroup label="Or write a custom message">
            <Textarea
              rows={4}
              value={customMessage}
              onChange={(e) => handleCustomMessageChange(e.target.value)}
              placeholder="Type your message here..."
            />
          </FormGroup>

          {/* Message Preview */}
          {messageToSend && (
            <FormGroup label="Message Preview">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{messageToSend}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {messageToSend.length} characters ({Math.ceil(messageToSend.length / 160)} SMS segment{Math.ceil(messageToSend.length / 160) > 1 ? 's' : ''})
                </p>
              </div>
            </FormGroup>
          )}

          {/* Send Button */}
          <div className="flex justify-end">
            <Button onClick={handleSendMessage}
              disabled={!messageToSend || !booking?.contact_phone || sending}
              loading={sending}
              leftIcon={<PaperAirplaneIcon className="h-5 w-5" />}
            >
              Send Message
            </Button>
          </div>
        </Section>
      </Card>

      {/* Message History */}
      {sentMessages.length > 0 && (
        <Card>
          <Section title="Message History">
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
                        {formatDateTime12Hour(message.sent_at || message.created_at)}
                      </time>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{message.message_body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </Card>
      )}
    </Page>
  )
}
