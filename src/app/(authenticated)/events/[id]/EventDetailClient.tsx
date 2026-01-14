'use client'

import { formatDate } from '@/lib/dateUtils'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Event as BaseEvent, Booking, Customer } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { TrashIcon } from '@heroicons/react/24/outline'
import { BookingForm } from '@/components/features/events/BookingForm'
import { AddAttendeesModalWithCategories } from '@/components/features/events/AddAttendeesModalWithCategories'
import { addAttendeesWithScheduledSMS } from '@/app/actions/event-sms-scheduler'
import { generateEventReservationPosters } from '@/app/actions/event-reservation-posters'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { regenerateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'

import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatPhoneForDisplay } from '@/lib/validation'
import { Section } from '@/components/ui-v2/layout/Section'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteBooking } from '@/app/actions/bookings'
import { deleteEvent } from '@/app/actions/events'
import { Button } from '@/components/ui-v2/forms/Button'

type Event = BaseEvent & {
  category?: EventCategory | null
}

type BookingWithCustomer = Omit<Booking, 'customer'> & {
  customer: Pick<Customer, 'first_name' | 'last_name' | 'id'>
}

export type EventCheckInRecord = {
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

interface EventDetailClientProps {
  event: Event
  bookings: BookingWithCustomer[]
  checkIns: EventCheckInRecord[]
  initialMarketingLinks: EventMarketingLink[]
}

export default function EventDetailClient({
  event,
  bookings,
  checkIns,
  initialMarketingLinks
}: EventDetailClientProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')
  const canDeleteBookings = canManageEvents || hasPermission('bookings', 'delete')

  const [showBookingForm, setShowBookingForm] = useState(false)
  const [showAddAttendeesModal, setShowAddAttendeesModal] = useState(false)
  const [isDeletingEvent, setIsDeletingEvent] = useState(false)

  const [marketingLinks, setMarketingLinks] = useState<EventMarketingLink[]>(initialMarketingLinks)
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingError, setMarketingError] = useState<string | null>(null)

  useEffect(() => {
    setMarketingLinks(initialMarketingLinks)
  }, [initialMarketingLinks])

  const handleRegenerateMarketingLinks = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to refresh marketing links.')
      return
    }

    try {
      setMarketingLoading(true)
      setMarketingError(null)
      const result = await regenerateEventMarketingLinks(event.id)
      if (!result.success) {
        const errorMessage = result.error || 'Failed to refresh marketing links'
        setMarketingError(errorMessage)
        toast.error(errorMessage)
        return
      }

      setMarketingLinks(result.links || [])
      toast.success('Marketing links refreshed')
      router.refresh()
    } catch (error) {
      console.error('Failed to regenerate marketing links:', error)
      setMarketingError('Failed to refresh marketing links.')
      toast.error('Failed to refresh marketing links')
    } finally {
      setMarketingLoading(false)
    }
  }, [canManageEvents, event.id, router])

  const handleCreateBooking = async (_data: Omit<Booking, 'id' | 'created_at'>, context?: { keepOpen?: boolean }) => {
    router.refresh()
    if (!context?.keepOpen) {
      setShowBookingForm(false)
    }
  }

  const handleAddMultipleAttendees = async (customerIds: string[]): Promise<void> => {
    if (!canManageEvents) {
      toast.error('You do not have permission to add attendees.')
      return
    }
    if (customerIds.length === 0) {
      toast.error('No customers selected.')
      return
    }

    try {
      const result = await addAttendeesWithScheduledSMS(event.id, customerIds)

      if ('error' in result && result.error) {
        toast.error(result.error)
        return
      }

      if (result.success) {
        let successMessage = `${result.added} attendee(s) added successfully!`
        if (result.skipped && result.skipped > 0) {
          successMessage += ` (${result.skipped} skipped - already booked)`
        }
        if (result.remindersScheduled && result.remindersScheduled > 0) {
          successMessage += ` SMS reminders scheduled.`
        }
        toast.success(successMessage)
        setShowAddAttendeesModal(false)
        router.refresh()
      } else {
        toast.error('Failed to add attendees')
      }
    } catch (error) {
      console.error('Failed to add multiple attendees:', error)
      toast.error('An error occurred while adding attendees. Please try again.')
    }
  }

  const handleDeleteBooking = async (bookingId: string) => {
    if (!canDeleteBookings) {
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
      router.refresh()
    } catch (error) {
      console.error('Error deleting booking:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete booking')
    }
  }

  const handleDeleteEvent = async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to delete events.')
      return
    }

    if (bookings.length > 0) {
      toast.error('Cannot delete an event with existing bookings. Delete bookings first.')
      return
    }

    if (!window.confirm(`Delete "${event.name}"? This action cannot be undone.`)) return

    try {
      setIsDeletingEvent(true)
      const result = await deleteEvent(event.id)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Event deleted successfully')
      router.replace('/events')
    } catch (error) {
      console.error('Error deleting event:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete event')
    } finally {
      setIsDeletingEvent(false)
    }
  }

  const activeBookings = bookings.filter(booking => !booking.is_reminder_only)
  const reminders = bookings.filter(booking => booking.is_reminder_only)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + (booking.seats ?? 0), 0)
  const totalCheckIns = checkIns.length

  const handleCopyAttendeeList = () => {
    let text = `Event: ${event.name}\n`
    text += `Date: ${formatDate(event.date)}\n`
    text += `Time: ${event.time}\n`
    text += `\n`

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

    if (reminders.length > 0) {
      text += `\nReminder List (${reminders.length}):\n`
      reminders.forEach((booking, index) => {
        text += `${index + 1}. ${booking.customer.first_name} ${booking.customer.last_name}\n`
      })
    }

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
        const binaryString = atob(result.pdf)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const pdfBlob = new Blob([bytes], { type: 'application/pdf' })

        const url = URL.createObjectURL(pdfBlob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        document.body.appendChild(link)
        link.click()

        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success('Reservation posters downloaded!', { id: loadingToast })
      }
    } catch (error) {
      console.error('Error downloading reservation posters:', error)
      toast.error('Failed to generate reservation posters', { id: loadingToast })
    }
  }

  const navItems: HeaderNavItem[] = []

  if (canManageEvents) {
    navItems.push(
      {
        label: 'Add a Booking',
        onClick: () => setShowBookingForm(true),
        active: false,
      },
      {
        label: 'Launch Check-In',
        href: `/events/${event.id}/check-in`,
        active: false,
      },
      {
        label: 'Add Bulk Reminders',
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

  navItems.push({
    label: 'Copy List',
    onClick: handleCopyAttendeeList,
    active: false,
  })

  if (canManageEvents) {
    navItems.push({
      label: 'Download Posters',
      onClick: handleDownloadReservationPosters,
      disabled: activeBookings.length === 0,
      active: false,
    })
  }

  const baseBookingColumns: Column<BookingWithCustomer>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (booking) => (
        <Link
          href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${event.id}`}
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

  const bookingActionsColumn: Column<BookingWithCustomer> | null = canDeleteBookings
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
                href={`/customers/${booking.customer.id}?booking_id=${booking.id}&return_to=/events/${event.id}`}
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
      title={event.name}
      subtitle={`${formatDate(event.date)} at ${event.time}`}
      backButton={{
        label: 'Back to Events',
        href: '/events',
      }}
      navItems={navItems}
      navActions={
        canManageEvents && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteEvent}
            loading={isDeletingEvent}
            disabled={isDeletingEvent || bookings.length > 0}
            title={bookings.length > 0 ? 'Delete all bookings/reminders before deleting this event' : 'Delete event'}
          >
            Delete Event
          </Button>
        )
      }
      className="bg-gray-50/50"
    >
      <Modal
        open={showBookingForm && canManageEvents}
        onClose={() => setShowBookingForm(false)}
        title={`New Booking for ${event.name}`}
        description={`${formatDate(event.date)} at ${event.time}`}
        size="lg"
      >
        <BookingForm event={event} onSubmit={handleCreateBooking} onCancel={() => setShowBookingForm(false)} />
      </Modal>

      {showAddAttendeesModal && canManageEvents && (
        <AddAttendeesModalWithCategories
          event={event}
          currentBookings={bookings}
          checkIns={checkIns}
          onClose={() => setShowAddAttendeesModal(false)}
          onAddAttendees={handleAddMultipleAttendees}
        />
      )}

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

            <section id="ai-content">
              <EventPromotionContentCard
                eventId={event.id}
                eventName={event.name}
                initialTicketUrl={event.booking_url ?? undefined}
                brief={event.brief ?? undefined}
                marketingLinks={marketingLinks}
                facebookName={event.facebook_event_name ?? undefined}
                facebookDescription={event.facebook_event_description ?? undefined}
                googleTitle={event.gbp_event_title ?? undefined}
                googleDescription={event.gbp_event_description ?? undefined}
              />
            </section>
          </div>

          <section id="checklist" className="space-y-6">
            <EventChecklistCard eventId={event.id} eventName={event.name} />
          </section>
        </div>
      </div>
    </PageLayout>
  )
}
