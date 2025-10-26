'use client'

import { formatDate } from '@/lib/dateUtils'
import { formatDistanceToNow } from 'date-fns'
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
import { generateEventReservationPosters } from '@/app/actions/event-reservation-posters'
import { EventChecklistCard } from '@/components/EventChecklistCard'
import { EventMarketingLinksCard } from '@/components/EventMarketingLinksCard'
import { getEventMarketingLinks, regenerateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'

// ui-v2 imports
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
// Removed unused Button and LinkButton imports
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatPhoneForDisplay } from '@/lib/validation'
import { Section } from '@/components/ui-v2/layout/Section'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteBooking } from '@/app/actions/bookings'
type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name' | 'id'>
}

type EventCheckInRecord = {
  id: string
  check_in_time: string
  check_in_method: string | null
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string | null
  }
}

export const dynamic = 'force-dynamic'

export default function EventViewPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')
  const [event, setEvent] = useState<Event | null>(null)
  const [bookings, setBookings] = useState<BookingWithCustomer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showBookingForm, setShowBookingForm] = useState(false)
  const [showAddAttendeesModal, setShowAddAttendeesModal] = useState(false)
  const [marketingLinks, setMarketingLinks] = useState<EventMarketingLink[]>([])
  const [marketingLoading, setMarketingLoading] = useState(true)
  const [marketingError, setMarketingError] = useState<string | null>(null)
  const [checkIns, setCheckIns] = useState<EventCheckInRecord[]>([])

  const loadMarketingLinks = useCallback(async (eventId: string) => {
    try {
      setMarketingLoading(true)
      setMarketingError(null)
      const result = await getEventMarketingLinks(eventId)
      if (!result.success) {
        setMarketingLinks([])
        setMarketingError(result.error || 'Failed to load marketing links')
        return
      }
      setMarketingLinks(result.links || [])
    } catch (error) {
      console.error('Error loading marketing links:', error)
      setMarketingLinks([])
      setMarketingError('Failed to load marketing links.')
    } finally {
      setMarketingLoading(false)
    }
  }, [])

  const loadEventData = useCallback(async () => {
    try {
      setIsLoading(true)
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*, category:event_categories(*)')
        .eq('id', params.id)
        .single()

      if (eventError) throw eventError
      const typedEvent = eventData ? (eventData as Event) : null
      setEvent(typedEvent)

      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, customer_id, seats, is_reminder_only, notes, created_at, customer:customers!inner(id, first_name, last_name)')
        .eq('event_id', params.id)
        .order('created_at', { ascending: true })

      if (bookingsError) throw bookingsError
      setBookings(bookingsData as BookingWithCustomer[])

      if (typedEvent?.id) {
        await loadMarketingLinks(typedEvent.id)

        const { data: checkInsData, error: checkInsError } = await supabase
          .from('event_check_ins')
          .select('id, check_in_time, check_in_method, customer:customers!inner(id, first_name, last_name, mobile_number)')
          .eq('event_id', typedEvent.id)
          .order('check_in_time', { ascending: false })

        if (checkInsError) {
          console.error('Error loading check-ins:', checkInsError)
          setCheckIns([])
        } else {
          setCheckIns((checkInsData as EventCheckInRecord[]) || [])
        }
      } else {
        setCheckIns([])
      }
    } catch (error) {
      console.error('Error loading event:', error)
      toast.error('Failed to load event details.')
      setMarketingLoading(false)
      setMarketingError('Failed to load marketing links.')
    } finally {
      setIsLoading(false)
    }
  }, [loadMarketingLinks, params.id, supabase])

  useEffect(() => {
    loadEventData()
  }, [loadEventData])

  const handleRegenerateMarketingLinks = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to refresh marketing links.')
      return
    }
    if (!event) return

    try {
      setMarketingLoading(true)
      setMarketingError(null)
      const result = await regenerateEventMarketingLinks(event.id)
      if (!result.success) {
        setMarketingLinks([])
        const errorMessage = result.error || 'Failed to refresh marketing links'
        setMarketingError(errorMessage)
        toast.error(errorMessage)
        return
      }

      setMarketingLinks(result.links || [])
      toast.success('Marketing links refreshed')
    } catch (error) {
      console.error('Failed to regenerate marketing links:', error)
      setMarketingError('Failed to refresh marketing links.')
      toast.error('Failed to refresh marketing links')
    } finally {
      setMarketingLoading(false)
    }
  }, [canManageEvents, event])

  const handleCreateBooking = async (_data: Omit<Booking, 'id' | 'created_at'>, context?: { keepOpen?: boolean }) => {
    // The BookingForm now handles all the logic including duplicate checking
    // This function is called after successful creation/update
    await loadEventData() // Refresh data
    if (!context?.keepOpen) {
      setShowBookingForm(false)
    }
  }

  const handleAddMultipleAttendees = async (customerIds: string[]): Promise<void> => {
    if (!canManageEvents) {
      toast.error('You do not have permission to add attendees.')
      return
    }
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
    if (!canManageEvents) {
      toast.error('You do not have permission to delete bookings.')
      return
    }
    if (!window.confirm('Are you sure you want to delete this booking?')) return

    try {
      const result = await deleteBooking(bookingId)
      if (result && 'error' in result && result.error) {
        throw new Error(result.error)
      }
      toast.success('Booking deleted successfully')
      await loadEventData()
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete booking')
      await loadEventData()
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
      text += `Attendees (${totalSeats} tickets):\n`
      activeBookings.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name} - ${booking.seats} ${booking.seats === 1 ? 'ticket' : 'tickets'}\n`
      })
    } else {
      text += 'No attendees yet.\n'
    }

    if (checkIns.length > 0) {
      text += `\nChecked-in guests (${checkIns.length}):\n`
      checkIns.forEach((checkIn, index) => {
        const fullName = `${checkIn.customer.first_name} ${checkIn.customer.last_name ?? ''}`.trim() || 'Guest'
        const phone = formatPhoneForDisplay(checkIn.customer.mobile_number)
        const phoneDisplay = phone ? ` - ${phone}` : ''
        text += `${index + 1}. ${fullName}${phoneDisplay}\n`
      })
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
    if (!canManageEvents) {
      toast.error('You do not have permission to download reservation posters.')
      return
    }
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

  if (!event && !isLoading) {
    return (
      <PageLayout
        title="Event Not Found"
        subtitle="The requested event could not be found."
        backButton={{
          label: 'Back to Events',
          href: '/events',
        }}
      />
    )
  }

  const activeBookings = bookings.filter(booking => !booking.is_reminder_only)
  const reminders = bookings.filter(booking => booking.is_reminder_only)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)
  const totalCheckIns = checkIns.length

  const navItems: HeaderNavItem[] | undefined = (() => {
    if (!event || isLoading) {
      return undefined
    }

    const items: HeaderNavItem[] = []

    if (canManageEvents) {
      items.push(
        {
          label: 'New Booking',
          onClick: () => setShowBookingForm(true),
          active: false,
        },
        {
          label: 'Launch Check-In',
          href: `/events/${event.id}/check-in`,
          active: false,
        },
        {
          label: 'Add Attendees',
          onClick: () => setShowAddAttendeesModal(true),
          active: false,
        },
        {
          label: 'Edit Event',
          href: `/events/${event.id}/edit`,
          active: false,
        },
      )
    }

    items.push({
      label: 'Copy List',
      onClick: handleCopyAttendeeList,
      active: false,
    })

    if (canManageEvents) {
      items.push({
        label: 'Download Posters',
        onClick: handleDownloadReservationPosters,
        disabled: activeBookings.length === 0,
        active: false,
      })
    }

    return items
  })()

  // Define columns for bookings table
  const baseBookingColumns: Column<BookingWithCustomer>[] = [
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
      header: 'Tickets',
      cell: (booking) => (
        <Badge variant="success" size="sm" className="whitespace-nowrap">
          {booking.seats} {booking.seats === 1 ? 'Ticket' : 'Tickets'}
        </Badge>
      ),
      width: 'auto',
    }
  ]

  const bookingActionsColumn: Column<BookingWithCustomer> | null = canManageEvents
    ? {
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
      }
    : null

  const bookingColumns: Column<BookingWithCustomer>[] = bookingActionsColumn
    ? [...baseBookingColumns, bookingActionsColumn]
    : baseBookingColumns

  // Columns for reminders (no seats column)
  const reminderColumns: Column<BookingWithCustomer>[] = bookingColumns.filter(
    col => col.key !== 'seats'
  )

  const formatCheckInMethod = (method: string | null) => {
    if (!method) return 'Manual'
    switch (method) {
      case 'qr':
        return 'QR'
      case 'self':
        return 'Self check-in'
      case 'manual':
      default:
        return 'Manual'
    }
  }

  const checkInColumns: Column<EventCheckInRecord>[] = [
    {
      key: 'guest',
      header: 'Guest',
      cell: (record) => (
        <div>
          <div className="text-sm font-medium text-gray-900">
            {`${record.customer.first_name} ${record.customer.last_name ?? ''}`.trim() || 'Guest'}
          </div>
          {record.customer.mobile_number && (
            <div className="text-sm text-gray-500">{formatPhoneForDisplay(record.customer.mobile_number)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'checked_in',
      header: 'Checked in',
      cell: (record) => (
        <span className="text-sm text-gray-500">
          {formatDistanceToNow(new Date(record.check_in_time), { addSuffix: true })}
        </span>
      ),
      width: 'auto',
    },
    {
      key: 'method',
      header: 'Method',
      cell: (record) => (
        <Badge variant="info" size="sm" className="capitalize">
          {formatCheckInMethod(record.check_in_method)}
        </Badge>
      ),
      width: 'auto',
    },
  ]

  const CheckInTable = ({ items }: { items: EventCheckInRecord[] }) => (
    <DataTable
      data={items}
      columns={checkInColumns}
      getRowKey={(record) => record.id}
      emptyMessage="No guests have checked in yet"
      bordered
      renderMobileCard={(record) => (
        <Card variant="bordered" padding="sm">
          <div className="space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-gray-900">
                  {`${record.customer.first_name} ${record.customer.last_name ?? ''}`.trim() || 'Guest'}
                </p>
                {record.customer.mobile_number && (
                  <p className="text-sm text-gray-500">{formatPhoneForDisplay(record.customer.mobile_number)}</p>
                )}
              </div>
              <Badge variant="info" size="sm" className="capitalize">
                {formatCheckInMethod(record.check_in_method)}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Checked in {formatDistanceToNow(new Date(record.check_in_time), { addSuffix: true })}
            </p>
          </div>
        </Card>
      )}
    />
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
                    {booking.seats} {booking.seats === 1 ? 'Ticket' : 'Tickets'}
                  </Badge>
                )}
                {canManageEvents && (
                  <button
                    onClick={() => handleDeleteBooking(booking.id)}
                    className="text-red-500 p-1 rounded-full hover:bg-gray-100"
                    title="Delete Booking"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
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
    <PageLayout
      title={event?.name || 'Loading...'}
      subtitle={event ? `${formatDate(event.date)} at ${event.time}` : ''}
      backButton={{
        label: 'Back to Events',
        href: '/events',
      }}
      navItems={navItems}
    >
      {showBookingForm && event && canManageEvents && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <BookingForm event={event} onSubmit={handleCreateBooking} onCancel={() => setShowBookingForm(false)} />
          </div>
        </div>
      )}

      {showAddAttendeesModal && event && canManageEvents && (
        <AddAttendeesModalWithCategories
          event={event}
          currentBookings={bookings}
          checkIns={checkIns}
          onClose={() => setShowAddAttendeesModal(false)}
          onAddAttendees={handleAddMultipleAttendees}
        />
      )}

      {event && (
        <div className="space-y-6">
          <section id="overview">
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
                        color: event.category.color,
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
                      <span className="text-gray-500">Total Tickets:</span>
                      <span className="ml-2 font-medium">{totalSeats}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <Section
                id="bookings"
                title={`Active Bookings (${activeBookings.length})`}
                description={`${totalSeats} tickets booked${event.capacity ? ` of ${event.capacity}` : ''}`}
                variant="gray"
              >
                <BookingTable items={activeBookings} type="booking" />
              </Section>

              <Section
                id="reminders"
                title={`Reminders (${reminders.length})`}
                variant="gray"
              >
                <BookingTable items={reminders} type="reminder" />
              </Section>

              <Section
                id="check-ins"
                title={`Checked-in Guests (${totalCheckIns})`}
                description="Everyone who has arrived and been welcomed tonight."
                variant="gray"
              >
                <CheckInTable items={checkIns} />
              </Section>

              <section id="marketing">
                <EventMarketingLinksCard
                  links={marketingLinks}
                  loading={marketingLoading}
                  error={marketingError}
                  onRegenerate={handleRegenerateMarketingLinks}
                />
              </section>
            </div>

            <section id="checklist" className="space-y-6">
              <EventChecklistCard eventId={event.id} eventName={event.name} />
            </section>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
