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
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { useRouter } from 'next/navigation'

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
    template:
      "Hi {customer_first_name}, your private event booking at The Anchor on {event_date} has been confirmed! We look forward to hosting your {event_type}. If you have any questions, reply to this message or call 01753 682 707. The Anchor Team"
  },
  {
    id: 'deposit_reminder',
    name: 'Deposit Reminder',
    message: 'Remind customer about deposit payment',
    template:
      "Hi {customer_first_name}, just a reminder that your £{deposit_amount} deposit for your event on {event_date} is due. Reply to this message if you need any help or call 01753 682 707 to arrange payment. Thank you! The Anchor"
  },
  {
    id: 'balance_reminder',
    name: 'Balance Reminder',
    message: 'Remind about final balance',
    template:
      "Hi {customer_first_name}, your event at The Anchor is coming up on {event_date}! Your remaining balance of £{balance_due} is due by {balance_due_date}. Reply to this message if you need any help or call 01753 682 707 to settle. Looking forward to seeing you!"
  },
  {
    id: 'event_reminder',
    name: 'Event Reminder',
    message: '24 hours before event',
    template:
      "Hi {customer_first_name}, just a reminder that your event at The Anchor is tomorrow at {start_time}! We're all set for your {guest_count} guests. If you need anything, reply to this message or call 01753 682 707. See you tomorrow!"
  },
  {
    id: 'setup_notification',
    name: 'Setup Time Notification',
    message: 'Notify about setup arrangements',
    template:
      'Hi {customer_first_name}, confirming setup for your event on {event_date}. Your vendors/team can access the venue from {setup_time}. The event space will be ready. Any questions? Reply to this message or call 01753 682 707.'
  },
  {
    id: 'thank_you',
    name: 'Thank You Message',
    message: 'Send after event completion',
    template:
      "Hi {customer_first_name}, thank you for choosing The Anchor for your event! We hope you and your guests had a wonderful time. We'd love to welcome you back again soon. Reply to this message if you need anything at all. Best wishes, The Anchor Team"
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
  const guestCount = booking.guest_count === null || booking.guest_count === undefined ? undefined : toNumber(booking.guest_count)
  const discountAmount = booking.discount_amount === null || booking.discount_amount === undefined ? undefined : toNumber(booking.discount_amount)
  const calculatedTotal = booking.calculated_total === null || booking.calculated_total === undefined ? undefined : toNumber(booking.calculated_total)

  return {
    ...booking,
    guest_count: guestCount,
    deposit_amount: toNumber(booking.deposit_amount),
    total_amount: toNumber(booking.total_amount),
    discount_amount: discountAmount,
    calculated_total: calculatedTotal
  }
}

interface PrivateBookingMessagesClientProps {
  bookingId: string
  initialBooking: PrivateBookingWithDetails
  canSendSms: boolean
}

export default function PrivateBookingMessagesClient({ bookingId, initialBooking, canSendSms }: PrivateBookingMessagesClientProps) {
  const router = useRouter()
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(() => normalizeBooking(initialBooking))
  const [loading, setLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customMessage, setCustomMessage] = useState<string>('')
  const [messageToSend, setMessageToSend] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [sentMessages, setSentMessages] = useState<PrivateBookingSmsQueue[]>(() => initialBooking.sms_queue?.filter((msg) => msg.status === 'sent') ?? [])

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
      setSentMessages(normalized.sms_queue?.filter((msg) => msg.status === 'sent') ?? [])
    }

    setLoading(false)
  }, [])

  const refreshBooking = useCallback(() => {
    loadBooking(bookingId)
  }, [bookingId, loadBooking])

  useEffect(() => {
    if (initialBooking) {
      const normalized = normalizeBooking(initialBooking)
      setBooking(normalized)
      setSentMessages(normalized.sms_queue?.filter((msg) => msg.status === 'sent') ?? [])
    }
  }, [initialBooking])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId)
    const template = smsTemplates.find((tpl) => tpl.id === templateId)
    if (!template || !booking) {
      setCustomMessage('')
      return
    }

    const replacements: Record<string, string> = {
      customer_first_name: booking.customer_first_name || booking.customer_name || '',
      event_date: booking.event_date ? formatDateFull(booking.event_date) : '',
      event_type: booking.event_type || 'event',
      deposit_amount: booking.deposit_amount?.toFixed(2) || '0.00',
      balance_due: (booking.calculated_total || 0).toFixed(2),
      balance_due_date: booking.balance_due_date ? formatDateFull(booking.balance_due_date) : '',
      start_time: booking.start_time ? formatTime12Hour(booking.start_time) : '',
      guest_count: booking.guest_count?.toString() || '',
      setup_time: booking.setup_time ? formatTime12Hour(booking.setup_time) : ''
    }

    const message = template.template.replace(/\{([^}]+)\}/g, (_, key) => replacements[key] || '')
    setCustomMessage(message)
  }

  const handleSendMessage = async () => {
    if (!booking) {
      toast.error('Booking information is missing.')
      return
    }

    if (!canSendSms) {
      toast.error('You do not have permission to send SMS messages.')
      return
    }

    const message = messageToSend.trim() || customMessage.trim()

    if (!message) {
      toast.error('Please enter a message to send.')
      return
    }

    if (!booking.contact_phone) {
      toast.error('No phone number available for this booking.')
      return
    }

    setSending(true)
    const result = await sendSms({
      to: booking.contact_phone,
      body: message,
      bookingId
    })
    setSending(false)

    if ('error' in result && result.error) {
      toast.error(result.error)
      return
    }

    toast.success('Message sent successfully.')
    setMessageToSend('')
    setSelectedTemplate('')
    setCustomMessage('')
    refreshBooking()
  }

  if (loading || !booking) {
    return (
      <Page
        title="Loading messages"
        description="Fetching booking information..."
        backButton={<BackButton onBack={() => router.push('/private-bookings')} />}
      >
        <Card className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </Card>
      </Page>
    )
  }

  const isDraft = booking.status === 'draft'
  const canSend = canSendSms && booking.contact_phone

  return (
    <Page
      title="Private Booking Messages"
      description={`Manage SMS communication for ${booking.customer_full_name || booking.customer_name}`}
      backButton={<BackButton onBack={() => router.push(`/private-bookings/${bookingId}`)} />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Section
            title="Send a Message"
            description="Choose a template or compose a custom message to send to the customer."
          >
            <Card>
              {!canSendSms && (
                <Alert
                  variant="warning"
                  title="SMS sending disabled"
                  className="mb-4"
                >
                  You do not have permission to send SMS messages. Contact an administrator if you believe this is an error.
                </Alert>
              )}

              {isDraft && (
                <Alert
                  variant="warning"
                  title="Booking still in draft"
                  className="mb-4"
                >
                  SMS updates are typically sent after the booking is confirmed. Review the booking status before messaging the customer.
                </Alert>
              )}

              <div className="space-y-6">
                <FormGroup label="Choose a template">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {smsTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => handleTemplateSelect(template.id)}
                        className={`border rounded-lg p-4 text-left transition-colors ${
                          selectedTemplate === template.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h3 className="font-medium text-gray-900 flex items-center gap-2">
                          <DevicePhoneMobileIcon className="h-5 w-5 text-blue-500" />
                          {template.name}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600">{template.message}</p>
                      </button>
                    ))}
                  </div>
                </FormGroup>

                <FormGroup label="Custom message">
                  <Textarea
                    value={messageToSend || customMessage}
                    onChange={(event) => {
                      setSelectedTemplate('')
                      setCustomMessage(event.target.value)
                      setMessageToSend(event.target.value)
                    }}
                    rows={6}
                    placeholder="Type your message here..."
                    disabled={!canSendSms}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Messages are sent via the venue SMS number. Reply instructions are added automatically.
                  </p>
                </FormGroup>

                <div className="flex items-center justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelectedTemplate('')
                      setCustomMessage('')
                      setMessageToSend('')
                    }}
                    disabled={!canSendSms}
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={handleSendMessage}
                    loading={sending}
                    disabled={!canSend || sending}
                  >
                    <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                    Send Message
                  </Button>
                </div>
              </div>
            </Card>
          </Section>

          <Section
            title="Message History"
            description="Recent SMS messages related to this booking."
          >
            <Card>
              {loading ? (
                <div className="flex justify-center py-8">
                  <Spinner size="sm" />
                </div>
              ) : sentMessages.length === 0 ? (
                <div className="text-center py-12">
                  <ChatBubbleLeftRightIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <p className="mt-3 text-sm text-gray-500">
                    No messages have been sent for this booking yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sentMessages
                    .sort((a, b) => new Date(b.sent_at ?? b.created_at ?? '').getTime() - new Date(a.sent_at ?? a.created_at ?? '').getTime())
                    .map((message) => {
                      const messageKey = message.id ?? message.twilio_sid ?? `${message.booking_id}-${message.created_at}`

                      return (
                        <div key={messageKey} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          <div className="flex items-center justify-between text-sm text-gray-600">
                            <span className="flex items-center gap-2">
                              <ClockIcon className="h-4 w-4" />
                              Sent {formatDateTime12Hour(message.sent_at ?? message.created_at ?? '')}
                            </span>
                            <Badge size="sm" variant="info">
                              {message.trigger_type?.replace(/_/g, ' ') || 'Manual message'}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">
                            {message.message_body}
                          </p>
                        </div>
                      )
                    })}
                </div>
              )}
            </Card>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Booking Summary">
            <Card>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-500">Customer</h3>
                  <p className="text-sm text-gray-900">
                    {booking.customer_full_name || booking.customer_name}
                  </p>
                  {booking.contact_phone && (
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <DevicePhoneMobileIcon className="h-4 w-4" />
                      {booking.contact_phone}
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500">Event Details</h3>
                  <p className="text-sm text-gray-900">
                    {booking.event_type || 'Private event'}{' '}
                    {booking.event_date ? `on ${formatDateFull(booking.event_date)}` : ''}
                  </p>
                  {booking.start_time && (
                    <p className="text-xs text-gray-500">Starts at {formatTime12Hour(booking.start_time)}</p>
                  )}
                </div>
                {booking.guest_count && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Guest Count</h3>
                    <p className="text-sm text-gray-900">{booking.guest_count} guests</p>
                  </div>
                )}
              </div>
            </Card>
          </Section>

          <Section title="SMS Delivery Status">
            <Card className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <CheckCircleIcon className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Delivered</p>
                  <p className="text-xs text-gray-500">Messages confirmed by Twilio.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <ExclamationCircleIcon className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Queued</p>
                  <p className="text-xs text-gray-500">Awaiting automatic send.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <XCircleIcon className="h-5 w-5 text-red-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Failed</p>
                  <p className="text-xs text-gray-500">Requires manual attention.</p>
                </div>
              </div>
            </Card>
          </Section>
        </div>
      </div>
    </Page>
  )
}
