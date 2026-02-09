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
import { cancelEventManualBooking, createEventManualBooking, deleteEvent } from '@/app/actions/events'
import { regenerateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'
import {
  addEventInterestManualRecipient,
  addEventInterestManualRecipients,
  addEventInterestManualRecipientByPhone,
  removeEventInterestManualRecipient,
  type EventInterestAudienceData
} from '@/app/actions/event-interest-audience'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  UsersIcon,
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

type ReminderPickerFilter = 'all' | 'same_event_type' | 'other_events'

interface EventDetailClientProps {
  event: Event
  initialMarketingLinks: EventMarketingLink[]
  initialBookings: EventBookingSummary[]
  initialInterestAudience: EventInterestAudienceData | null
}

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
    case 'no_table':
      return 'No table is available for this event booking.'
    case 'event_datetime_missing':
      return 'Event date or time is not configured.'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Booking could not be created.'
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
  initialBookings,
  initialInterestAudience
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
    default_country_code: '44',
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
  const [interestAudience, setInterestAudience] = useState<EventInterestAudienceData | null>(initialInterestAudience)
  const [interestCustomerQuery, setInterestCustomerQuery] = useState('')
  const [interestCustomerResults, setInterestCustomerResults] = useState<EventCustomerSearchResult[]>([])
  const [searchingInterestCustomers, setSearchingInterestCustomers] = useState(false)
  const [selectedInterestCustomer, setSelectedInterestCustomer] = useState<EventCustomerSearchResult | null>(null)
  const [isAddingInterestRecipient, setIsAddingInterestRecipient] = useState(false)
  const [removingInterestCustomerId, setRemovingInterestCustomerId] = useState<string | null>(null)
  const [isAddingInterestPhoneRecipient, setIsAddingInterestPhoneRecipient] = useState(false)
  const [interestPhoneForm, setInterestPhoneForm] = useState({
    phone: '',
    first_name: '',
    last_name: '',
    default_country_code: '44'
  })
  const [isReminderPickerOpen, setIsReminderPickerOpen] = useState(false)
  const [reminderPickerFilter, setReminderPickerFilter] = useState<ReminderPickerFilter>('all')
  const [reminderPickerQuery, setReminderPickerQuery] = useState('')
  const [selectedReminderCandidateIds, setSelectedReminderCandidateIds] = useState<string[]>([])
  const [isAddingReminderCandidates, setIsAddingReminderCandidates] = useState(false)
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)

  useEffect(() => {
    setMarketingLinks(initialMarketingLinks)
  }, [initialMarketingLinks])

  useEffect(() => {
    setInterestAudience(initialInterestAudience)
  }, [initialInterestAudience])

  useEffect(() => {
    if (!interestAudience) return
    if (
      interestAudience.behavior_candidates.length === 0 &&
      interestAudience.reminder_picker_candidates.length > 0
    ) {
      setIsReminderPickerOpen(true)
    }
  }, [
    interestAudience?.event_id,
    interestAudience?.behavior_candidates.length,
    interestAudience?.reminder_picker_candidates.length
  ])

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
          default_country_code: bookingForm.default_country_code || '44'
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
  }, [bookingForm.default_country_code, canManageEvents, customerQuery, selectedCustomer])

  useEffect(() => {
    if (!canManageEvents) {
      setInterestCustomerResults([])
      return
    }

    if (selectedInterestCustomer) {
      setInterestCustomerResults([])
      return
    }

    const query = interestCustomerQuery.trim()
    if (query.length < 2) {
      setInterestCustomerResults([])
      return
    }

    const existingManualRecipientIds = new Set(
      (interestAudience?.manual_recipients || []).map((recipient) => recipient.customer_id)
    )

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearchingInterestCustomers(true)

      try {
        const params = new URLSearchParams({
          q: query,
          default_country_code: '44'
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
          setInterestCustomerResults(
            (rows as EventCustomerSearchResult[]).filter((row) => !existingManualRecipientIds.has(row.id))
          )
        }
      } catch {
        if (!cancelled) {
          setInterestCustomerResults([])
        }
      } finally {
        if (!cancelled) {
          setSearchingInterestCustomers(false)
        }
      }
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [canManageEvents, interestAudience, interestCustomerQuery, selectedInterestCustomer])

  const reminderPickerCandidates = useMemo(
    () => interestAudience?.reminder_picker_candidates || [],
    [interestAudience]
  )

  const reminderPickerCounts = useMemo(() => ({
    all: reminderPickerCandidates.length,
    same_event_type: reminderPickerCandidates.filter((candidate) => candidate.source === 'same_event_type').length,
    other_events: reminderPickerCandidates.filter((candidate) => candidate.source === 'other_events').length
  }), [reminderPickerCandidates])

  const filteredReminderPickerCandidates = useMemo(() => {
    const query = reminderPickerQuery.trim().toLowerCase()

    return reminderPickerCandidates.filter((candidate) => {
      if (reminderPickerFilter !== 'all' && candidate.source !== reminderPickerFilter) return false
      if (!query) return true

      return `${candidate.full_name} ${candidate.display_phone || ''}`.toLowerCase().includes(query)
    })
  }, [reminderPickerCandidates, reminderPickerFilter, reminderPickerQuery])

  const selectableReminderCandidateIds = useMemo(() => {
    return new Set(
      reminderPickerCandidates
        .filter((candidate) => !candidate.manually_added && !candidate.is_currently_booked)
        .map((candidate) => candidate.customer_id)
    )
  }, [reminderPickerCandidates])

  useEffect(() => {
    setSelectedReminderCandidateIds((current) =>
      current.filter((customerId) => selectableReminderCandidateIds.has(customerId))
    )
  }, [selectableReminderCandidateIds])

  const selectedReminderCandidateIdSet = useMemo(
    () => new Set(selectedReminderCandidateIds),
    [selectedReminderCandidateIds]
  )

  const selectableVisibleReminderCandidateIds = useMemo(
    () =>
      filteredReminderPickerCandidates
        .filter((candidate) => selectableReminderCandidateIds.has(candidate.customer_id))
        .map((candidate) => candidate.customer_id),
    [filteredReminderPickerCandidates, selectableReminderCandidateIds]
  )

  const selectedReminderCandidatesCount = useMemo(
    () => selectedReminderCandidateIds.filter((customerId) => selectableReminderCandidateIds.has(customerId)).length,
    [selectedReminderCandidateIds, selectableReminderCandidateIds]
  )

  const allSelectableVisibleReminderCandidatesSelected = useMemo(() => {
    if (selectableVisibleReminderCandidateIds.length === 0) return false
    return selectableVisibleReminderCandidateIds.every((customerId) => selectedReminderCandidateIdSet.has(customerId))
  }, [selectableVisibleReminderCandidateIds, selectedReminderCandidateIdSet])

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

    try {
      setIsCreatingBooking(true)
      setLastCreateResult(null)

      const result = await createEventManualBooking({
        eventId: event.id,
        phone: bookingForm.phone.trim(),
        firstName: bookingForm.first_name.trim() || undefined,
        lastName: bookingForm.last_name.trim() || undefined,
        defaultCountryCode: bookingForm.default_country_code.trim() || undefined,
        seats
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

  const handleAddManualInterestRecipient = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage interest recipients.')
      return
    }

    if (!selectedInterestCustomer) {
      toast.error('Select a customer first.')
      return
    }

    try {
      setIsAddingInterestRecipient(true)
      const result = await addEventInterestManualRecipient(event.id, selectedInterestCustomer.id)
      if (!result.success) {
        toast.error(result.error || 'Failed to add recipient')
        return
      }

      toast.success('Customer added to event interest audience')
      setSelectedInterestCustomer(null)
      setInterestCustomerQuery('')
      setInterestCustomerResults([])
      router.refresh()
    } catch (error) {
      console.error('Failed adding manual interest recipient:', error)
      toast.error('Failed to add recipient')
    } finally {
      setIsAddingInterestRecipient(false)
    }
  }, [canManageEvents, event.id, router, selectedInterestCustomer])

  const handleAddManualInterestRecipientByPhone = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage interest recipients.')
      return
    }

    if (!interestPhoneForm.phone.trim()) {
      toast.error('Enter a phone number first.')
      return
    }

    try {
      setIsAddingInterestPhoneRecipient(true)
      const result = await addEventInterestManualRecipientByPhone(event.id, {
        phone: interestPhoneForm.phone.trim(),
        firstName: interestPhoneForm.first_name.trim() || undefined,
        lastName: interestPhoneForm.last_name.trim() || undefined,
        defaultCountryCode: interestPhoneForm.default_country_code.trim() || undefined
      })

      if (!result.success) {
        toast.error(result.error || 'Failed to add recipient')
        return
      }

      toast.success('Guest added to event reminder audience')
      setInterestPhoneForm((current) => ({
        ...current,
        phone: '',
        first_name: '',
        last_name: ''
      }))
      router.refresh()
    } catch (error) {
      console.error('Failed adding manual interest recipient by phone:', error)
      toast.error('Failed to add recipient')
    } finally {
      setIsAddingInterestPhoneRecipient(false)
    }
  }, [canManageEvents, event.id, interestPhoneForm, router])

  const handleToggleReminderCandidate = useCallback((customerId: string, checked: boolean) => {
    setSelectedReminderCandidateIds((current) => {
      const currentSet = new Set(current)
      if (checked) {
        currentSet.add(customerId)
      } else {
        currentSet.delete(customerId)
      }
      return Array.from(currentSet)
    })
  }, [])

  const handleSelectVisibleReminderCandidates = useCallback(() => {
    setSelectedReminderCandidateIds((current) => {
      const currentSet = new Set(current)
      for (const customerId of selectableVisibleReminderCandidateIds) {
        currentSet.add(customerId)
      }
      return Array.from(currentSet)
    })
  }, [selectableVisibleReminderCandidateIds])

  const handleClearReminderSelection = useCallback(() => {
    setSelectedReminderCandidateIds([])
  }, [])

  const handleAddSelectedReminderCandidates = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage interest recipients.')
      return
    }

    const customerIds = selectedReminderCandidateIds.filter((customerId) =>
      selectableReminderCandidateIds.has(customerId)
    )

    if (customerIds.length === 0) {
      toast.error('Select at least one guest first.')
      return
    }

    try {
      setIsAddingReminderCandidates(true)
      const result = await addEventInterestManualRecipients(event.id, customerIds)
      if (!result.success) {
        toast.error(result.error || 'Failed to add selected guests')
        return
      }

      toast.success(`${customerIds.length} guest${customerIds.length === 1 ? '' : 's'} added to reminder audience`)
      setSelectedReminderCandidateIds([])
      router.refresh()
    } catch (error) {
      console.error('Failed adding selected reminder candidates:', error)
      toast.error('Failed to add selected guests')
    } finally {
      setIsAddingReminderCandidates(false)
    }
  }, [canManageEvents, event.id, router, selectedReminderCandidateIds, selectableReminderCandidateIds])

  const handleRemoveManualInterestRecipient = useCallback(async (customerId: string) => {
    if (!canManageEvents) {
      toast.error('You do not have permission to manage interest recipients.')
      return
    }

    try {
      setRemovingInterestCustomerId(customerId)
      const result = await removeEventInterestManualRecipient(event.id, customerId)
      if (!result.success) {
        toast.error(result.error || 'Failed to remove recipient')
        return
      }

      toast.success('Customer removed from manual interest audience')
      router.refresh()
    } catch (error) {
      console.error('Failed removing manual interest recipient:', error)
      toast.error('Failed to remove recipient')
    } finally {
      setRemovingInterestCustomerId(null)
    }
  }, [canManageEvents, event.id, router])

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
                      Country code
                      <input
                        type="text"
                        value={bookingForm.default_country_code}
                        onChange={(inputEvent) =>
                          setBookingForm((current) => ({
                            ...current,
                            default_country_code: inputEvent.target.value.replace(/[^\d]/g, '').slice(0, 4)
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        placeholder="44"
                      />
                    </label>
                  )}

                  {!selectedCustomer && (
                    <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Phone number
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
                        placeholder="07555 123456"
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
                                {canManageEvents && canCancelBooking ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => handleCancelBooking(booking)}
                                    loading={cancellingBookingId === booking.id}
                                    disabled={cancellingBookingId === booking.id}
                                  >
                                    Cancel
                                  </Button>
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

        <Card padding="lg">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Interest Reminder Audience</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Guests from past behavior are shown here, and you can manually add extra guests for cron outreach.
                </p>
              </div>
              {interestAudience && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" size="sm">
                    Behavior {interestAudience.stats.behavior_total}
                  </Badge>
                  <Badge variant="info" size="sm">
                    Manual {interestAudience.stats.manual_total}
                  </Badge>
                  <Badge variant="success" size="sm">
                    Eligible now {interestAudience.stats.eligible_now_total}
                  </Badge>
                </div>
              )}
            </div>

            {!interestAudience ? (
              <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-600">
                Audience details are unavailable for this event.
              </div>
            ) : (
              <>
                {!interestAudience.event_type && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    This event has no <span className="font-mono">event_type</span> yet. Same-type suggestions rely on
                    <span className="font-mono"> event_type</span>, but other-event picks and manual recipients still work.
                  </div>
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">Add manual recipient</h3>
                    {canManageEvents ? (
                      <>
                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-gray-600">
                              Pick from past guests who attended this type or other previous events.
                            </p>
                            <Button
                              type="button"
                              size="xs"
                              variant="secondary"
                              leftIcon={<UsersIcon className="h-4 w-4" />}
                              onClick={() => setIsReminderPickerOpen((current) => !current)}
                            >
                              {isReminderPickerOpen
                                ? 'Hide guest picker'
                                : `Pick from past guests (${reminderPickerCounts.all})`}
                            </Button>
                          </div>

                          {isReminderPickerOpen && (
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={reminderPickerFilter === 'all' ? 'primary' : 'secondary'}
                                  onClick={() => setReminderPickerFilter('all')}
                                >
                                  All ({reminderPickerCounts.all})
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={reminderPickerFilter === 'same_event_type' ? 'primary' : 'secondary'}
                                  onClick={() => setReminderPickerFilter('same_event_type')}
                                >
                                  Same type ({reminderPickerCounts.same_event_type})
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={reminderPickerFilter === 'other_events' ? 'primary' : 'secondary'}
                                  onClick={() => setReminderPickerFilter('other_events')}
                                >
                                  Other events ({reminderPickerCounts.other_events})
                                </Button>
                              </div>

                              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                                Search picked list
                                <input
                                  type="text"
                                  value={reminderPickerQuery}
                                  onChange={(inputEvent) => setReminderPickerQuery(inputEvent.target.value)}
                                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                  placeholder="Search by name or phone"
                                />
                              </label>

                              {filteredReminderPickerCandidates.length === 0 ? (
                                <div className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-600">
                                  No guests match this filter yet.
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="secondary"
                                      onClick={handleSelectVisibleReminderCandidates}
                                      disabled={
                                        selectableVisibleReminderCandidateIds.length === 0 ||
                                        allSelectableVisibleReminderCandidatesSelected ||
                                        isAddingReminderCandidates
                                      }
                                    >
                                      Select visible
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="secondary"
                                      onClick={handleClearReminderSelection}
                                      disabled={selectedReminderCandidatesCount === 0 || isAddingReminderCandidates}
                                    >
                                      Clear
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="primary"
                                      onClick={handleAddSelectedReminderCandidates}
                                      disabled={selectedReminderCandidatesCount === 0 || isAddingReminderCandidates}
                                      loading={isAddingReminderCandidates}
                                    >
                                      Add selected ({selectedReminderCandidatesCount})
                                    </Button>
                                  </div>

                                  <div className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-white">
                                    <ul className="divide-y divide-gray-100">
                                      {filteredReminderPickerCandidates.map((candidate) => {
                                        const isSelectable = selectableReminderCandidateIds.has(candidate.customer_id)
                                        const isSelected = selectedReminderCandidateIdSet.has(candidate.customer_id)

                                        return (
                                          <li
                                            key={candidate.customer_id}
                                            className="flex flex-wrap items-start justify-between gap-3 px-3 py-2"
                                          >
                                            <label
                                              className={`flex min-w-0 flex-1 items-start gap-2 ${
                                                isSelectable ? 'cursor-pointer' : 'cursor-default'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:cursor-not-allowed"
                                                checked={isSelected}
                                                disabled={!isSelectable || isAddingReminderCandidates}
                                                onChange={(inputEvent) =>
                                                  handleToggleReminderCandidate(candidate.customer_id, inputEvent.target.checked)
                                                }
                                              />
                                              <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-gray-900">{candidate.full_name}</p>
                                                <p className="text-xs text-gray-500">
                                                  {candidate.display_phone || 'No phone number saved'}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                  {candidate.last_engaged_at
                                                    ? `Last seen ${formatCreatedAt(candidate.last_engaged_at)}`
                                                    : 'Last seen unknown'}
                                                </p>
                                              </div>
                                            </label>

                                            <div className="flex flex-wrap gap-1">
                                              <Badge
                                                variant={candidate.source === 'same_event_type' ? 'secondary' : 'neutral'}
                                                size="sm"
                                              >
                                                {candidate.source === 'same_event_type' ? 'Same type' : 'Other events'}
                                              </Badge>
                                              {candidate.sms_eligible_for_marketing ? (
                                                <Badge variant="success" size="sm">Eligible</Badge>
                                              ) : (
                                                <Badge variant="error" size="sm">Ineligible</Badge>
                                              )}
                                              {candidate.is_currently_booked && (
                                                <Badge variant="warning" size="sm">Already booked</Badge>
                                              )}
                                              {candidate.manually_added && (
                                                <Badge variant="info" size="sm">Already added</Badge>
                                              )}
                                            </div>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Quick add by phone (no seats)
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              Creates a customer if needed and adds them to reminders.
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Country code
                              <input
                                type="text"
                                value={interestPhoneForm.default_country_code}
                                onChange={(inputEvent) =>
                                  setInterestPhoneForm((current) => ({
                                    ...current,
                                    default_country_code: inputEvent.target.value.replace(/[^\d]/g, '').slice(0, 4)
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="44"
                              />
                            </label>

                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Phone number
                              <input
                                type="tel"
                                value={interestPhoneForm.phone}
                                onChange={(inputEvent) =>
                                  setInterestPhoneForm((current) => ({
                                    ...current,
                                    phone: inputEvent.target.value
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="07555 123456"
                              />
                            </label>

                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              First name (optional)
                              <input
                                type="text"
                                value={interestPhoneForm.first_name}
                                onChange={(inputEvent) =>
                                  setInterestPhoneForm((current) => ({
                                    ...current,
                                    first_name: inputEvent.target.value
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              />
                            </label>

                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Last name (optional)
                              <input
                                type="text"
                                value={interestPhoneForm.last_name}
                                onChange={(inputEvent) =>
                                  setInterestPhoneForm((current) => ({
                                    ...current,
                                    last_name: inputEvent.target.value
                                  }))
                                }
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              />
                            </label>
                          </div>

                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleAddManualInterestRecipientByPhone}
                            loading={isAddingInterestPhoneRecipient}
                            disabled={isAddingInterestPhoneRecipient || !interestPhoneForm.phone.trim()}
                          >
                            Add by phone
                          </Button>
                        </div>

                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                          Find customer
                          <input
                            type="text"
                            value={interestCustomerQuery}
                            onChange={(inputEvent) => {
                              setSelectedInterestCustomer(null)
                              setInterestCustomerQuery(inputEvent.target.value)
                            }}
                            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            placeholder="Search by name or phone"
                          />
                        </label>

                        {searchingInterestCustomers && (
                          <p className="text-xs text-gray-500">Searching customers…</p>
                        )}

                        {!selectedInterestCustomer && interestCustomerResults.length > 0 && (
                          <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-gray-200 bg-white p-1">
                            {interestCustomerResults.map((customer) => (
                              <button
                                key={customer.id}
                                type="button"
                                onClick={() => {
                                  setSelectedInterestCustomer(customer)
                                  setInterestCustomerQuery(customer.full_name)
                                  setInterestCustomerResults([])
                                }}
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100"
                              >
                                <p className="font-medium text-gray-900">{customer.full_name}</p>
                                <p className="text-gray-500">{customer.display_phone || 'No phone number saved'}</p>
                              </button>
                            ))}
                          </div>
                        )}

                        {selectedInterestCustomer && (
                          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Selected customer</p>
                                <p className="text-sm font-medium text-blue-900">{selectedInterestCustomer.full_name}</p>
                                <p className="text-xs text-blue-800">
                                  {selectedInterestCustomer.display_phone || 'No phone number saved'}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="xs"
                                variant="secondary"
                                onClick={() => {
                                  setSelectedInterestCustomer(null)
                                  setInterestCustomerQuery('')
                                  setInterestCustomerResults([])
                                }}
                              >
                                Change
                              </Button>
                            </div>
                          </div>
                        )}

                        <Button
                          variant="primary"
                          onClick={handleAddManualInterestRecipient}
                          disabled={!selectedInterestCustomer || isAddingInterestRecipient}
                          loading={isAddingInterestRecipient}
                        >
                          Add to audience
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">You need event manage permission to edit this audience.</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">Manual recipients</h3>
                    {interestAudience.manual_recipients.length === 0 ? (
                      <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-600">
                        No manual recipients added yet.
                      </div>
                    ) : (
                      <div className="max-h-60 overflow-auto rounded-md border border-gray-200">
                        <ul className="divide-y divide-gray-100 bg-white">
                          {interestAudience.manual_recipients.map((recipient) => (
                            <li key={recipient.customer_id} className="flex items-center justify-between gap-3 px-3 py-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">{recipient.full_name}</p>
                                <p className="text-xs text-gray-500">{recipient.display_phone || 'No phone number saved'}</p>
                                <p className="text-xs text-gray-500">Added {formatCreatedAt(recipient.added_at)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={recipient.sms_eligible_for_marketing ? 'success' : 'error'}
                                  size="sm"
                                >
                                  {recipient.sms_eligible_for_marketing ? 'Eligible' : 'Ineligible'}
                                </Badge>
                                {canManageEvents && (
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => handleRemoveManualInterestRecipient(recipient.customer_id)}
                                    loading={removingInterestCustomerId === recipient.customer_id}
                                    disabled={removingInterestCustomerId === recipient.customer_id}
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">Past behavior candidates</h3>
                  {interestAudience.behavior_candidates.length === 0 ? (
                    <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-600">
                      No same-type history for this event yet.
                      {interestAudience.reminder_picker_candidates.length > 0
                        ? ` Use “Pick from past guests” above to add from other events (${interestAudience.reminder_picker_candidates.length} found).`
                        : ''}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-gray-200">
                      <div className="max-h-72 overflow-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Guest
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Last seen
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Status
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {interestAudience.behavior_candidates.slice(0, 80).map((candidate) => (
                              <tr key={candidate.customer_id}>
                                <td className="px-3 py-2 align-top">
                                  <p className="text-sm font-medium text-gray-900">{candidate.full_name}</p>
                                  <p className="text-xs text-gray-500">{candidate.display_phone || 'No phone number saved'}</p>
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-600">
                                  {candidate.last_engaged_at ? formatCreatedAt(candidate.last_engaged_at) : 'Unknown'}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    <Badge
                                      variant={candidate.sms_eligible_for_marketing ? 'success' : 'error'}
                                      size="sm"
                                    >
                                      {candidate.sms_eligible_for_marketing ? 'Eligible' : 'Ineligible'}
                                    </Badge>
                                    {candidate.is_currently_booked && (
                                      <Badge variant="warning" size="sm">
                                        Already booked
                                      </Badge>
                                    )}
                                    {candidate.manually_added && (
                                      <Badge variant="info" size="sm">
                                        Manually added
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
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
