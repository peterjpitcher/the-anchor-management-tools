'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { Event as BaseEvent } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'
import {
  cancelEventManualBooking,
  createEventManualBooking,
  deleteEvent,
  updateEventManualBookingSeats
} from '@/app/actions/events'
import { regenerateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

type Event = BaseEvent & {
  category?: EventCategory | null
}

type EventBookingSummary = {
  id: string
  seats: number | null
  is_reminder_only: boolean
  status: string | null
  source: string | null
  created_at: string
  hold_expires_at: string | null
  cancelled_at: string | null
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    mobile_e164: string | null
  } | null
}

type EventCustomerSearchResult = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  mobile_number: string | null
  mobile_e164: string | null
  display_phone: string | null
}

interface EventDetailClientProps {
  event: Event
  initialMarketingLinks: EventMarketingLink[]
  initialBookings: EventBookingSummary[]
}

const DEFAULT_COUNTRY_CODE = '44'

function resolveStatusLabel(status: string | null): string {
  if (!status) return 'Scheduled'
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'cancelled':
      return 'Cancelled'
    case 'postponed':
      return 'Postponed'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status.replace(/_/g, ' ')
  }
}

function resolveStatusVariant(status: string | null): 'default' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'cancelled':
      return 'error'
    case 'postponed':
      return 'warning'
    default:
      return 'success'
  }
}

function resolveEventBookingStatusLabel(status: string | null): string {
  if (!status) return 'Unknown'
  switch (status) {
    case 'confirmed':
      return 'Confirmed'
    case 'pending_payment':
      return 'Pending payment'
    case 'cancelled':
      return 'Cancelled'
    case 'expired':
      return 'Expired'
    default:
      return status.replace(/_/g, ' ')
  }
}

function resolveEventBookingStatusVariant(status: string | null): 'default' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'confirmed':
      return 'success'
    case 'pending_payment':
      return 'warning'
    case 'cancelled':
    case 'expired':
      return 'error'
    default:
      return 'neutral'
  }
}

function formatEventBookingReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'invalid_seats':
      return 'Seats must be at least 1.'
    case 'event_not_found':
      return 'Event was not found.'
    case 'event_started':
      return 'This event has already started.'
    case 'booking_closed':
      return 'Bookings are closed for this event.'
    case 'not_bookable':
      return 'This event is not currently bookable.'
    case 'insufficient_capacity':
      return 'There is not enough capacity for that booking.'
    case 'customer_conflict':
      return 'This customer already has an active booking for this event.'
    case 'no_table':
      return 'No table is available for this event booking.'
    case 'event_datetime_missing':
      return 'Event date or time is not configured.'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Booking could not be created.'
  }
}

function formatEventBookingUpdateReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'invalid_seats':
      return 'Seats must be at least 1.'
    case 'booking_not_found':
      return 'Booking was not found.'
    case 'status_not_changeable':
      return 'This booking cannot be edited in its current status.'
    case 'event_started':
      return 'This event has already started.'
    case 'insufficient_capacity':
      return 'There are not enough seats available for that change.'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Booking could not be updated.'
  }
}

function formatCreatedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function splitName(fullName: string): { firstName?: string; lastName?: string } {
  const cleaned = fullName.trim()
  if (!cleaned) {
    return {}
  }

  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return {}
  }

  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  }
}

function deriveNameFromCustomerQuery(query: string): { firstName?: string; lastName?: string } {
  const cleaned = query.trim()
  if (!cleaned || !/\p{L}/u.test(cleaned)) {
    return {}
  }

  return splitName(cleaned)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 2,
})

export default function EventDetailClient({
  event,
  initialMarketingLinks,
  initialBookings
}: EventDetailClientProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')

  const [isDeletingEvent, setIsDeletingEvent] = useState(false)
  const [marketingLinks, setMarketingLinks] = useState<EventMarketingLink[]>(initialMarketingLinks)
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingError, setMarketingError] = useState<string | null>(null)
  const [isCreatingBooking, setIsCreatingBooking] = useState(false)
  const [bookingForm, setBookingForm] = useState({
    phone: '',
    first_name: '',
    last_name: '',
    seats: '2'
  })
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<EventCustomerSearchResult[]>([])
  const [searchingCustomers, setSearchingCustomers] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<EventCustomerSearchResult | null>(null)
  const [lastCreateResult, setLastCreateResult] = useState<{
    manage_booking_url: string | null
    next_step_url: string | null
    table_name: string | null
  } | null>(null)
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null)

  useEffect(() => {
    setMarketingLinks(initialMarketingLinks)
  }, [initialMarketingLinks])

  useEffect(() => {
    if (!canManageEvents) {
      setCustomerResults([])
      return
    }

    if (selectedCustomer) {
      setCustomerResults([])
      return
    }

    const query = customerQuery.trim()
    if (query.length < 2) {
      setCustomerResults([])
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearchingCustomers(true)

      try {
        const params = new URLSearchParams({
          q: query,
          default_country_code: DEFAULT_COUNTRY_CODE
        })

        const response = await fetch(`/api/events/customers/search?${params.toString()}`, {
          cache: 'no-store'
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Customer search failed')
        }

        if (!cancelled) {
          const rows = Array.isArray(payload.data) ? payload.data : []
          setCustomerResults(rows as EventCustomerSearchResult[])
        }
      } catch {
        if (!cancelled) {
          setCustomerResults([])
        }
      } finally {
        if (!cancelled) {
          setSearchingCustomers(false)
        }
      }
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [canManageEvents, customerQuery, selectedCustomer])

  const activeBookings = useMemo(
    () => initialBookings.filter((booking) => !['cancelled', 'expired'].includes(booking.status || '')),
    [initialBookings]
  )

  const confirmedSeats = useMemo(
    () =>
      initialBookings
        .filter((booking) => booking.status === 'confirmed')
        .reduce((total, booking) => total + Math.max(0, Number(booking.seats || 0)), 0),
    [initialBookings]
  )

  const bookingUrl = useMemo(() => {
    const trimmed = (event.booking_url || '').trim()
    return trimmed.length > 0 ? trimmed : null
  }, [event.booking_url])

  const handleOpenBookingUrl = useCallback(() => {
    if (!bookingUrl || !isHttpUrl(bookingUrl)) {
      toast.error('No valid booking URL set for this event.')
      return
    }

    window.open(bookingUrl, '_blank', 'noopener,noreferrer')
  }, [bookingUrl])

  const handleCopyToClipboard = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast.error('Failed to copy')
    }
  }, [])

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

  const handleDeleteEvent = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to delete events.')
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
  }, [canManageEvents, event.id, event.name, router])

  const handleCreateBooking = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to create event bookings.')
      return
    }

    const seats = Number.parseInt(bookingForm.seats, 10)
    if (!Number.isFinite(seats) || seats < 1) {
      toast.error('Please enter a valid seat count.')
      return
    }

    if (selectedCustomer && !bookingForm.phone.trim()) {
      toast.error('Selected customer has no phone number. Clear selection and enter one.')
      return
    }

    if (!bookingForm.phone.trim()) {
      toast.error('Please enter a phone number.')
      return
    }

    const queryNameParts = selectedCustomer ? {} : deriveNameFromCustomerQuery(customerQuery)
    const firstName = bookingForm.first_name.trim() || queryNameParts.firstName || undefined
    const lastName = bookingForm.last_name.trim() || queryNameParts.lastName || undefined

    try {
      setIsCreatingBooking(true)
      setLastCreateResult(null)

      const result = await createEventManualBooking({
        eventId: event.id,
        phone: bookingForm.phone.trim(),
        firstName,
        lastName,
        seats,
        defaultCountryCode: DEFAULT_COUNTRY_CODE
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      const createResult = result.data
      if (createResult.state === 'blocked' || createResult.state === 'full_with_waitlist_option') {
        toast.error(formatEventBookingReason(createResult.reason))
        return
      }

      if (createResult.state === 'pending_payment') {
        toast.success('Booking created and waiting for payment.')
      } else {
        toast.success(
          createResult.table_name
            ? `Booking confirmed and assigned to ${createResult.table_name}.`
            : 'Booking confirmed.'
        )
      }

      setLastCreateResult({
        manage_booking_url: createResult.manage_booking_url,
        next_step_url: createResult.next_step_url,
        table_name: createResult.table_name
      })
      setBookingForm((current) => ({
        ...current,
        phone: '',
        first_name: '',
        last_name: '',
        seats: '2'
      }))
      setSelectedCustomer(null)
      setCustomerQuery('')
      setCustomerResults([])
      router.refresh()
    } catch (error) {
      console.error('Failed to create event booking:', error)
      toast.error('Failed to create booking.')
    } finally {
      setIsCreatingBooking(false)
    }
  }, [bookingForm, canManageEvents, event.id, router, selectedCustomer])

  const eventDate = event.date ? formatDateFull(event.date) : 'To be confirmed'
  const eventTime = formatTime12Hour(event.time)
  const statusLabel = resolveStatusLabel(event.event_status ?? null)
  const statusVariant = resolveStatusVariant(event.event_status ?? null)
  const priceLabel = event.is_free || !event.price ? 'Free' : currencyFormatter.format(event.price)

  const handleEditBookingSeats = useCallback(async (booking: EventBookingSummary) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to edit bookings.')
      return
    }

    const currentSeats = Math.max(1, Number(booking.seats || 1))
    const rawInput = window.prompt('New seat count', String(currentSeats))
    if (rawInput === null) {
      return
    }

    const nextSeats = Number.parseInt(rawInput, 10)
    if (!Number.isFinite(nextSeats) || nextSeats < 1 || nextSeats > 20) {
      toast.error('Enter a seat count between 1 and 20.')
      return
    }

    try {
      setUpdatingBookingId(booking.id)
      const result = await updateEventManualBookingSeats({
        bookingId: booking.id,
        seats: nextSeats,
        sendSms: true
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      if (result.data.state === 'blocked') {
        toast.error(formatEventBookingUpdateReason(result.data.reason))
        return
      }

      if (result.data.state === 'unchanged') {
        toast.success('Seat count unchanged.')
        return
      }

      toast.success(
        result.data.sms_sent
          ? `Booking updated to ${result.data.new_seats} seat${result.data.new_seats === 1 ? '' : 's'} and SMS sent.`
          : `Booking updated to ${result.data.new_seats} seat${result.data.new_seats === 1 ? '' : 's'}.`
      )
      router.refresh()
    } catch (error) {
      console.error('Failed updating booking seats:', error)
      toast.error('Failed to update booking seats.')
    } finally {
      setUpdatingBookingId(null)
    }
  }, [canManageEvents, router])

  const handleCancelBooking = useCallback(async (booking: EventBookingSummary) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to cancel bookings.')
      return
    }

    const guestName = [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || 'this guest'
    const seatCount = Math.max(0, Number(booking.seats || 0))
    const isReminderOnly = booking.is_reminder_only === true || seatCount === 0
    const confirmationMessage = isReminderOnly
      ? `Remove ${guestName} from reminder-only guests?`
      : `Cancel booking for ${guestName} (${seatCount} seat${seatCount === 1 ? '' : 's'}) and send SMS notice?`

    if (!window.confirm(confirmationMessage)) {
      return
    }

    try {
      setCancellingBookingId(booking.id)
      const result = await cancelEventManualBooking({
        bookingId: booking.id,
        sendSms: true
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      if (result.data.state === 'already_cancelled') {
        toast.success('Booking was already cancelled.')
        router.refresh()
        return
      }

      if (result.data.state === 'blocked') {
        toast.error('Booking cannot be cancelled in its current state.')
        return
      }

      toast.success(
        result.data.sms_sent
          ? 'Booking cancelled and SMS sent.'
          : 'Booking cancelled. SMS was not sent.'
      )
      router.refresh()
    } catch (error) {
      console.error('Failed cancelling booking:', error)
      toast.error('Failed to cancel booking.')
    } finally {
      setCancellingBookingId(null)
    }
  }, [canManageEvents, router])

  return (
    <PageLayout
      title={event.name}
      subtitle={`${eventDate}${event.time ? ` • ${eventTime}` : ''}${event.category?.name ? ` • ${event.category.name}` : ''}`}
      backButton={{ label: 'Back to events', href: '/events' }}
      headerActions={
        canManageEvents || bookingUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            {bookingUrl && (
              <Button
                variant="secondary"
                onClick={handleOpenBookingUrl}
                leftIcon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
              >
                Open booking link
              </Button>
            )}
            {canManageEvents && (
              <Button
                variant="primary"
                onClick={() => router.push(`/events/${event.id}/edit`)}
                leftIcon={<PencilSquareIcon className="h-4 w-4" />}
              >
                Edit event
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <div className="space-y-6">
        <Card padding="lg">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant} size="sm">
                  {statusLabel}
                </Badge>
                {event.category?.name && (
                  <Badge variant="secondary" size="sm">
                    {event.category.name}
                  </Badge>
                )}
                <Badge variant={event.is_free || !event.price ? 'info' : 'secondary'} size="sm">
                  {priceLabel}
                </Badge>
                {bookingUrl && (
                  <Badge variant="info" size="sm" title={bookingUrl}>
                    booking_url set
                  </Badge>
                )}
              </div>

              {event.short_description && (
                <p className="text-sm text-gray-600">{event.short_description}</p>
              )}

              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {event.performer_name && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Performer</dt>
                    <dd className="mt-1 text-sm text-gray-900">{event.performer_name}</dd>
                  </div>
                )}
                {event.event_type && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event type</dt>
                    <dd className="mt-1 text-sm text-gray-900 font-mono">{event.event_type}</dd>
                  </div>
                )}
                {event.doors_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Doors</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.doors_time)}</dd>
                  </div>
                )}
                {event.last_entry_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last entry</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.last_entry_time)}</dd>
                  </div>
                )}
                {event.end_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ends</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.end_time)}</dd>
                  </div>
                )}
                {event.slug && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Slug</dt>
                    <dd className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-mono text-sm text-gray-900 break-all">{event.slug}</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        onClick={() => handleCopyToClipboard(event.slug || '', 'Slug')}
                      >
                        Copy
                      </Button>
                    </dd>
                  </div>
                )}
                {event.brief?.trim() && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event brief</dt>
                    <dd className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-gray-600">{event.brief.trim().length.toLocaleString()} chars</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        onClick={() => handleCopyToClipboard(event.brief?.trim() ?? '', 'Event brief')}
                      >
                        Copy brief
                      </Button>
                    </dd>
                  </div>
                )}
              </dl>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Booking URL</p>
                    {bookingUrl ? (
                      <>
                        <p className="mt-1 font-mono text-sm text-blue-700 break-all">{bookingUrl}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Optional external booking link for web or social channels.
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-gray-600">
                        No booking URL set. Add one in “Edit event” if you want a link out to your booking provider or website.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {bookingUrl && (
                      <>
                        <Button
                          size="xs"
                          variant="secondary"
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                          onClick={() => handleCopyToClipboard(bookingUrl, 'Booking URL')}
                        >
                          Copy
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          leftIcon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
                          onClick={handleOpenBookingUrl}
                        >
                          Open
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {event.hero_image_url && (
              <div className="w-full shrink-0 lg:w-56">
                <img
                  src={event.hero_image_url}
                  alt={`${event.name} artwork`}
                  className="aspect-square w-full rounded-lg border border-gray-200 bg-white object-cover"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        </Card>

        <Card padding="lg">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Book Guest</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Create an event booking directly from this screen.
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Find existing customer first
                  <input
                    type="text"
                    value={customerQuery}
                    onChange={(inputEvent) => {
                      setSelectedCustomer(null)
                      setCustomerQuery(inputEvent.target.value)
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Search by name or phone"
                  />
                </label>

                {searchingCustomers && (
                  <p className="text-xs text-gray-500">Searching customers…</p>
                )}

                {!selectedCustomer && customerResults.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-gray-200 bg-white p-1">
                    {customerResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(customer)
                          setCustomerQuery(customer.full_name)
                          setCustomerResults([])
                          setBookingForm((current) => ({
                            ...current,
                            phone: customer.display_phone || '',
                            first_name: customer.first_name || '',
                            last_name: customer.last_name || ''
                          }))
                        }}
                        className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100"
                      >
                        <p className="font-medium text-gray-900">{customer.full_name}</p>
                        <p className="text-gray-500">{customer.display_phone || 'No phone number saved'}</p>
                      </button>
                    ))}
                  </div>
                )}

                {selectedCustomer && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Selected customer</p>
                        <p className="text-sm font-medium text-blue-900">{selectedCustomer.full_name}</p>
                        <p className="text-xs text-blue-800">
                          {selectedCustomer.display_phone || 'No phone number saved'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        onClick={() => {
                          setSelectedCustomer(null)
                          setCustomerQuery('')
                          setCustomerResults([])
                          setBookingForm((current) => ({
                            ...current,
                            phone: '',
                            first_name: '',
                            last_name: ''
                          }))
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Seats
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={bookingForm.seats}
                      onChange={(inputEvent) =>
                        setBookingForm((current) => ({
                          ...current,
                          seats: inputEvent.target.value
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>

                  {!selectedCustomer && (
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Phone (07... or +...)
                      <input
                        type="tel"
                        value={bookingForm.phone}
                        onChange={(inputEvent) =>
                          setBookingForm((current) => ({
                            ...current,
                            phone: inputEvent.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="07... or +..."
                      />
                    </label>
                  )}

                  {!selectedCustomer && (
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      First name (optional)
                      <input
                        type="text"
                        value={bookingForm.first_name}
                        onChange={(inputEvent) =>
                          setBookingForm((current) => ({
                            ...current,
                            first_name: inputEvent.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                  )}

                  {!selectedCustomer && (
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Last name (optional)
                      <input
                        type="text"
                        value={bookingForm.last_name}
                        onChange={(inputEvent) =>
                          setBookingForm((current) => ({
                            ...current,
                            last_name: inputEvent.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={handleCreateBooking}
                  loading={isCreatingBooking}
                  disabled={isCreatingBooking || !canManageEvents}
                >
                  Book guest
                </Button>
                {!canManageEvents && (
                  <p className="text-xs text-gray-500">You need event manage permission to create bookings.</p>
                )}
              </div>

              {lastCreateResult && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <p>
                    Booking created{lastCreateResult.table_name ? ` on ${lastCreateResult.table_name}` : ''}.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {lastCreateResult.manage_booking_url && (
                      <>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() =>
                            handleCopyToClipboard(lastCreateResult.manage_booking_url || '', 'Manage booking link')
                          }
                        >
                          Copy manage link
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            if (lastCreateResult.manage_booking_url && isHttpUrl(lastCreateResult.manage_booking_url)) {
                              window.open(lastCreateResult.manage_booking_url, '_blank', 'noopener,noreferrer')
                            }
                          }}
                        >
                          Open manage link
                        </Button>
                      </>
                    )}
                    {lastCreateResult.next_step_url && (
                      <>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() =>
                            handleCopyToClipboard(lastCreateResult.next_step_url || '', 'Payment link')
                          }
                        >
                          Copy payment link
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            if (lastCreateResult.next_step_url && isHttpUrl(lastCreateResult.next_step_url)) {
                              window.open(lastCreateResult.next_step_url, '_blank', 'noopener,noreferrer')
                            }
                          }}
                        >
                          Open payment link
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Booked Guests</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {activeBookings.length} active bookings • {confirmedSeats} confirmed seats
                  </p>
                </div>
              </div>

              {initialBookings.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-600">
                  No guests are booked yet.
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-gray-200">
                  <div className="max-h-96 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Guest
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Seats
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Status
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Created
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {initialBookings.map((booking) => {
                          const fullName = [booking.customer?.first_name, booking.customer?.last_name]
                            .filter(Boolean)
                            .join(' ')
                          const phone = booking.customer?.mobile_e164 || booking.customer?.mobile_number || 'No phone'
                          const canCancelBooking = ['confirmed', 'pending_payment'].includes(booking.status || '')
                          const isReminderOnly = booking.is_reminder_only === true || Math.max(0, Number(booking.seats || 0)) === 0
                          const canEditBooking = canCancelBooking && !isReminderOnly

                          return (
                            <tr key={booking.id}>
                              <td className="px-3 py-2 align-top">
                                <p className="text-sm font-medium text-gray-900">
                                  {fullName || 'Unknown guest'}
                                </p>
                                <p className="text-xs text-gray-500">{phone}</p>
                                {isReminderOnly && (
                                  <Badge variant="info" size="sm" className="mt-1">
                                    Reminder only
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-700">
                                {Math.max(0, Number(booking.seats || 0))}
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant={resolveEventBookingStatusVariant(booking.status)} size="sm">
                                  {resolveEventBookingStatusLabel(booking.status)}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600">
                                {formatCreatedAt(booking.created_at)}
                              </td>
                              <td className="px-3 py-2">
                                {canManageEvents && (canEditBooking || canCancelBooking) ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    {canEditBooking && (
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="secondary"
                                        onClick={() => handleEditBookingSeats(booking)}
                                        loading={updatingBookingId === booking.id}
                                        disabled={updatingBookingId === booking.id || cancellingBookingId === booking.id}
                                      >
                                        Edit seats
                                      </Button>
                                    )}
                                    {canCancelBooking && (
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="secondary"
                                        onClick={() => handleCancelBooking(booking)}
                                        loading={cancellingBookingId === booking.id}
                                        disabled={cancellingBookingId === booking.id || updatingBookingId === booking.id}
                                      >
                                        Cancel
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">-</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <EventMarketingLinksCard
              links={marketingLinks}
              loading={marketingLoading}
              error={marketingError}
              onRegenerate={canManageEvents ? handleRegenerateMarketingLinks : undefined}
            />

            <EventPromotionContentCard
              eventId={event.id}
              eventName={event.name}
              initialTicketUrl={bookingUrl}
              brief={event.brief}
              marketingLinks={marketingLinks}
              facebookName={event.facebook_event_name ?? null}
              facebookDescription={event.facebook_event_description ?? null}
              googleTitle={event.gbp_event_title ?? null}
              googleDescription={event.gbp_event_description ?? null}
              opentableTitle={event.opentable_experience_title ?? null}
              opentableDescription={event.opentable_experience_description ?? null}
            />
          </div>

          <div className="space-y-6">
            <EventChecklistCard eventId={event.id} eventName={event.name} />

            {canManageEvents && (
              <Card
                padding="lg"
                className="border border-red-200 bg-red-50/40"
              >
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Danger zone</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Deleting an event cannot be undone.
                    </p>
                  </div>

                  <Button
                    variant="danger"
                    loading={isDeletingEvent}
                    disabled={isDeletingEvent}
                    onClick={handleDeleteEvent}
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                  >
                    Delete event
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
