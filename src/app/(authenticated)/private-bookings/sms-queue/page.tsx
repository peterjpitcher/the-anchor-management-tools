import { redirect } from 'next/navigation'
import Link from 'next/link'

import { approveSms, rejectSms, sendApprovedSms } from '@/app/actions/privateBookingActions'
import { SmsQueueService } from '@/services/sms-queue'
import { formatDateFull, formatDateTime12Hour } from '@/lib/dateUtils'
import { PageLayout, Icon } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { Alert } from '@/ds'
import { Badge } from '@/ds'
import { Empty } from '@/ds'
import { SmsQueueActionForm } from '@/components/private-bookings/SmsQueueActionForm'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import type { SmsQueueActionState } from '@/components/private-bookings/SmsQueueActionForm'
import { isMessagingFlagOn } from '@/lib/messaging/flags'

async function handleApproveSms(_prevState: SmsQueueActionState, formData: FormData): Promise<SmsQueueActionState> {
  'use server'

  const smsId = formData.get('smsId') as string
  if (!smsId) {
    return { status: 'error', message: 'Missing SMS identifier.', changedAt: Date.now() }
  }
  const result = await approveSms(smsId)

  if (result.error) {
    console.error('Error approving SMS:', result.error)
    return { status: 'error', message: result.error, changedAt: Date.now() }
  }

  return { status: 'success', changedAt: Date.now() }
}

async function handleRejectSms(_prevState: SmsQueueActionState, formData: FormData): Promise<SmsQueueActionState> {
  'use server'

  const smsId = formData.get('smsId') as string
  if (!smsId) {
    return { status: 'error', message: 'Missing SMS identifier.', changedAt: Date.now() }
  }
  const result = await rejectSms(smsId)

  if (result.error) {
    console.error('Error rejecting SMS:', result.error)
    return { status: 'error', message: result.error, changedAt: Date.now() }
  }

  return { status: 'success', changedAt: Date.now() }
}

async function handleSendSms(_prevState: SmsQueueActionState, formData: FormData): Promise<SmsQueueActionState> {
  'use server'

  const smsId = formData.get('smsId') as string
  if (!smsId) {
    return { status: 'error', message: 'Missing SMS identifier.', changedAt: Date.now() }
  }
  const result = await sendApprovedSms(smsId)

  if (result.error) {
    console.error('Error sending SMS:', result.error)
    return { status: 'error', message: result.error, changedAt: Date.now() }
  }

  // Email first: say so when the approved message went by email rather than text.
  const sentByEmail = (result as { channel?: string }).channel === 'email'
  return {
    status: 'success',
    ...(sentByEmail ? { message: 'Sent by email: the guest has a usable email address' } : {}),
    changedAt: Date.now(),
  }
}

export default async function SmsQueuePage() {
  const permissionsResult = await getCurrentUserModuleActions('private_bookings')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }
    redirect('/unauthorized')
  }

  const actions = new Set(permissionsResult.actions)
  const canViewQueue = actions.has('view_sms_queue') || actions.has('manage')
  const canApproveSms = actions.has('approve_sms') || actions.has('manage')
  // approve_sms, not send: private_bookings.send does not exist in the
  // permissions table, so this was false for every account and the Send Now
  // button was permanently disabled.
  const canSendSms = actions.has('approve_sms') || actions.has('manage')

  if (!canViewQueue) {
    redirect('/unauthorized')
  }

  // Email first (P6): Send Now may deliver an approved message by email, so say so up front.
  const emailFirst = await isMessagingFlagOn('private_booking_email_first')

  // Fetch SMS queue with booking details
  let smsQueue = null
  let error = null
  try {
    smsQueue = await SmsQueueService.getQueue(['pending', 'approved', 'cancelled'])
  } catch (e: any) {
    console.error('Error fetching SMS queue:', e)
    error = e
  }

  // Group by status
  const pendingSms = smsQueue?.filter(sms => sms.status === 'pending') || []
  const approvedSms = smsQueue?.filter(sms => sms.status === 'approved') || []
  const cancelledSms = smsQueue?.filter(sms => sms.status === 'cancelled') || []

  const formatTriggerType = (type: string) => {
    const types: Record<string, string> = {
      status_change: 'Status Change',
      booking_created: 'Booking Created',
      booking_confirmed: 'Booking Confirmed',
      booking_cancelled: 'Booking Cancelled',
      booking_expired: 'Booking Expired',
      date_changed: 'Date Changed',
      deposit_received: 'Deposit Received',
      payment_received: 'Payment Received',
      final_payment_received: 'Final Payment Received',
      deposit_reminder_7day: 'Deposit Reminder (7d)',
      deposit_reminder_1day: 'Deposit Reminder (1d)',
      balance_reminder_14day: 'Balance Reminder (14d)',
      event_reminder_1d: 'Event Reminder (1d)',
      setup_reminder: 'Setup Reminder',
      booking_completed: 'Thank You',
      reminder: 'Reminder',
      payment_due: 'Payment Due',
      urgent: 'Urgent',
      manual: 'Manual'
    }
    return types[type] || type
  }

  return (
    <PageLayout
      title="SMS Queue"
      subtitle="Review and approve SMS messages for private bookings"
      navItems={[
        { label: 'Bookings', href: '/private-bookings' },
        { label: 'Calendar', href: '/private-bookings/calendar' },
        { label: 'SMS Queue', href: '/private-bookings/sms-queue' },
      ]}
    >
      <div className="space-y-6">
      {!canApproveSms && !canSendSms && (
        <Alert tone="info">
          You can view the SMS queue but do not currently have permission to approve or send messages.
        </Alert>
      )}
      {error && (
        <Alert tone="danger">
          We could not refresh the SMS queue. The latest list may be incomplete.
        </Alert>
      )}
      {/* Pending Messages */}
      <Section 
        title="Pending Approval"
        icon={<Icon name="clock" size={24} className="text-warning" />}
        description={`${pendingSms.length} message${pendingSms.length !== 1 ? 's' : ''}`}
      >
        {pendingSms.length === 0 ? (
          <Empty icon={<Icon name="message" size={48} />}
            title="No messages pending approval"
          />
        ) : (
          <div className="space-y-4">
            {pendingSms.map((sms) => (
              <Card key={sms.id}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge tone="warning">
                        {formatTriggerType(sms.trigger_type)}
                      </Badge>
                      {sms.booking && (
                        <Link
                          href={`/private-bookings/${sms.booking.id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          View Booking
                        </Link>
                      )}
                    </div>
                    
                    <h3 className="text-lg font-medium text-text mb-1">
                      {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                        ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                        : sms.booking?.customer_name || 'Unknown Customer'}
                    </h3>
                    
                    <div className="flex items-center gap-4 text-sm text-text-muted mb-3">
                      <span className="flex items-center gap-1">
                        <Icon name="phone" size={16} />
                        {sms.recipient_phone}
                      </span>
                      {sms.booking && (
                        <span className="flex items-center gap-1">
                          <Icon name="calendar" size={16} />
                          {formatDateFull(sms.booking.event_date)}
                        </span>
                      )}
                    </div>
                    
                    <div className="bg-surface-2 rounded-lg p-4 mb-4">
                      <p className="text-sm text-text whitespace-pre-wrap">{sms.message_body}</p>
                    </div>
                    
                    <p className="text-xs text-text-muted">
                      Created {formatDateTime12Hour(sms.created_at)}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <SmsQueueActionForm
                    action={handleApproveSms}
                    smsId={sms.id}
                    confirmMessage="Approve this SMS for sending?"
                    leftIcon={<Icon name="check" size={16} />}
                    variant="primary"
                    successMessage="SMS approved"
                    disabled={!canApproveSms}
                  >
                    Approve
                  </SmsQueueActionForm>

                  <SmsQueueActionForm
                    action={handleRejectSms}
                    smsId={sms.id}
                    confirmMessage="Reject this SMS?"
                    leftIcon={<Icon name="x" size={16} />}
                    variant="danger"
                    successMessage="SMS rejected"
                    disabled={!canApproveSms}
                  >
                    Reject
                  </SmsQueueActionForm>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Approved Messages */}
      <Section 
        title="Approved Messages"
        icon={<Icon name="check" size={24} className="text-success" />}
        description={`${approvedSms.length} message${approvedSms.length !== 1 ? 's' : ''}`}
      >
        {approvedSms.length === 0 ? (
          <Empty icon={<Icon name="send" size={48} />}
            title="No approved messages ready to send"
          />
        ) : (
          <div className="space-y-4">
            {approvedSms.map((sms) => (
              <Card key={sms.id}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge tone="success">Approved</Badge>
                      <span className="text-xs text-text-muted">
                        by {sms.approved_by} at {formatDateTime12Hour(sms.approved_at)}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-medium text-text mb-1">
                      {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                        ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                        : sms.booking?.customer_name || 'Unknown Customer'}
                    </h3>
                    
                    <div className="flex items-center gap-4 text-sm text-text-muted mb-3">
                      <span className="flex items-center gap-1">
                        <Icon name="phone" size={16} />
                        {sms.recipient_phone}
                      </span>
                    </div>
                    
                    <div className="bg-surface-2 rounded-lg p-4">
                      <p className="text-sm text-text whitespace-pre-wrap">{sms.message_body}</p>
                    </div>
                  </div>
                </div>
                
                <SmsQueueActionForm
                  action={handleSendSms}
                  smsId={sms.id}
                  confirmMessage={
                    emailFirst
                      ? 'Send this approved message now? It goes by email when the guest has a usable email address, otherwise by text.'
                      : 'Send this approved SMS now?'
                  }
                  leftIcon={<Icon name="send" size={16} />}
                  successMessage="SMS sent"
                  disabled={!canSendSms}
                >
                  Send Now
                </SmsQueueActionForm>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Cancelled Messages */}
      {cancelledSms.length > 0 && (
        <Section 
          title="Cancelled Messages"
          icon={<Icon name="x" size={24} className="text-danger" />}
          description={`${cancelledSms.length} message${cancelledSms.length !== 1 ? 's' : ''}`}
        >
          <div className="space-y-4">
            {cancelledSms.map((sms) => {
              const metadata = (sms.metadata as Record<string, unknown>) || {}
              const cancelled_reason = typeof metadata.cancelled_reason === 'string' ? metadata.cancelled_reason : ''
              const old_date = typeof metadata.old_date === 'string' ? metadata.old_date : undefined
              const new_date = typeof metadata.new_date === 'string' ? metadata.new_date : undefined
              const isDateChange = cancelled_reason === 'event_date_changed'
              
              return (
                <Card key={sms.id} className="opacity-75">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge tone="neutral">Cancelled</Badge>
                        {isDateChange && (
                          <Badge tone="warning">Date Changed</Badge>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-medium text-text mb-1">
                        {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                          ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                          : sms.booking?.customer_name || 'Unknown Customer'}
                      </h3>
                      
                      {isDateChange && old_date && new_date && (
                        <Alert tone="warning" className="mb-3">
                          <strong>Booking rescheduled:</strong> {formatDateFull(old_date)} → {formatDateFull(new_date)}
                        </Alert>
                      )}
                      
                      <div className="bg-surface-2 rounded-lg p-4 line-through">
                        <p className="text-sm text-text-muted whitespace-pre-wrap">{sms.message_body}</p>
                      </div>
                      
                      <p className="text-xs text-text-muted mt-2">
                        Cancelled {metadata.cancelled_at ? formatDateTime12Hour(metadata.cancelled_at as string) : 'recently'}
                      </p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </Section>
      )}

      {/* Info Box */}
      <Alert tone="info" icon={<Icon name="alertTriangle" size={24} />}>
        <div>
          <h3 className="text-base font-medium mb-2">SMS Approval Process</h3>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Some SMS messages are sent automatically (e.g. booking created, reminders, payments)</li>
            <li>Other SMS messages are queued for approval before sending</li>
            <li>Approved messages must be manually sent using the &quot;Send Now&quot; button</li>
            <li>Rejected messages are moved to the cancelled status and won&apos;t be sent</li>
            <li>When booking dates change, pending messages are automatically cancelled and new ones created</li>
          </ul>
        </div>
      </Alert>
      </div>
    </PageLayout>
  )
}
