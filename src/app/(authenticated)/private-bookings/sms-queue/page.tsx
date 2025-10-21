import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { 
  ChatBubbleLeftRightIcon,
  CheckIcon,
  XMarkIcon,
  ClockIcon,
  PhoneIcon,
  CalendarIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon
} from '@heroicons/react/24/outline'
import { approveSms, rejectSms, sendApprovedSms } from '@/app/actions/privateBookingActions'
import { formatDateFull, formatDateTime12Hour } from '@/lib/dateUtils'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { SmsQueueActionForm } from '@/components/private-bookings/SmsQueueActionForm'

async function handleApproveSms(formData: FormData) {
  'use server'
  
  const smsId = formData.get('smsId') as string
  const result = await approveSms(smsId)
  
  if (result.error) {
    console.error('Error approving SMS:', result.error)
  }
}

async function handleRejectSms(formData: FormData) {
  'use server'
  
  const smsId = formData.get('smsId') as string
  const result = await rejectSms(smsId)
  
  if (result.error) {
    console.error('Error rejecting SMS:', result.error)
  }
}

async function handleSendSms(formData: FormData) {
  'use server'
  
  const smsId = formData.get('smsId') as string
  const result = await sendApprovedSms(smsId)
  
  if (result.error) {
    console.error('Error sending SMS:', result.error)
  }
}

export default async function SmsQueuePage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Check permissions
  const { data: hasPermission } = await supabase.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'private_bookings',
    p_action: 'manage'
  })

  if (!hasPermission) {
    redirect('/unauthorized')
  }

  // Fetch SMS queue with booking details
  const { data: smsQueue, error } = await supabase
    .from('private_booking_sms_queue')
    .select(`
      *,
      booking:private_bookings(
        id,
        customer_name,
        customer_first_name,
        customer_last_name,
        event_date,
        event_type,
        status
      )
    `)
    .in('status', ['pending', 'approved', 'cancelled'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching SMS queue:', error)
  }

  // Group by status
  const pendingSms = smsQueue?.filter(sms => sms.status === 'pending') || []
  const approvedSms = smsQueue?.filter(sms => sms.status === 'approved') || []
  const cancelledSms = smsQueue?.filter(sms => sms.status === 'cancelled') || []

  const formatTriggerType = (type: string) => {
    const types: Record<string, string> = {
      status_change: 'Status Change',
      deposit_received: 'Deposit Received',
      payment_received: 'Payment Received',
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
      backButton={{ label: 'Back to Private Bookings', href: '/private-bookings' }}
      navActions={
        <NavGroup>
          <NavLink href="/private-bookings/settings">
            Settings Home
          </NavLink>
        </NavGroup>
      }
    >
      <div className="space-y-6">
      {/* Pending Messages */}
      <Section 
        title="Pending Approval"
        icon={<ClockIcon className="h-6 w-6 text-amber-600" />}
        description={`${pendingSms.length} message${pendingSms.length !== 1 ? 's' : ''}`}
      >
        {pendingSms.length === 0 ? (
          <EmptyState icon={<ChatBubbleLeftRightIcon className="h-12 w-12" />}
            title="No messages pending approval"
          />
        ) : (
          <div className="space-y-4">
            {pendingSms.map((sms) => (
              <Card key={sms.id}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge variant="warning">
                        {formatTriggerType(sms.trigger_type)}
                      </Badge>
                      {sms.booking && (
                        <Link
                          href={`/private-bookings/${sms.booking.id}`}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          View Booking
                        </Link>
                      )}
                    </div>
                    
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                      {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                        ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                        : sms.booking?.customer_name || 'Unknown Customer'}
                    </h3>
                    
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                      <span className="flex items-center gap-1">
                        <PhoneIcon className="h-4 w-4" />
                        {sms.recipient_phone}
                      </span>
                      {sms.booking && (
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-4 w-4" />
                          {formatDateFull(sms.booking.event_date)}
                        </span>
                      )}
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{sms.message_body}</p>
                    </div>
                    
                    <p className="text-xs text-gray-500">
                      Created {formatDateTime12Hour(sms.created_at)}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <SmsQueueActionForm
                    action={handleApproveSms}
                    smsId={sms.id}
                    confirmMessage="Approve this SMS for sending?"
                    leftIcon={<CheckIcon className="h-4 w-4" />}
                    variant="primary"
                  >
                    Approve
                  </SmsQueueActionForm>

                  <SmsQueueActionForm
                    action={handleRejectSms}
                    smsId={sms.id}
                    confirmMessage="Reject this SMS?"
                    leftIcon={<XMarkIcon className="h-4 w-4" />}
                    variant="danger"
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
        icon={<CheckIcon className="h-6 w-6 text-green-600" />}
        description={`${approvedSms.length} message${approvedSms.length !== 1 ? 's' : ''}`}
      >
        {approvedSms.length === 0 ? (
          <EmptyState icon={<PaperAirplaneIcon className="h-12 w-12" />}
            title="No approved messages ready to send"
          />
        ) : (
          <div className="space-y-4">
            {approvedSms.map((sms) => (
              <Card key={sms.id}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge variant="success">Approved</Badge>
                      <span className="text-xs text-gray-500">
                        by {sms.approved_by} at {formatDateTime12Hour(sms.approved_at)}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                      {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                        ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                        : sms.booking?.customer_name || 'Unknown Customer'}
                    </h3>
                    
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                      <span className="flex items-center gap-1">
                        <PhoneIcon className="h-4 w-4" />
                        {sms.recipient_phone}
                      </span>
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{sms.message_body}</p>
                    </div>
                  </div>
                </div>
                
                <SmsQueueActionForm
                  action={handleSendSms}
                  smsId={sms.id}
                  confirmMessage="Send this approved SMS now?"
                  leftIcon={<PaperAirplaneIcon className="h-4 w-4" />}
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
          icon={<XMarkIcon className="h-6 w-6 text-red-600" />}
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
                        <Badge variant="error">Cancelled</Badge>
                        {isDateChange && (
                          <Badge variant="warning">Date Changed</Badge>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-medium text-gray-900 mb-1">
                        {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                          ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                          : sms.booking?.customer_name || 'Unknown Customer'}
                      </h3>
                      
                      {isDateChange && old_date && new_date && (
                        <Alert variant="warning" className="mb-3">
                          <strong>Booking rescheduled:</strong> {formatDateFull(old_date)} → {formatDateFull(new_date)}
                        </Alert>
                      )}
                      
                      <div className="bg-gray-50 rounded-lg p-4 line-through">
                        <p className="text-sm text-gray-500 whitespace-pre-wrap">{sms.message_body}</p>
                      </div>
                      
                      <p className="text-xs text-gray-500 mt-2">
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
      <Alert variant="info" icon={<ExclamationTriangleIcon className="h-6 w-6" />}>
        <div>
          <h3 className="text-base font-medium mb-2">SMS Approval Process</h3>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>All SMS messages for private bookings require approval before sending</li>
            <li>Messages are automatically queued when booking status changes or payments are received</li>
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
