'use client'

import { useState, useEffect, useCallback } from 'react'
import { getPrivateBooking, sendPrivateBookingEmail, sendPrivateBookingSms } from '@/app/actions/privateBookingActions'
import {
  STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT,
  defaultStaffMessageChannel,
  type StaffMessageChannel,
} from '@/lib/messaging/staff-email-defaults'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Empty,
  Field,
  Fieldset,
  FormFooter,
  Icon,
  Input,
  PageLayout,
  PageLoading,
  Radio,
  Textarea,
  toast,
} from '@/ds'
import type { PrivateBookingWithDetails, PrivateBookingSmsQueue } from '@/types/private-bookings'
import { formatDateFull, formatTime12Hour, formatDateTime12Hour } from '@/lib/dateUtils'
import { useRouter } from 'next/navigation'
import { PB_BACK_TO_LIST, PB_DETAIL_NAV } from '../../_shared/nav'
import { SENT_MESSAGE_TRIGGER_TONE } from '../../_shared/status-ui'

interface SmsTemplate {
  id: string
  name: string
  message: string
  template: string
}

// Template suggestions for the manual-send UI. Copy style mirrors the
// automated builders in src/lib/private-bookings/messages.ts: no
// "The Anchor:" opener, first-name-first, em-dash rhythm. These are only
// prefills: staff can edit before sending.
const smsTemplates: SmsTemplate[] = [
  {
    id: 'booking_confirmation',
    name: 'Booking Confirmation',
    message: 'Send when booking is confirmed',
    template:
      "Hi {customer_first_name} — you're all confirmed for {event_date}. Can't wait."
  },
  {
    id: 'deposit_reminder',
    name: 'Deposit Reminder',
    message: 'Remind customer about deposit payment',
    template:
      "Hi {customer_first_name} — quick nudge on your £{deposit_amount} deposit for {event_date}. Get it in and the date's yours."
  },
  {
    id: 'balance_reminder',
    name: 'Balance Reminder',
    message: 'Remind about final balance',
    template:
      'Hi {customer_first_name} — £{balance_due} balance still to settle by {balance_due_date} to keep {event_date} on track.'
  },
  {
    id: 'event_reminder',
    name: 'Event Reminder',
    message: '24 hours before event',
    template:
      "Hi {customer_first_name} — tomorrow's the day. Everything's ready for your {guest_count} guests. See you then."
  },
  {
    id: 'setup_notification',
    name: 'Setup Time Notification',
    message: 'Notify about setup arrangements',
    template:
      'Hi {customer_first_name} — setup for {event_date} confirmed. Your team can access the venue from {setup_time}.'
  },
  {
    id: 'thank_you',
    name: 'Thank You Message',
    message: 'Send after event completion',
    template:
      'Hi {customer_first_name} — thanks for choosing The Anchor. Hope it was everything you wanted.'
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
  const grossTotal = booking.gross_total === null || booking.gross_total === undefined ? undefined : toNumber(booking.gross_total)

  return {
    ...booking,
    guest_count: guestCount,
    deposit_amount: toNumber(booking.deposit_amount),
    total_amount: toNumber(booking.total_amount),
    discount_amount: discountAmount,
    calculated_total: calculatedTotal,
    gross_total: grossTotal
  }
}

interface PrivateBookingMessagesClientProps {
  bookingId: string
  initialBooking: PrivateBookingWithDetails | null
  initialError?: string | null
  canSendSms: boolean
  /** P7: an email choice beside the text, while the option is on; email is the default when usable. */
  emailOption?: { enabled: boolean; usable: boolean }
}

export default function PrivateBookingMessagesClient({
  bookingId,
  initialBooking,
  initialError,
  canSendSms,
  emailOption
}: PrivateBookingMessagesClientProps) {
  const router = useRouter()
  const [booking, setBooking] = useState<PrivateBookingWithDetails | null>(() =>
    initialBooking ? normalizeBooking(initialBooking) : null
  )
  const [loading, setLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [customMessage, setCustomMessage] = useState<string>('')
  const [messageToSend, setMessageToSend] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [channel, setChannel] = useState<StaffMessageChannel>(() => defaultStaffMessageChannel(emailOption))
  const [emailSubject, setEmailSubject] = useState<string>(STAFF_BOOKING_EMAIL_DEFAULT_SUBJECT)
  const emailChosen = Boolean(emailOption?.enabled) && channel === 'email'
  const [sentMessages, setSentMessages] = useState<PrivateBookingSmsQueue[]>(() =>
    initialBooking?.sms_queue?.filter((msg) => msg.status === 'sent') ?? []
  )

  const loadBooking = useCallback(async (id: string) => {
    setLoading(true)
    const result = await getPrivateBooking(id, 'messages')

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
      return
    }
    setBooking(null)
    setSentMessages([])
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
      // What is still owed, not the whole booking total. Quoting the total here
      // asked the customer again for everything they had already paid.
      balance_due: (
        booking.balance_remaining ??
        booking.gross_total ??
        booking.calculated_total ??
        booking.total_amount ??
        0
      ).toFixed(2),
      balance_due_date: booking.balance_due_date ? formatDateFull(booking.balance_due_date) : '',
      start_time: booking.start_time ? formatTime12Hour(booking.start_time) : '',
      guest_count: booking.guest_count?.toString() || '',
      setup_time: booking.setup_time ? formatTime12Hour(booking.setup_time) : ''
    }

    // Balance Reminder: when no due date is set, drop the "by {date}" clause so
    // the prefill still reads as a full sentence rather than "…settle by to keep…".
    let templateText = template.template
    if (template.id === 'balance_reminder' && !booking.balance_due_date) {
      templateText = templateText.replace(' by {balance_due_date}', '')
    }

    const message = templateText.replace(/\{([^}]+)\}/g, (_, key) => replacements[key] || '')
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

    if (emailChosen) {
      if (!emailSubject.trim()) {
        toast.error('Please enter a subject for the email.')
        return
      }
      setSending(true)
      const emailResult = await sendPrivateBookingEmail(bookingId, emailSubject.trim(), message)
      setSending(false)
      if ('error' in emailResult && emailResult.error) {
        toast.error(emailResult.error)
        return
      }
      toast.success('Email sent to the customer.')
      setMessageToSend('')
      setSelectedTemplate('')
      setCustomMessage('')
      refreshBooking()
      return
    }

    if (!booking.contact_phone) {
      toast.error('No phone number available for this booking.')
      return
    }

    setSending(true)
    const result = await sendPrivateBookingSms(bookingId, message)
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

  // One header for every state. Every tab of the booking shows the customer's name.
  const layoutProps = {
    title: booking ? booking.customer_full_name || booking.customer_name : 'Private Booking',
    subtitle: 'Messages: send and review messages to the customer',
    backButton: PB_BACK_TO_LIST,
    navItems: PB_DETAIL_NAV(bookingId),
  }

  if (loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading messages…" />
  }

  if (!booking) {
    return <PageLayout {...layoutProps} error={initialError ?? 'Booking not found.'} />
  }

  const isDraft = booking.status === 'draft'
  const canSend = emailChosen ? canSendSms && Boolean(emailOption?.usable) : canSendSms && booking.contact_phone

  return (
    <PageLayout {...layoutProps}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              title="Send a Message"
              subtitle="Choose a template or compose a custom message to send to the customer."
            />
            <CardBody className="space-y-4">
              {!canSendSms && (
                <Alert
                  tone="warning"
                  title="SMS sending disabled"
                >
                  You do not have permission to send SMS messages. Contact an administrator if you believe this is an error.
                </Alert>
              )}

              {isDraft && (
                <Alert
                  tone="warning"
                  title="Booking still in draft"
                >
                  SMS updates are typically sent after the booking is confirmed. Review the booking status before messaging the customer.
                </Alert>
              )}

              <Fieldset legend="Choose a Template">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {smsTemplates.map((template) => (
                    <Radio
                      key={template.id}
                      name="private-booking-sms-template"
                      value={template.id}
                      label={template.name}
                      description={template.message}
                      checked={selectedTemplate === template.id}
                      onChange={handleTemplateSelect}
                      className="rounded-default border border-border p-4"
                    />
                  ))}
                </div>
              </Fieldset>

              {emailOption?.enabled && (
                <Fieldset legend="Send By">
                  <div className="space-y-2">
                    <Radio
                      name="private-booking-message-channel"
                      value="email"
                      label="Email"
                      description={emailOption.usable ? undefined : 'No usable email address for this booking.'}
                      checked={channel === 'email'}
                      onChange={() => setChannel('email')}
                      disabled={!emailOption.usable || !canSendSms}
                    />
                    <Radio
                      name="private-booking-message-channel"
                      value="sms"
                      label="Text"
                      checked={channel === 'sms'}
                      onChange={() => setChannel('sms')}
                      disabled={!canSendSms}
                    />
                  </div>
                </Fieldset>
              )}

              {emailChosen && (
                <Input
                  label="Email subject"
                  value={emailSubject}
                  maxLength={200}
                  onChange={(event) => setEmailSubject(event.target.value)}
                  disabled={!canSendSms}
                />
              )}

              <Field
                label="Custom message"
                hint={
                  emailChosen
                    ? "Sent by email from The Anchor, with the venue's address, phone number and email added at the end."
                    : 'Messages are sent via the venue SMS number. Reply instructions are added automatically.'
                }
              >
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
              </Field>

              <FormFooter>
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
                  variant="primary"
                  onClick={handleSendMessage}
                  loading={sending}
                  disabled={!canSend || sending}
                  icon={<Icon name="send" size={16} />}
                >
                  Send Message
                </Button>
              </FormFooter>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Message History"
              subtitle="Recent SMS messages related to this booking."
            />
            {loading ? (
              <PageLoading inline label="Loading messages…" />
            ) : sentMessages.length === 0 ? (
              <Empty
                size="sm"
                icon={<Icon name="message" size={48} />}
                title="No messages yet"
                description="Messages sent to the customer about this booking will appear here."
              />
            ) : (
              <CardBody>
                <div className="divide-y divide-border">
                  {sentMessages
                    .sort((a, b) => new Date(b.sent_at ?? b.created_at ?? '').getTime() - new Date(a.sent_at ?? a.created_at ?? '').getTime())
                    .map((message) => {
                      const messageKey = message.id ?? message.twilio_sid ?? `${message.booking_id}-${message.created_at}`

                      return (
                        <div key={messageKey} className="py-4 first:pt-0 last:pb-0">
                          <div className="flex items-center justify-between text-sm text-text-muted">
                            <span className="flex items-center gap-2">
                              <Icon name="clock" size={16} />
                              Sent {formatDateTime12Hour(message.sent_at ?? message.created_at ?? '')}
                            </span>
                            <Badge size="sm" tone={SENT_MESSAGE_TRIGGER_TONE}>
                              {message.trigger_type?.replace(/_/g, ' ') || 'Manual message'}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm text-text whitespace-pre-wrap">
                            {message.message_body}
                          </p>
                        </div>
                      )
                    })}
                </div>
              </CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Booking Summary" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    key: 'customer',
                    label: 'Customer',
                    value: (
                      <>
                        {booking.customer_full_name || booking.customer_name}
                        {booking.contact_phone && (
                          <span className="flex items-center gap-1 text-xs text-text-muted">
                            <Icon name="smartphone" size={16} />
                            {booking.contact_phone}
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'event',
                    label: 'Event Details',
                    value: (
                      <>
                        {booking.event_type || 'Private event'}{' '}
                        {booking.event_date ? `on ${formatDateFull(booking.event_date)}` : ''}
                        {booking.start_time && (
                          <span className="block text-xs text-text-muted">Starts at {formatTime12Hour(booking.start_time)}</span>
                        )}
                      </>
                    ),
                  },
                  ...(booking.guest_count
                    ? [{ key: 'guests', label: 'Guest Count', value: `${booking.guest_count} guests` }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="SMS Delivery Status" />
            <CardBody className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-default">
                <Icon name="checkCircle" size={20} className="text-success" />
                <div>
                  <p className="text-sm font-medium text-text">Delivered</p>
                  <p className="text-xs text-text-muted">Messages confirmed by Twilio.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-default">
                <Icon name="alertCircle" size={20} className="text-info" />
                <div>
                  <p className="text-sm font-medium text-text">Queued</p>
                  <p className="text-xs text-text-muted">Awaiting automatic send.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-surface-2 rounded-default">
                <Icon name="xCircle" size={20} className="text-danger" />
                <div>
                  <p className="text-sm font-medium text-text">Failed</p>
                  <p className="text-xs text-text-muted">Requires manual attention.</p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}
