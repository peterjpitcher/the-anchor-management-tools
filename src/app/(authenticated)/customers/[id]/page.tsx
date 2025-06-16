'use client'

import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Customer, Booking, Event } from '@/types/database'
import { PencilIcon, TrashIcon, ArrowLeftIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import toast from 'react-hot-toast'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Button } from '@/components/ui/Button'
import { toggleCustomerSmsOptIn, getCustomerSmsStats, getCustomerMessages } from '@/app/actions/customerSmsActions'
import { markMessagesAsRead } from '@/app/actions/messageActions'
import { MessageThread } from '@/components/MessageThread'

type BookingWithEvent = Omit<Booking, 'event'> & {
  event: Pick<Event, 'id' | 'name' | 'date' | 'time' | 'capacity' | 'created_at'>
}

export const dynamic = 'force-dynamic'

export default function CustomerViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [bookings, setBookings] = useState<BookingWithEvent[]>([])
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [smsStats, setSmsStats] = useState<any>(null)
  const [togglingSmsSetting, setTogglingSmsSetting] = useState(false)
  const [messages, setMessages] = useState<any[]>([])
  const [showMessages, setShowMessages] = useState(false)

  // Modal states
  const [editingBooking, setEditingBooking] = useState<BookingWithEvent | undefined>(undefined)
  const [isAddingBooking, setIsAddingBooking] = useState(false)
  const [eventForNewBooking, setEventForNewBooking] = useState<Event | undefined>(undefined)

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
        .select('*, event:events(id, name, date, time, capacity, created_at)')
        .eq('customer_id', params.id)
        .order('created_at', { ascending: false })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithEvent[])

      const { data: eventsData, error: eventsError } = await supabase.from('events').select('*').order('date')
      if (eventsError) throw eventsError
      setAllEvents(eventsData)

      // Load SMS stats
      const stats = await getCustomerSmsStats(params.id)
      if ('error' in stats) {
        console.error('Failed to load SMS stats:', stats.error)
      } else {
        setSmsStats(stats)
      }

      // Load messages
      const messagesResult = await getCustomerMessages(params.id)
      if ('error' in messagesResult) {
        console.error('Failed to load messages:', messagesResult.error)
      } else {
        setMessages(messagesResult.messages)
        // Mark inbound messages as read
        await markMessagesAsRead(params.id)
      }
    } catch (error) {
      console.error('Error loading customer details:', error)
      toast.error('Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [params.id, supabase])

  useEffect(() => {
    loadData()

    // Set up periodic refresh for messages every 5 seconds
    const interval = setInterval(() => {
      loadData()
    }, 5000)

    return () => clearInterval(interval)
  }, [loadData])

  const handleToggleSms = async () => {
    if (!customer) return
    
    setTogglingSmsSetting(true)
    const newOptIn = customer.sms_opt_in === false
    const result = await toggleCustomerSmsOptIn(customer.id, newOptIn)
    
    if ('error' in result) {
      toast.error(`Failed to update SMS settings: ${result.error}`)
    } else {
      toast.success(`SMS ${newOptIn ? 'activated' : 'deactivated'} for customer`)
      await loadData() // Reload data to get updated customer and stats
    }
    setTogglingSmsSetting(false)
  }

  useEffect(() => {
    const bookingId = searchParams.get('booking_id')
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
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete('booking_id')
    router.push(`${window.location.pathname}?${newParams.toString()}`)
  }

  const handleUpdateBooking = async (data: Omit<Booking, 'id' | 'created_at'>) => {
    if (!editingBooking) return

    const { error } = await supabase.from('bookings').update(data).eq('id', editingBooking.id)

    if (error) {
      toast.error(`Failed to update booking: ${error.message}`)
    } else {
      toast.success('Booking updated successfully!')
      const returnTo = searchParams.get('return_to')
      if (returnTo) {
        router.push(returnTo)
      } else {
        closeModal()
        await loadData() // Refresh data
      }
    }
  }

  const handleAddBooking = async (data: Omit<Booking, 'id' | 'created_at'>) => {
    const { data: newBooking, error } = await supabase.from('bookings').insert(data).select().single()

    if (error) {
      toast.error(`Failed to add booking: ${error.message}`)
    } else {
      toast.success('Booking added successfully!')
      
      // Send SMS confirmation in the background
      if (newBooking?.id) {
        import('@/app/actions/sms').then(({ sendBookingConfirmation }) => {
          sendBookingConfirmation(newBooking.id).catch((error) => {
            console.error('Failed to send SMS confirmation:', error)
            toast.error('SMS notification could not be sent')
          })
        })
      }
      
      const returnTo = searchParams.get('return_to')
      if (returnTo) {
        router.push(returnTo)
      } else {
        closeModal()
        await loadData() // Refresh data
      }
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (window.confirm('Are you sure you want to delete this booking?')) {
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId)
      if (error) {
        toast.error(`Failed to delete booking: ${error.message}`)
      } else {
        toast.success('Booking deleted.')
        setBookings(bookings.filter(b => b.id !== bookingId))
      }
    }
  }

  if (loading) return <div className="text-center p-4">Loading customer details...</div>
  if (!customer) return <div className="text-center p-4">Customer not found.</div>

  const showModal = !!editingBooking || isAddingBooking
  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  const BookingTable = ({ items, type }: { items: BookingWithEvent[]; type: 'booking' | 'reminder' }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
              Event
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
              Date
            </th>
            {type === 'booking' && (
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-black uppercase">
                Seats
              </th>
            )}
            <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map(booking => (
            <tr key={booking.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href={`/events/${booking.event.id}`} className="text-blue-600 hover:text-blue-800">
                  {booking.event.name}
                </Link>
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-sm text-black">
                {formatDate(booking.event.date)} @ {booking.event.time}
              </td>
              {type === 'booking' && (
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {booking.seats} Seats
                  </span>
                </td>
              )}
              <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                <button
                  onClick={() => setEditingBooking(booking)}
                  className="text-indigo-600 hover:text-indigo-900 mr-4"
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
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={type === 'booking' ? 4 : 3} className="px-4 py-4 text-center text-sm text-gray-500">
                No {type === 'booking' ? 'bookings' : 'reminders'} found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-6">
      {showModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            {isAddingBooking && (
              <div>
                <h3 className="text-lg font-medium mb-4">Select an Event</h3>
                <select
                  onChange={e => {
                    const event = allEvents.find(event => event.id === e.target.value)
                    setEventForNewBooking(event)
                  }}
                  className="w-full p-2 border rounded-md mb-4"
                >
                  <option>Select an event</option>
                  {allEvents.map(event => (
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
          </div>
        </div>
      )}

      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{customer.first_name} {customer.last_name}</h1>
              <p className="mt-1 text-sm text-gray-500">
                <a href={`tel:${customer.mobile_number}`} className="text-indigo-600 hover:text-indigo-900">
                  {customer.mobile_number}
                </a>
              </p>
              <div className="mt-2 flex items-center space-x-4">
                <div className="flex items-center">
                  <ChatBubbleLeftRightIcon className="h-4 w-4 text-gray-400 mr-1" />
                  <span className={`text-sm font-medium ${customer.sms_opt_in !== false ? 'text-green-600' : 'text-red-600'}`}>
                    SMS {customer.sms_opt_in !== false ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {customer.sms_delivery_failures && customer.sms_delivery_failures > 0 && (
                  <span className="text-sm text-orange-600">
                    {customer.sms_delivery_failures} failed deliveries
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-3">
               <Link href="/customers" className="text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center">
                  <ArrowLeftIcon className="h-5 w-5 mr-2" />
                  Back to Customers
                </Link>
                <Button onClick={() => setIsAddingBooking(true)}>
                  Add Booking
                </Button>
            </div>
          </div>
        </div>
      </div>

      {/* SMS Status Card */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="text-lg font-medium leading-6 text-gray-900">SMS Messaging Status</h3>
              <div className="mt-2 max-w-xl text-sm text-gray-500">
                <p>Control whether this customer receives SMS notifications for bookings and reminders.</p>
              </div>
              {smsStats && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <div className="mt-4 rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-800">
                    <span className="font-medium">Auto-deactivated:</span> {customer.sms_deactivation_reason}
                  </p>
                  {customer.last_sms_failure_reason && (
                    <p className="text-sm text-red-700 mt-1">Last error: {customer.last_sms_failure_reason}</p>
                  )}
                </div>
              )}
            </div>
            <div className="ml-4">
              <Button
                onClick={handleToggleSms}
                disabled={togglingSmsSetting}
                variant={customer.sms_opt_in !== false ? 'secondary' : 'primary'}
                size="sm"
              >
                {togglingSmsSetting ? 'Updating...' : (customer.sms_opt_in !== false ? 'Deactivate SMS' : 'Activate SMS')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Message Thread */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Messages</h3>
          <MessageThread
            messages={messages}
            customerId={customer.id}
            customerName={`${customer.first_name} ${customer.last_name}`}
            canReply={customer.sms_opt_in !== false}
            onMessageSent={async () => {
              await loadData() // Refresh messages
            }}
          />
        </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h2 className="text-lg font-medium leading-6 text-gray-900">
            Active Bookings ({activeBookings.length})
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Total of {totalSeats} seats booked across all events.
          </p>
        </div>
        <div className="border-t border-gray-200">
          <BookingTable items={activeBookings} type="booking" />
        </div>
      </div>
      
      {reminders.length > 0 && (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h2 className="text-lg font-medium leading-6 text-gray-900">
                Reminders ({reminders.length})
            </h2>
            <p className="mt-1 text-sm text-gray-500">
                These are events the customer has been sent a reminder for, but has not booked seats.
            </p>
          </div>
           <div className="border-t border-gray-200">
            <BookingTable items={reminders} type="reminder" />
          </div>
        </div>
      )}
    </div>
  )
} 