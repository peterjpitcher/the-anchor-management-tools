'use client'

import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Customer, Booking, Event, Message } from '@/types/database'
import { PencilIcon, TrashIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { toggleCustomerSmsOptIn, getCustomerSmsStats, getCustomerMessages } from '@/app/actions/customerSmsActions'
import { markMessagesAsRead } from '@/app/actions/messageActions'
import { MessageThread } from '@/components/MessageThread'
import { CustomerCategoryPreferences } from '@/components/CustomerCategoryPreferences'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle, CardDescription } from '@/components/ui-v2/layout/Card'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { CustomerLabelSelector } from '@/components/CustomerLabelSelector'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteBooking as deleteBookingAction } from '@/app/actions/bookings'

type BookingWithEvent = Omit<Booking, 'event'> & {
  event: Pick<Event, 'id' | 'name' | 'date' | 'time' | 'capacity' | 'created_at' | 'slug'>
}

export const dynamic = 'force-dynamic'

export default function CustomerViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [bookings, setBookings] = useState<BookingWithEvent[]>([])
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [smsStats, setSmsStats] = useState<{
    customer: {
      sms_opt_in: boolean;
      sms_delivery_failures: number;
      last_sms_failure_reason: string | null;
      last_successful_sms_at: string | null;
      sms_deactivated_at: string | null;
      sms_deactivation_reason: string | null;
    };
    stats: {
      totalMessages: number;
      deliveredMessages: number;
      failedMessages: number;
      deliveryRate: string;
    };
  } | null>(null)
  const [togglingSmsSetting, setTogglingSmsSetting] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])

  // Modal states
  const [editingBooking, setEditingBooking] = useState<BookingWithEvent | undefined>(undefined)
  const [isAddingBooking, setIsAddingBooking] = useState(false)
  const [eventForNewBooking, setEventForNewBooking] = useState<Event | undefined>(undefined)

  const loadMessages = useCallback(async () => {
    try {
      const messagesResult = await getCustomerMessages(params.id)
      if ('error' in messagesResult) {
        console.error('Failed to load messages:', messagesResult.error)
      } else {
        setMessages(messagesResult.messages)
        // Mark inbound messages as read
        await markMessagesAsRead(params.id)
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    }
  }, [params.id])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', params.id)
        .single()

      if (customerError) throw customerError
      setCustomer(customerData)

      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*, event:events(id, name, date, time, capacity, created_at, slug, category:event_categories(*))')
        .eq('customer_id', params.id)
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithEvent[])

      const todayIso = getTodayIsoDate()
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .gte('date', todayIso) // Only future events
        .order('date')
      if (eventsError) throw eventsError
      setAllEvents(eventsData)

      // Load SMS stats
      const stats = await getCustomerSmsStats(params.id)
      if ('error' in stats) {
        console.error('Failed to load SMS stats:', stats.error)
      } else {
        setSmsStats(stats)
      }

      // Load messages initially
      await loadMessages()
    } catch (error) {
      console.error('Error loading customer details:', error)
      toast.error('Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [params.id, supabase, loadMessages])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    // Set up periodic refresh for messages only
    const interval = setInterval(() => {
      loadMessages()
    }, 5000)

    return () => clearInterval(interval)
  }, [loadMessages])

  const handleToggleSms = async () => {
    if (!customer) return
    
    setTogglingSmsSetting(true)
    const newOptIn = customer.sms_opt_in === false
    const result = await toggleCustomerSmsOptIn(customer.id, newOptIn)
    
    if ('error' in result) {
      toast.error(`Failed to update SMS settings: ${result.error}`)
    } else {
      toast.success(`SMS ${newOptIn ? 'activated' : 'deactivated'} for customer`)
      
      // Update customer state locally
      setCustomer({ ...customer, sms_opt_in: newOptIn })
      
      // Reload SMS stats only
      const stats = await getCustomerSmsStats(customer.id)
      if (!('error' in stats)) {
        setSmsStats(stats)
      }
    }
    setTogglingSmsSetting(false)
  }

  useEffect(() => {
    const bookingId = searchParams?.get('booking_id')
    if (bookingId && bookings.length > 0) {
      const bookingToEdit = bookings.find(b => b.id === bookingId)
      if (bookingToEdit) {
        setEditingBooking(bookingToEdit)
      }
    }
  }, [bookings, searchParams])

  const closeModal = () => {
    setEditingBooking(undefined)
    setIsAddingBooking(false)
    setEventForNewBooking(undefined)
    const newParams = new URLSearchParams(searchParams?.toString() ?? '')
    newParams.delete('booking_id')
    router.push(`${window.location.pathname}?${newParams.toString()}`)
  }

  const openAddBookingModal = () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage bookings.')
      return
    }
    setEventForNewBooking(undefined)
    setIsAddingBooking(true)
  }

  const startEditBooking = (booking: BookingWithEvent) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage bookings.')
      return
    }
    setEditingBooking(booking)
    setIsAddingBooking(false)
  }

  const handleUpdateBooking = async (_data: Omit<Booking, 'id' | 'created_at'>, context?: { keepOpen?: boolean }) => {
    if (!editingBooking) return
    if (!canManageEvents) {
      toast.error('You do not have permission to manage bookings.')
      return
    }

    try {
      const returnTo = searchParams?.get('return_to')
      if (returnTo) {
        router.push(returnTo)
        return
      }

      if (!context?.keepOpen) {
        closeModal()
      }

      await loadData()
    } catch (error) {
      console.error('Error refreshing booking after update:', error)
      toast.error('Failed to refresh booking details')
    }
  }

  const handleAddBooking = async (_data: Omit<Booking, 'id' | 'created_at'>, context?: { keepOpen?: boolean }) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage bookings.')
      return
    }

    try {
      const returnTo = searchParams?.get('return_to')
      if (returnTo) {
        router.push(returnTo)
        return
      }

      if (!context?.keepOpen) {
        closeModal()
      }

      await loadData()
    } catch (error) {
      console.error('Error refreshing bookings after creation:', error)
      toast.error('Failed to refresh bookings')
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage bookings.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this booking?')) return

    try {
      const result = await deleteBookingAction(bookingId)
      if ('error' in result && result.error) {
        throw new Error(result.error)
      }
      toast.success('Booking deleted.')
      await loadData()
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete booking')
    }
  }


  const showModal = !!editingBooking || isAddingBooking
  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  // Define columns for booking table
  const baseBookingColumns: Column<BookingWithEvent>[] = [
    {
      key: 'event',
      header: 'Event',
      cell: (booking) => (
        <Link href={`/events/${booking.event.id}`} className="text-blue-600 hover:text-blue-800">
          {booking.event.name}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      cell: (booking) => (
        <span className="text-sm text-black">
          {formatDate(booking.event.date)} @ {booking.event.time}
        </span>
      ),
    },
    {
      key: 'seats',
      header: 'Tickets',
      cell: (booking) => (
        <Badge variant="success">
          {booking.seats} Tickets
        </Badge>
      ),
    },
  ]

  const bookingColumns: Column<BookingWithEvent>[] = canManageEvents
    ? [
        ...baseBookingColumns,
        {
          key: 'actions',
          header: '',
          align: 'right',
          cell: (booking) => (
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => startEditBooking(booking)}
                className="text-blue-600 hover:text-blue-700"
              >
                <PencilIcon className="h-5 w-5" />
                <span className="sr-only">Edit</span>
              </button>
              <button
                onClick={() => handleDeleteBooking(booking.id)}
                className="text-red-600 hover:text-red-900"
              >
                <TrashIcon className="h-5 w-5" />
                <span className="sr-only">Delete</span>
              </button>
            </div>
          ),
        },
      ]
    : baseBookingColumns

  // Define columns for reminder table (without seats)
  const reminderColumns: Column<BookingWithEvent>[] = bookingColumns.filter(col => col.key !== 'seats')

  if (loading) {
    return (
      <PageLayout
        title="Customer Details"
        subtitle="Loading customer information"
        backButton={{ label: 'Back to Customers', href: '/customers' }}
        loading
        loadingLabel="Loading customer..."
      >
        {null}
      </PageLayout>
    )
  }

  if (!customer) {
    return (
      <PageLayout
        title="Customer Details"
        subtitle="Customer not found"
        backButton={{ label: 'Back to Customers', href: '/customers' }}
        error="The requested customer could not be found."
      >
        {null}
      </PageLayout>
    )
  }

  const customerName = `${customer.first_name} ${customer.last_name}`.trim()
  const navActions = canManageEvents ? (
    <NavGroup>
      <NavLink onClick={openAddBookingModal} className="font-semibold">
        Add Booking
      </NavLink>
    </NavGroup>
  ) : undefined

  return (
    <PageLayout
      title={customerName}
      subtitle={customer.mobile_number || 'No mobile number'}
      backButton={{ label: 'Back to Customers', href: '/customers' }}
      navActions={navActions}
    >
      <div className="space-y-6">
        {/* Booking Modal */}
        <Modal
          open={showModal}
          onClose={closeModal}
          title={editingBooking ? 'Edit Booking' : 'Add New Booking'}
          size="lg"
        >
          {isAddingBooking && !eventForNewBooking && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Select an Event
              </label>
              <select
                onChange={(e) => {
                  const event = allEvents.find((event) => event.id === e.target.value)
                  setEventForNewBooking(event)
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              >
                <option value="">Select an event</option>
                {allEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} ({formatDate(event.date)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {(editingBooking || (isAddingBooking && eventForNewBooking)) && (
            <BookingForm
              event={editingBooking?.event ?? eventForNewBooking!}
              booking={editingBooking}
              customer={customer}
              onSubmit={editingBooking ? handleUpdateBooking : handleAddBooking}
              onCancel={closeModal}
            />
          )}
        </Modal>

        {/* Customer Info Card */}
        <Card>
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <ChatBubbleLeftRightIcon className="mr-1 h-4 w-4 text-gray-400" />
              <span
                className={`text-sm font-medium ${customer.sms_opt_in !== false ? 'text-green-600' : 'text-red-600'}`}
              >
                SMS {customer.sms_opt_in !== false ? 'Active' : 'Inactive'}
              </span>
            </div>
            {customer.sms_delivery_failures && customer.sms_delivery_failures > 0 && (
              <span className="text-sm text-orange-600">
                {customer.sms_delivery_failures} failed deliveries
              </span>
            )}
          </div>
        </Card>

        {/* Customer Labels Card */}
        {hasPermission('customers', 'manage') && (
          <Card header={<CardTitle>Customer Labels</CardTitle>}>
            <CustomerLabelSelector customerId={customer.id} canEdit />
          </Card>
        )}

        {/* Category Preferences */}
        <CustomerCategoryPreferences customerId={customer.id} />

        {/* Message Thread */}
        <Card header={<CardTitle>Messages</CardTitle>}>
          <MessageThread
            messages={messages}
            customerId={customer.id}
            customerName={customerName}
            canReply={customer.sms_opt_in !== false}
            onMessageSent={async () => {
              await loadMessages()
            }}
          />
        </Card>

        {/* Active Bookings */}
        <Card
          header={
            <div>
              <CardTitle>Active Bookings ({activeBookings.length})</CardTitle>
              <CardDescription>
                Total of {totalSeats} tickets booked across all events.
              </CardDescription>
            </div>
          }
        >
          <DataTable
            data={activeBookings}
            columns={bookingColumns}
            getRowKey={(booking) => booking.id}
            emptyMessage="No bookings found"
          />
        </Card>

        {/* Reminders */}
        {reminders.length > 0 && (
          <Card
            header={
              <div>
                <CardTitle>Reminders ({reminders.length})</CardTitle>
                <CardDescription>
                  These are events the customer has been sent a reminder for, but has not booked tickets.
                </CardDescription>
              </div>
            }
          >
            <DataTable
              data={reminders}
              columns={reminderColumns}
              getRowKey={(booking) => booking.id}
              emptyMessage="No reminders found"
            />
          </Card>
        )}

        {/* SMS Status Card */}
        <Card
          header={
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>SMS Messaging Status</CardTitle>
                <CardDescription>
                  Control whether this customer receives SMS notifications for bookings and reminders.
                </CardDescription>
              </div>
              <Button
                onClick={handleToggleSms}
                disabled={togglingSmsSetting}
                variant={customer.sms_opt_in !== false ? 'secondary' : 'primary'}
                size="sm"
              >
                {togglingSmsSetting
                  ? 'Updating...'
                  : customer.sms_opt_in !== false
                    ? 'Deactivate SMS'
                    : 'Activate SMS'}
              </Button>
            </div>
          }
        >
          {smsStats && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Total Messages</dt>
                <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.totalMessages || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Delivered</dt>
                <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.deliveredMessages || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Failed</dt>
                <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.failedMessages || 0}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Delivery Rate</dt>
                <dd className="mt-1 text-sm text-gray-900">{smsStats.stats?.deliveryRate || 0}%</dd>
              </div>
            </div>
          )}
          {customer.sms_deactivation_reason && (
            <Alert variant="error" title="Auto-deactivated" className="mt-4">
              {customer.sms_deactivation_reason}
              {customer.last_sms_failure_reason && (
                <p className="mt-1 text-sm text-red-700">
                  Last error: {customer.last_sms_failure_reason}
                </p>
              )}
            </Alert>
          )}
        </Card>

        {/* Booking History */}
        <Card
          header={
            <div className="flex items-center justify-between">
              <CardTitle>Booking History</CardTitle>
              <Button
                variant="secondary"
                onClick={() => router.push(`/events?customer=${customer.id}`)}
              >
                View All Events
              </Button>
            </div>
          }
        >
          <DataTable
            data={bookings}
            columns={bookingColumns}
            getRowKey={(booking) => booking.id}
            emptyMessage="No booking history available"
          />
        </Card>
        {/* Loyalty removed */}
      </div>
    </PageLayout>
  )
}
