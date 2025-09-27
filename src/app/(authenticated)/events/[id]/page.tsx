'use client'

import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { use, useEffect, useState, useCallback } from 'react'
import { Event as BaseEvent, Booking, Customer } from '@/types/database'
import { EventCategory } from '@/types/event-categories'

type Event = BaseEvent & {
  category?: EventCategory | null
}
import { TrashIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/BookingForm'
import { AddAttendeesModalWithCategories } from '@/components/AddAttendeesModalWithCategories'
// Removed unused sendBookingConfirmationSync import
import { addAttendeesWithScheduledSMS } from '@/app/actions/event-sms-scheduler'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { EventTemplateManager } from '@/components/EventTemplateManager'
import { generateEventReservationPosters } from '@/app/actions/event-reservation-posters'

// ui-v2 imports
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
// Removed unused Button and LinkButton imports
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Section } from '@/components/ui-v2/layout/Section'
type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name' | 'id'>
}

export const dynamic = 'force-dynamic'

export default function EventViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const [event, setEvent] = useState<Event | null>(null)
  const [bookings, setBookings] = useState<BookingWithCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showBookingForm, setShowBookingForm] = useState(false)
  const [showAddAttendeesModal, setShowAddAttendeesModal] = useState(false)

  const loadEventData = useCallback(async () => {
    try {
      setIsLoading(true)
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*, category:event_categories(*)')
        .eq('id', params.id)
        .single()

      if (eventError) throw eventError
      setEvent(eventData)

      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*, customer:customers!inner(id, first_name, last_name)')
        .eq('event_id', params.id)
        .order('created_at', { ascending: true })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithCustomer[])
    } catch (error) {
      console.error('Error loading event:', error)
      toast.error('Failed to load event details.')
    } finally {
      setIsLoading(false)
    }
  }, [params.id, supabase])

  useEffect(() => {
    loadEventData()
  }, [loadEventData])

  const handleCreateBooking = async (_data: Omit<Booking, 'id' | 'created_at'>) => {
    // The BookingForm now handles all the logic including duplicate checking
    // This function is called after successful creation/update
    setShowBookingForm(false)
    await loadEventData() // Refresh data
  }

  const handleAddMultipleAttendees = async (customerIds: string[]): Promise<void> => {
    if (!event) {
      toast.error('Event details not loaded.')
      return
    }
    if (customerIds.length === 0) {
      toast.error('No customers selected.')
      return
    }

    try {
      // Use the new server action that schedules SMS instead of sending immediately
      const result = await addAttendeesWithScheduledSMS(event.id, customerIds)
      
      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }
      
      if (result.success) {
        // Construct success message
        let successMessage = `${result.added} attendee(s) added successfully!`
        if (result.skipped && result.skipped > 0) {
          successMessage += ` (${result.skipped} skipped - already booked)`
        }
        if (result.remindersScheduled && result.remindersScheduled > 0) {
          successMessage += ` SMS reminders scheduled.`
        }
        toast.success(successMessage)
        setShowAddAttendeesModal(false)
        await loadEventData() // Refresh data
      } else {
        toast.error('Failed to add attendees')
      }
    } catch (error) {
      console.error('Failed to add multiple attendees:', error)
      toast.error('An error occurred while adding attendees. Please try again.')
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (!window.confirm('Are you sure you want to delete this booking?')) return

    try {
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId)
      if (error) throw error
      toast.success('Booking deleted successfully')
      setBookings(bookings.filter(b => b.id !== bookingId)) // Optimistic update
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error('Failed to delete booking')
      await loadEventData() // Re-fetch on error
    }
  }

  const handleCopyAttendeeList = () => {
    if (!event) return

    // Format event details
    let text = `Event: ${event.name}\n`
    text += `Date: ${formatDate(event.date)}\n`
    text += `Time: ${event.time}\n`
    text += `\n`

    // Add active bookings
    if (activeBookings.length > 0) {
      text += `Attendees (${totalSeats} seats):\n`
      activeBookings.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name} - ${booking.seats} ${booking.seats === 1 ? 'seat' : 'seats'}\n`
      })
    } else {
      text += 'No attendees yet.\n'
    }

    // Add reminders section
    if (reminders.length > 0) {
      text += `\nReminder List (${reminders.length}):\n`
      reminders.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name}\n`
      })
    }

    // Copy to clipboard
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Attendee list copied to clipboard!')
    }).catch(() => {
      toast.error('Failed to copy to clipboard')
    })
  }

  const handleDownloadReservationPosters = async () => {
    if (!event) return
    
    if (activeBookings.length === 0) {
      toast.error('No active bookings to generate posters for')
      return
    }

    const loadingToast = toast.loading('Generating reservation posters...')
    
    try {
      const result = await generateEventReservationPosters(event.id)
      
      if (result.error) {
        toast.error(result.error, { id: loadingToast })
        return
      }
      
      if (result.success && result.pdf && result.filename) {
        // Convert base64 to blob
        const binaryString = atob(result.pdf)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const pdfBlob = new Blob([bytes], { type: 'application/pdf' })
        
        // Create download link
        const url = URL.createObjectURL(pdfBlob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        document.body.appendChild(link)
        link.click()
        
        // Cleanup
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        
        toast.success('Reservation posters downloaded!', { id: loadingToast })
      }
    } catch (error) {
      console.error('Error downloading reservation posters:', error)
      toast.error('Failed to generate reservation posters', { id: loadingToast })
    }
  }

  if (!event && !isLoading) return (
    <PageWrapper>
      <PageHeader 
        title="Event Not Found" 
        subtitle="The requested event could not be found."
        backButton={{
          label: "Back to Events",
          href: "/events"
        }}
      />
    </PageWrapper>
  )

  const activeBookings = bookings.filter(booking => booking.seats && booking.seats > 0)
  const reminders = bookings.filter(booking => !booking.seats || booking.seats === 0)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)

  // Define columns for bookings table
  const bookingColumns: Column<BookingWithCustomer>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (booking) => (
        <Link
          href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${params.id}`}
          className="text-blue-600 hover:text-blue-800 font-medium"
        >
          {booking.customer.first_name} {booking.customer.last_name}
          {booking.notes && (
            <p className="text-sm text-gray-500 mt-1 italic whitespace-pre-wrap">
              {booking.notes}
            </p>
          )}
        </Link>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (booking) => formatDate(booking.created_at),
      width: 'auto',
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (booking) => (
        <Badge variant="success" size="sm" className="whitespace-nowrap">
          {booking.seats} {booking.seats === 1 ? 'Seat' : 'Seats'}
        </Badge>
      ),
      width: 'auto',
    },
    {
      key: 'actions',
      header: '',
      cell: (booking) => (
        <button
          onClick={() => handleDeleteBooking(booking.id)}
          className="text-red-600 hover:text-red-900"
          title="Delete Booking"
        >
          <TrashIcon className="h-5 w-5" />
          <span className="sr-only">Delete Booking</span>
        </button>
      ),
      align: 'right',
      width: 'auto',
    },
  ]

  // Columns for reminders (no seats column)
  const reminderColumns: Column<BookingWithCustomer>[] = bookingColumns.filter(
    col => col.key !== 'seats'
  )

  const BookingTable = ({ items, type }: { items: BookingWithCustomer[], type: 'booking' | 'reminder' }) => (
    <DataTable
      data={items}
      columns={type === 'booking' ? bookingColumns : reminderColumns}
      getRowKey={(booking) => booking.id}
      emptyMessage={`No ${type === 'booking' ? 'bookings' : 'reminders'} found`}
      bordered
      renderMobileCard={(booking) => (
        <Card variant="bordered" padding="sm">
          <div className="space-y-2">
            <div className="flex justify-between items-start">
              <Link
                href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${params.id}`}
                className="font-medium text-blue-600 hover:text-blue-800"
              >
                {booking.customer.first_name} {booking.customer.last_name}
              </Link>
              <div className="flex items-center gap-2">
                {type === 'booking' && (
                  <Badge variant="success" size="sm" className="whitespace-nowrap">
                    {booking.seats} {booking.seats === 1 ? 'Seat' : 'Seats'}
                  </Badge>
                )}
                <button
                  onClick={() => handleDeleteBooking(booking.id)}
                  className="text-red-500 p-1 rounded-full hover:bg-gray-100"
                  title="Delete Booking"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-500">Booked on: {formatDate(booking.created_at)}</p>
            {booking.notes && (
              <p className="text-sm text-gray-500 italic whitespace-pre-wrap">
                {booking.notes}
              </p>
            )}
          </div>
        </Card>
      )}
    />
  )

  return (
    <PageWrapper>
      <PageHeader
        title={event?.name || 'Loading...'}
        subtitle={event ? `${formatDate(event.date)} at ${event.time}` : ''}
        backButton={{
          label: "Back to Events",
          href: "/events"
        }}
        actions={
          event && !isLoading && (
            <NavGroup>
              <NavLink href={`/events/${event.id}/edit`}>
                Edit Event
              </NavLink>
              <NavLink onClick={handleCopyAttendeeList}>
                Copy List
              </NavLink>
              <NavLink 
                onClick={handleDownloadReservationPosters}
                className={activeBookings.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}
              >
                Download Posters
              </NavLink>
              <NavLink onClick={() => setShowAddAttendeesModal(true)}>
                Add Attendees
              </NavLink>
              <NavLink onClick={() => setShowBookingForm(true)}>
                New Booking
              </NavLink>
              <NavLink href={`/events/${event.id}/check-in`}>
                Launch Check-in
              </NavLink>
            </NavGroup>
          )
        }
      />
      <PageContent>
        {showBookingForm && event && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
              <BookingForm event={event} onSubmit={handleCreateBooking} onCancel={() => setShowBookingForm(false)} />
            </div>
          </div>
        )}

        {showAddAttendeesModal && event && (
          <AddAttendeesModalWithCategories
            event={event}
            currentBookings={bookings}
            onClose={() => setShowAddAttendeesModal(false)}
            onAddAttendees={handleAddMultipleAttendees}
          />
        )}

        {event && (
          <Card padding="lg">
            <div className="flex items-start space-x-4">
              {event.hero_image_url && (
                <div className="flex-shrink-0">
                  <img 
                    src={event.hero_image_url} 
                    alt={event.name}
                    className="h-24 w-24 rounded-lg object-cover border border-gray-200"
                  />
                </div>
              )}
              <div className="flex-1">
                {event.category && (
                  <Badge
                    size="sm"
                    style={{ 
                      backgroundColor: event.category.color + '20',
                      color: event.category.color 
                    }}
                  >
                    {event.category.name}
                  </Badge>
                )}
                {event.short_description && (
                  <p className="mt-2 text-base text-gray-600">{event.short_description}</p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-gray-500">Capacity:</span>
                    <span className="ml-2 font-medium">{event.capacity || 'Unlimited'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Seats:</span>
                    <span className="ml-2 font-medium">{totalSeats}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {event && (
          <Section
            title={`Active Bookings (${activeBookings.length})`}
            description={`${totalSeats} seats booked${event.capacity ? ` of ${event.capacity}` : ''}`}
            variant="gray"
          >
            <BookingTable items={activeBookings} type="booking" />
          </Section>
        )}

        {event && (
          <Section
            title={`Reminders (${reminders.length})`}
            variant="gray"
          >
            <BookingTable items={reminders} type="reminder" />
          </Section>
        )}

        {event && (
          <Card>
            <EventTemplateManager eventId={event.id} eventName={event.name} />
          </Card>
        )}
      </PageContent>
    </PageWrapper>
  )
} 
