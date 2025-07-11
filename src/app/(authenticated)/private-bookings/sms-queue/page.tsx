import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeftIcon,
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/private-bookings"
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">SMS Queue</h1>
                <p className="text-gray-600 mt-1">Review and approve SMS messages for private bookings</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Pending Messages */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ClockIcon className="h-6 w-6 text-amber-600" />
            Pending Approval ({pendingSms.length})
          </h2>
          
          {pendingSms.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <ChatBubbleLeftRightIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No messages pending approval</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingSms.map((sms) => (
                <div key={sms.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          {formatTriggerType(sms.trigger_type)}
                        </span>
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
                    <form action={handleApproveSms} className="inline">
                      <input type="hidden" name="smsId" value={sms.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <CheckIcon className="h-4 w-4" />
                        Approve
                      </button>
                    </form>
                    
                    <form action={handleRejectSms} className="inline">
                      <input type="hidden" name="smsId" value={sms.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approved Messages */}
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <CheckIcon className="h-6 w-6 text-green-600" />
            Approved Messages ({approvedSms.length})
          </h2>
          
          {approvedSms.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <PaperAirplaneIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No approved messages ready to send</p>
            </div>
          ) : (
            <div className="space-y-4">
              {approvedSms.map((sms) => (
                <div key={sms.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Approved
                        </span>
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
                  
                  <form action={handleSendSms} className="inline">
                    <input type="hidden" name="smsId" value={sms.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <PaperAirplaneIcon className="h-4 w-4" />
                      Send Now
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cancelled Messages */}
        {cancelledSms.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <XMarkIcon className="h-6 w-6 text-red-600" />
              Cancelled Messages ({cancelledSms.length})
            </h2>
            
            <div className="space-y-4">
              {cancelledSms.map((sms) => {
                const metadata = sms.metadata as any || {}
                const isDateChange = metadata.cancelled_reason === 'event_date_changed'
                
                return (
                  <div key={sms.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 opacity-75">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Cancelled
                          </span>
                          {isDateChange && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              Date Changed
                            </span>
                          )}
                        </div>
                        
                        <h3 className="text-lg font-medium text-gray-900 mb-1">
                          {sms.booking?.customer_first_name && sms.booking?.customer_last_name 
                            ? `${sms.booking.customer_first_name} ${sms.booking.customer_last_name}`
                            : sms.booking?.customer_name || 'Unknown Customer'}
                        </h3>
                        
                        {isDateChange && metadata.old_date && metadata.new_date && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                            <p className="text-sm text-yellow-800">
                              <strong>Booking rescheduled:</strong> {formatDateFull(metadata.old_date)} → {formatDateFull(metadata.new_date)}
                            </p>
                          </div>
                        )}
                        
                        <div className="bg-gray-50 rounded-lg p-4 line-through">
                          <p className="text-sm text-gray-500 whitespace-pre-wrap">{sms.message_body}</p>
                        </div>
                        
                        <p className="text-xs text-gray-500 mt-2">
                          Cancelled {metadata.cancelled_at ? formatDateTime12Hour(metadata.cancelled_at) : 'recently'}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-6 w-6 text-blue-600 flex-shrink-0" />
            <div>
              <h3 className="text-base font-medium text-blue-900 mb-2">SMS Approval Process</h3>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>All SMS messages for private bookings require approval before sending</li>
                <li>Messages are automatically queued when booking status changes or payments are received</li>
                <li>Approved messages must be manually sent using the &quot;Send Now&quot; button</li>
                <li>Rejected messages are moved to the cancelled status and won&apos;t be sent</li>
                <li>When booking dates change, pending messages are automatically cancelled and new ones created</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}