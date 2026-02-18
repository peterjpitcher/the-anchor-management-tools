'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'
import type { Customer, Message } from '@/types/database'
import { toggleCustomerSmsOptIn, getCustomerMessages, getCustomerSmsStats } from '@/app/actions/customerSmsActions'
import { markMessagesAsRead } from '@/app/actions/messageActions'
import { updateCustomer as updateCustomerAction } from '@/app/actions/customers'
import { getCustomerLabelAssignments, getCustomerLabels, type CustomerLabel, type CustomerLabelAssignment } from '@/app/actions/customer-labels'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardDescription, CardTitle } from '@/components/ui-v2/layout/Card'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Button } from '@/components/ui-v2/forms/Button'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { MessageThread } from '@/components/features/messages/MessageThread'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import { CustomerLabelSelector } from '@/components/features/customers/CustomerLabelSelector'

export const dynamic = 'force-dynamic'
const CUSTOMER_DETAIL_SELECT = `
  id,
  first_name,
  last_name,
  email,
  mobile_number,
  created_at,
  sms_opt_in,
  sms_delivery_failures,
  last_sms_failure_reason,
  last_successful_sms_at,
  sms_deactivated_at,
  sms_deactivation_reason
`

type BookingSource = 'event' | 'table' | 'private' | 'parking'

type CustomerTableBooking = {
  id: string
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  source: string | null
  created_at: string | null
}

type CustomerEventBooking = {
  id: string
  event_id: string | null
  seats: number | null
  is_reminder_only: boolean | null
  created_at: string | null
  notes: string | null
  event: {
    id: string
    name: string
    date: string | null
    time: string | null
    event_status: string | null
    category: {
      id: string
      name: string
    } | null
  } | null
}

type CustomerPrivateBooking = {
  id: string
  event_date: string | null
  start_time: string | null
  status: string | null
  event_type: string | null
  guest_count: number | null
  total_amount: number | null
  deposit_amount: number | null
  source: string | null
  created_at: string | null
}

type CustomerParkingBooking = {
  id: string
  reference: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
  payment_status: string | null
  vehicle_registration: string | null
  created_at: string | null
}

type CustomerCategoryPreference = {
  category_id: string
  category_name: string
  times_attended: number
  first_attended_date: string | null
  last_attended_date: string | null
}

type UnifiedCustomerBookingRow = {
  key: string
  id: string
  source: BookingSource
  source_label: string
  title: string
  reference: string | null
  status: string
  interest: string
  party_size: number | null
  amount: number | null
  booking_datetime: string | null
  booking_timestamp: number
  booking_display: string
  summary: string
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatLabel(value: string | null | undefined, fallback = 'Unknown'): string {
  if (!value) return fallback
  return toTitleCase(value)
}

function toDateTimeIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null
  if (time) {
    return `${date}T${time}`
  }
  return `${date}T00:00:00`
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatLondonDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown time'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatDateTimeWithFallback(
  isoValue: string | null | undefined,
  fallbackDate?: string | null,
  fallbackTime?: string | null
): string {
  if (isoValue) {
    return formatLondonDateTime(isoValue)
  }
  if (fallbackDate || fallbackTime) {
    return [fallbackDate || 'Unknown date', fallbackTime || 'Unknown time'].join(' ')
  }
  return 'Unknown time'
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0
  }).format(value)
}

function formatDateForMetric(value: string | null | undefined): string {
  if (!value) return 'N/A'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value))
  } catch {
    return value
  }
}

export default function CustomerViewPage() {
  const params = useParams<{ id: string }>()
  const customerId = params.id
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()

  const canViewMessages = hasPermission('messages', 'view')
  const canManageCustomers = hasPermission('customers', 'manage')

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [togglingSmsSetting, setTogglingSmsSetting] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [tableBookings, setTableBookings] = useState<CustomerTableBooking[]>([])
  const [eventBookings, setEventBookings] = useState<CustomerEventBooking[]>([])
  const [privateBookings, setPrivateBookings] = useState<CustomerPrivateBooking[]>([])
  const [parkingBookings, setParkingBookings] = useState<CustomerParkingBooking[]>([])
  const [categoryPreferences, setCategoryPreferences] = useState<CustomerCategoryPreference[]>([])
  const [smsStats, setSmsStats] = useState<{
    customer: {
      sms_opt_in: boolean
      sms_delivery_failures: number
      last_sms_failure_reason: string | null
      last_successful_sms_at: string | null
      sms_deactivated_at: string | null
      sms_deactivation_reason: string | null
    }
    stats: {
      totalMessages: number
      deliveredMessages: number
      failedMessages: number
      deliveryRate: string
    }
  } | null>(null)

  const [availableLabels, setAvailableLabels] = useState<CustomerLabel[]>([])
  const [customerLabelAssignments, setCustomerLabelAssignments] = useState<CustomerLabelAssignment[]>([])
  const [isEditingCustomer, setIsEditingCustomer] = useState(false)
  const [bookingSearch, setBookingSearch] = useState('')
  const [bookingTypeFilter, setBookingTypeFilter] = useState<BookingSource | 'all'>('all')
  const [bookingStatusFilter, setBookingStatusFilter] = useState('all')
  const [bookingInterestFilter, setBookingInterestFilter] = useState('all')
  const [bookingTimeFilter, setBookingTimeFilter] = useState<'all' | 'upcoming' | 'past'>('all')

  const loadMessages = useCallback(async () => {
    if (!customerId) return

    setMessagesLoading(true)
    try {
      const messagesResult = await getCustomerMessages(customerId)
      if ('error' in messagesResult) {
        console.error('Failed to load messages:', messagesResult.error)
        toast.error('Failed to load messages')
        return
      }

      setMessages(messagesResult.messages)

      if (canViewMessages) {
        const hasUnreadInbound = messagesResult.messages.some(
          (message) => message.direction === 'inbound' && !message.read_at
        )
        if (hasUnreadInbound) {
          await markMessagesAsRead(customerId)
        }
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      setMessagesLoading(false)
    }
  }, [canViewMessages, customerId])

  const loadData = useCallback(async () => {
    if (!customerId) return

    setLoading(true)
    try {
      const [
        { data: customerData, error: customerError },
        { data: customerTableBookings, error: tableBookingsError },
        { data: customerEventBookings, error: eventBookingsError },
        { data: customerPrivateBookings, error: privateBookingsError },
        { data: customerParkingBookings, error: parkingBookingsError },
        { data: customerCategoryStats, error: categoryStatsError },
        smsStatsResult,
        customerLabelsResult,
        customerAssignmentsResult,
      ] = await Promise.all([
        supabase
          .from('customers')
          .select(CUSTOMER_DETAIL_SELECT)
          .eq('id', customerId)
          .single(),
        (supabase.from('table_bookings') as any)
          .select(
            'id, booking_reference, booking_date, booking_time, start_datetime, party_size, booking_type, booking_purpose, status, source, created_at'
          )
          .eq('customer_id', customerId)
          .order('start_datetime', { ascending: false, nullsFirst: false })
          .order('booking_date', { ascending: false })
          .order('booking_time', { ascending: false }),
        (supabase.from('bookings') as any)
          .select(`
            id,
            event_id,
            seats,
            is_reminder_only,
            created_at,
            notes,
            event:events(
              id,
              name,
              date,
              time,
              event_status,
              category:event_categories(
                id,
                name
              )
            )
          `)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
        (supabase.from('private_bookings') as any)
          .select(
            'id, event_date, start_time, status, event_type, guest_count, total_amount, deposit_amount, source, created_at'
          )
          .eq('customer_id', customerId)
          .order('event_date', { ascending: false })
          .order('start_time', { ascending: false }),
        (supabase.from('parking_bookings') as any)
          .select(
            'id, reference, start_at, end_at, status, payment_status, vehicle_registration, created_at'
          )
          .eq('customer_id', customerId)
          .order('start_at', { ascending: false }),
        (supabase.from('customer_category_stats') as any)
          .select(`
            category_id,
            times_attended,
            first_attended_date,
            last_attended_date,
            event_category:event_categories(
              id,
              name
            )
          `)
          .eq('customer_id', customerId)
          .order('times_attended', { ascending: false }),
        getCustomerSmsStats(customerId),
        getCustomerLabels(),
        getCustomerLabelAssignments(customerId),
      ])

      if (customerError) {
        throw customerError
      }
      if (!customerData) {
        throw new Error('Customer not found')
      }
      setCustomer(customerData)

      if (tableBookingsError) {
        console.error('Failed to load customer table bookings:', tableBookingsError)
        setTableBookings([])
      } else {
        const rows = Array.isArray(customerTableBookings) ? customerTableBookings : []
        setTableBookings(
          rows.map((row: any) => ({
            id: row.id,
            booking_reference: row.booking_reference || null,
            booking_date: row.booking_date || null,
            booking_time: row.booking_time || null,
            start_datetime: row.start_datetime || null,
            party_size: row.party_size ?? null,
            booking_type: row.booking_type || null,
            booking_purpose: row.booking_purpose || null,
            status: row.status || null,
            source: row.source || null,
            created_at: row.created_at || null
          }))
        )
      }

      if (eventBookingsError) {
        console.error('Failed to load customer event bookings:', eventBookingsError)
        setEventBookings([])
      } else {
        const rows = Array.isArray(customerEventBookings) ? customerEventBookings : []
        setEventBookings(
          rows.map((row: any) => {
            const rawEvent = Array.isArray(row.event) ? row.event[0] : row.event
            const rawCategory = rawEvent?.category
            const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory
            return {
              id: row.id,
              event_id: row.event_id || null,
              seats: row.seats ?? null,
              is_reminder_only: row.is_reminder_only ?? null,
              created_at: row.created_at || null,
              notes: row.notes || null,
              event: rawEvent
                ? {
                    id: rawEvent.id,
                    name: rawEvent.name,
                    date: rawEvent.date || null,
                    time: rawEvent.time || null,
                    event_status: rawEvent.event_status || null,
                    category: category
                      ? {
                          id: category.id,
                          name: category.name
                        }
                      : null
                  }
                : null
            }
          })
        )
      }

      if (privateBookingsError) {
        console.error('Failed to load customer private bookings:', privateBookingsError)
        setPrivateBookings([])
      } else {
        const rows = Array.isArray(customerPrivateBookings) ? customerPrivateBookings : []
        setPrivateBookings(
          rows.map((row: any) => ({
            id: row.id,
            event_date: row.event_date || null,
            start_time: row.start_time || null,
            status: row.status || null,
            event_type: row.event_type || null,
            guest_count: row.guest_count ?? null,
            total_amount: row.total_amount ?? null,
            deposit_amount: row.deposit_amount ?? null,
            source: row.source || null,
            created_at: row.created_at || null
          }))
        )
      }

      if (parkingBookingsError) {
        console.error('Failed to load customer parking bookings:', parkingBookingsError)
        setParkingBookings([])
      } else {
        const rows = Array.isArray(customerParkingBookings) ? customerParkingBookings : []
        setParkingBookings(
          rows.map((row: any) => ({
            id: row.id,
            reference: row.reference || null,
            start_at: row.start_at || null,
            end_at: row.end_at || null,
            status: row.status || null,
            payment_status: row.payment_status || null,
            vehicle_registration: row.vehicle_registration || null,
            created_at: row.created_at || null
          }))
        )
      }

      if (categoryStatsError) {
        console.error('Failed to load customer category preferences:', categoryStatsError)
        setCategoryPreferences([])
      } else {
        const rows = Array.isArray(customerCategoryStats) ? customerCategoryStats : []
        setCategoryPreferences(
          rows.map((row: any) => {
            const rawCategory = row.event_category
            const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory
            return {
              category_id: row.category_id,
              category_name: category?.name || 'Uncategorised',
              times_attended: row.times_attended ?? 0,
              first_attended_date: row.first_attended_date || null,
              last_attended_date: row.last_attended_date || null
            }
          })
        )
      }

      if ('error' in smsStatsResult) {
        console.error('Failed to load SMS stats:', smsStatsResult.error)
      } else {
        setSmsStats(smsStatsResult)
      }

      if (customerLabelsResult.data) {
        setAvailableLabels(customerLabelsResult.data)
      } else if (customerLabelsResult.error) {
        console.error('Failed to load customer labels:', customerLabelsResult.error)
        setAvailableLabels([])
      }

      if (customerAssignmentsResult.data) {
        setCustomerLabelAssignments(customerAssignmentsResult.data)
      } else if (customerAssignmentsResult.error) {
        console.error('Failed to load customer label assignments:', customerAssignmentsResult.error)
        setCustomerLabelAssignments([])
      }

      await loadMessages()
    } catch (error) {
      console.error('Error loading customer details:', error)
      toast.error('Failed to load customer details.')
    } finally {
      setLoading(false)
    }
  }, [customerId, loadMessages, supabase])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleToggleSms = async () => {
    if (!customer) return

    setTogglingSmsSetting(true)
    const newOptIn = customer.sms_opt_in === false
    const result = await toggleCustomerSmsOptIn(customer.id, newOptIn)

    if ('error' in result) {
      toast.error(`Failed to update SMS settings: ${result.error}`)
      setTogglingSmsSetting(false)
      return
    }

    toast.success(`SMS ${newOptIn ? 'activated' : 'deactivated'} for customer`)
    setCustomer({ ...customer, sms_opt_in: newOptIn })

    const stats = await getCustomerSmsStats(customer.id)
    if (!('error' in stats)) {
      setSmsStats(stats)
    }

    setTogglingSmsSetting(false)
  }

  const handleUpdateCustomer = async (data: Omit<Customer, 'id' | 'created_at'>) => {
    if (!customer) return

    try {
      const formData = new FormData()
      formData.append('first_name', data.first_name)
      if (data.last_name) formData.append('last_name', data.last_name)
      if (data.email) formData.append('email', data.email)
      if (data.mobile_number) formData.append('mobile_number', data.mobile_number)
      if (customer.sms_opt_in) formData.append('sms_opt_in', 'on')

      const result = await updateCustomerAction(customer.id, formData)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Customer updated successfully')
      setIsEditingCustomer(false)
      await loadData()
    } catch (error) {
      console.error('Error updating customer:', error)
      toast.error('Failed to update customer')
    }
  }

  const unifiedBookings = useMemo<UnifiedCustomerBookingRow[]>(() => {
    const rows: UnifiedCustomerBookingRow[] = []

    tableBookings.forEach((booking) => {
      const bookingDateTime = booking.start_datetime || toDateTimeIso(booking.booking_date, booking.booking_time)
      const bookingTimestamp = toTimestamp(bookingDateTime || booking.created_at)
      rows.push({
        key: `table-${booking.id}`,
        id: booking.id,
        source: 'table',
        source_label: 'Table',
        title: formatLabel(booking.booking_type, 'Table Booking'),
        reference: booking.booking_reference || booking.id.slice(0, 8).toUpperCase(),
        status: formatLabel(booking.status, 'Unknown'),
        interest: formatLabel(booking.booking_purpose || booking.booking_type, 'Dining'),
        party_size: booking.party_size ?? null,
        amount: null,
        booking_datetime: bookingDateTime,
        booking_timestamp: bookingTimestamp,
        booking_display: formatDateTimeWithFallback(bookingDateTime, booking.booking_date, booking.booking_time),
        summary: [
          formatLabel(booking.booking_purpose, 'No purpose set'),
          formatLabel(booking.source, 'Internal')
        ].join(' · ')
      })
    })

    eventBookings.forEach((booking) => {
      const bookingDateTime = toDateTimeIso(booking.event?.date, booking.event?.time)
      const bookingTimestamp = toTimestamp(bookingDateTime || booking.created_at)
      const reminderOnly = booking.is_reminder_only || (booking.seats ?? 0) <= 0
      rows.push({
        key: `event-${booking.id}`,
        id: booking.id,
        source: 'event',
        source_label: 'Event',
        title: booking.event?.name || 'Event Booking',
        reference: booking.event?.id ? booking.event.id.slice(0, 8).toUpperCase() : booking.id.slice(0, 8).toUpperCase(),
        status: reminderOnly ? 'Reminder Only' : 'Booked',
        interest: booking.event?.category?.name || 'Live Event',
        party_size: booking.seats ?? null,
        amount: null,
        booking_datetime: bookingDateTime,
        booking_timestamp: bookingTimestamp,
        booking_display: formatDateTimeWithFallback(bookingDateTime, booking.event?.date, booking.event?.time),
        summary: [
          `${booking.seats ?? 0} seat${(booking.seats ?? 0) === 1 ? '' : 's'}`,
          booking.event?.event_status ? `Event ${formatLabel(booking.event.event_status)}` : null
        ]
          .filter(Boolean)
          .join(' · ')
      })
    })

    privateBookings.forEach((booking) => {
      const bookingDateTime = toDateTimeIso(booking.event_date, booking.start_time)
      const bookingTimestamp = toTimestamp(bookingDateTime || booking.created_at)
      rows.push({
        key: `private-${booking.id}`,
        id: booking.id,
        source: 'private',
        source_label: 'Private',
        title: formatLabel(booking.event_type, 'Private Booking'),
        reference: booking.id.slice(0, 8).toUpperCase(),
        status: formatLabel(booking.status, 'Unknown'),
        interest: formatLabel(booking.event_type, 'Private Event'),
        party_size: booking.guest_count ?? null,
        amount: booking.total_amount ?? null,
        booking_datetime: bookingDateTime,
        booking_timestamp: bookingTimestamp,
        booking_display: formatDateTimeWithFallback(bookingDateTime, booking.event_date, booking.start_time),
        summary: [
          `${booking.guest_count ?? 0} guest${(booking.guest_count ?? 0) === 1 ? '' : 's'}`,
          booking.source ? `Source ${formatLabel(booking.source)}` : null
        ]
          .filter(Boolean)
          .join(' · ')
      })
    })

    parkingBookings.forEach((booking) => {
      const bookingTimestamp = toTimestamp(booking.start_at || booking.created_at)
      rows.push({
        key: `parking-${booking.id}`,
        id: booking.id,
        source: 'parking',
        source_label: 'Parking',
        title: booking.vehicle_registration ? `Parking ${booking.vehicle_registration}` : 'Parking Booking',
        reference: booking.reference || booking.id.slice(0, 8).toUpperCase(),
        status: booking.payment_status
          ? `${formatLabel(booking.status, 'Unknown')} / ${formatLabel(booking.payment_status)}`
          : formatLabel(booking.status, 'Unknown'),
        interest: 'Parking',
        party_size: null,
        amount: null,
        booking_datetime: booking.start_at,
        booking_timestamp: bookingTimestamp,
        booking_display: formatDateTimeWithFallback(booking.start_at),
        summary: booking.end_at ? `Ends ${formatLondonDateTime(booking.end_at)}` : 'No end time'
      })
    })

    return rows.sort((a, b) => b.booking_timestamp - a.booking_timestamp)
  }, [eventBookings, parkingBookings, privateBookings, tableBookings])

  const bookingStatusOptions = useMemo(
    () => Array.from(new Set(unifiedBookings.map((booking) => booking.status))).sort((a, b) => a.localeCompare(b)),
    [unifiedBookings]
  )

  const bookingInterestOptions = useMemo(
    () => Array.from(new Set(unifiedBookings.map((booking) => booking.interest))).sort((a, b) => a.localeCompare(b)),
    [unifiedBookings]
  )

  const filteredBookings = useMemo(() => {
    const now = Date.now()
    const searchValue = bookingSearch.trim().toLowerCase()

    return unifiedBookings.filter((booking) => {
      if (bookingTypeFilter !== 'all' && booking.source !== bookingTypeFilter) {
        return false
      }

      if (bookingStatusFilter !== 'all' && booking.status !== bookingStatusFilter) {
        return false
      }

      if (bookingInterestFilter !== 'all' && booking.interest !== bookingInterestFilter) {
        return false
      }

      if (bookingTimeFilter === 'upcoming') {
        if (!booking.booking_timestamp || booking.booking_timestamp < now) return false
      }

      if (bookingTimeFilter === 'past') {
        if (!booking.booking_timestamp || booking.booking_timestamp >= now) return false
      }

      if (!searchValue) return true

      const searchableText = [
        booking.title,
        booking.reference,
        booking.status,
        booking.interest,
        booking.summary
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return searchableText.includes(searchValue)
    })
  }, [
    bookingInterestFilter,
    bookingSearch,
    bookingStatusFilter,
    bookingTimeFilter,
    bookingTypeFilter,
    unifiedBookings
  ])

  const bookingInsights = useMemo(() => {
    const sourceCounts: Record<BookingSource, number> = {
      event: 0,
      table: 0,
      private: 0,
      parking: 0
    }

    const statusCounts = new Map<string, number>()
    const interestCounts = new Map<string, number>()
    const datedBookings = unifiedBookings.filter((booking) => booking.booking_timestamp > 0)

    for (const booking of unifiedBookings) {
      sourceCounts[booking.source] += 1
      statusCounts.set(booking.status, (statusCounts.get(booking.status) || 0) + 1)
      interestCounts.set(booking.interest, (interestCounts.get(booking.interest) || 0) + 1)
    }

    const partySizes = unifiedBookings
      .map((booking) => booking.party_size)
      .filter((value): value is number => typeof value === 'number' && value > 0)
    const averagePartySize = partySizes.length > 0
      ? partySizes.reduce((sum, value) => sum + value, 0) / partySizes.length
      : null

    const totalEventSeats = eventBookings.reduce((sum, booking) => {
      const seats = booking.seats ?? 0
      if (booking.is_reminder_only || seats <= 0) return sum
      return sum + seats
    }, 0)

    const reminderOnlyEvents = eventBookings.filter((booking) => booking.is_reminder_only || (booking.seats ?? 0) <= 0).length
    const totalPrivateValue = privateBookings.reduce((sum, booking) => sum + (booking.total_amount ?? 0), 0)

    const topTablePurposeMap = new Map<string, number>()
    tableBookings.forEach((booking) => {
      const key = formatLabel(booking.booking_purpose || booking.booking_type, 'Dining')
      topTablePurposeMap.set(key, (topTablePurposeMap.get(key) || 0) + 1)
    })
    const topTablePurpose = Array.from(topTablePurposeMap.entries()).sort((a, b) => b[1] - a[1])[0] || null

    const topInterest = Array.from(interestCounts.entries()).sort((a, b) => b[1] - a[1])[0] || null
    const statusMix = Array.from(statusCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)

    const bookingDayMap = new Map<string, number>()
    datedBookings.forEach((booking) => {
      const day = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'long'
      }).format(new Date(booking.booking_timestamp))
      bookingDayMap.set(day, (bookingDayMap.get(day) || 0) + 1)
    })
    const preferredDay = Array.from(bookingDayMap.entries()).sort((a, b) => b[1] - a[1])[0] || null

    const now = Date.now()
    const upcomingCount = datedBookings.filter((booking) => booking.booking_timestamp >= now).length
    const firstBooking = datedBookings.length > 0 ? datedBookings.reduce((min, booking) =>
      booking.booking_timestamp < min.booking_timestamp ? booking : min
    ) : null
    const latestBooking = datedBookings.length > 0 ? datedBookings.reduce((max, booking) =>
      booking.booking_timestamp > max.booking_timestamp ? booking : max
    ) : null

    const disruptedBookings = unifiedBookings.filter((booking) =>
      /(cancel|no show|expired|failed|rejected)/i.test(booking.status)
    ).length

    return {
      sourceCounts,
      totalBookings: unifiedBookings.length,
      upcomingCount,
      firstBooking,
      latestBooking,
      averagePartySize,
      totalEventSeats,
      reminderOnlyEvents,
      totalPrivateValue,
      topCategory: categoryPreferences[0] || null,
      topTablePurpose,
      topInterest,
      preferredDay,
      disruptedBookings,
      statusMix
    }
  }, [categoryPreferences, eventBookings, privateBookings, tableBookings, unifiedBookings])

  const topCategoryPreferences = useMemo(() => categoryPreferences.slice(0, 6), [categoryPreferences])

  const maxCategoryAttendance = useMemo(
    () => Math.max(...topCategoryPreferences.map((pref) => pref.times_attended), 1),
    [topCategoryPreferences]
  )

  const bookingColumns = useMemo(() => [
    {
      key: 'booking_display',
      header: 'When',
      sortable: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => a.booking_timestamp - b.booking_timestamp,
      cell: (booking: UnifiedCustomerBookingRow) => (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-900">{booking.booking_display}</p>
          <p className="text-xs text-gray-500">{booking.reference ? `Ref ${booking.reference}` : 'No reference'}</p>
        </div>
      )
    },
    {
      key: 'source_label',
      header: 'Type',
      sortable: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => a.source_label.localeCompare(b.source_label),
      cell: (booking: UnifiedCustomerBookingRow) => (
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {booking.source_label}
        </span>
      )
    },
    {
      key: 'title',
      header: 'Booking',
      sortable: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => a.title.localeCompare(b.title),
      cell: (booking: UnifiedCustomerBookingRow) => (
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-900">{booking.title}</p>
          <p className="text-xs text-gray-500">{booking.summary}</p>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => a.status.localeCompare(b.status),
      cell: (booking: UnifiedCustomerBookingRow) => {
        const isProblem = /(cancel|no show|expired|failed|rejected)/i.test(booking.status)
        const isHealthy = /(booked|confirmed|completed|active|paid)/i.test(booking.status)
        const statusClass = isProblem
          ? 'border-red-200 bg-red-50 text-red-700'
          : isHealthy
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-gray-200 bg-gray-50 text-gray-700'

        return (
          <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
            {booking.status}
          </span>
        )
      }
    },
    {
      key: 'interest',
      header: 'Interest',
      sortable: true,
      hideOnMobile: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => a.interest.localeCompare(b.interest),
      cell: (booking: UnifiedCustomerBookingRow) => <span className="text-sm text-gray-700">{booking.interest}</span>
    },
    {
      key: 'party_size',
      header: 'Party',
      sortable: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => (a.party_size ?? 0) - (b.party_size ?? 0),
      cell: (booking: UnifiedCustomerBookingRow) => (
        <span className="text-sm text-gray-700">{booking.party_size ?? '-'}</span>
      )
    },
    {
      key: 'amount',
      header: 'Value',
      sortable: true,
      hideOnMobile: true,
      sortFn: (a: UnifiedCustomerBookingRow, b: UnifiedCustomerBookingRow) => (a.amount ?? 0) - (b.amount ?? 0),
      cell: (booking: UnifiedCustomerBookingRow) => (
        <span className="text-sm text-gray-700">{booking.amount != null ? formatCurrency(booking.amount) : '-'}</span>
      )
    }
  ], [])

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

  const customerName = `${customer.first_name} ${customer.last_name || ''}`.trim()

  const navActions = (
    <NavGroup>
      {canManageCustomers && (
        <NavLink onClick={() => setIsEditingCustomer(true)}>
          Edit Details
        </NavLink>
      )}
    </NavGroup>
  )

  return (
    <PageLayout
      title={customerName}
      subtitle={customer.mobile_number || 'No mobile number'}
      backButton={{ label: 'Back to Customers', href: '/customers' }}
      navActions={navActions}
    >
      <div className="space-y-6">
        <Modal
          open={isEditingCustomer}
          onClose={() => setIsEditingCustomer(false)}
          title="Edit Customer Details"
        >
          <CustomerForm
            customer={customer}
            onSubmit={handleUpdateCustomer}
            onCancel={() => setIsEditingCustomer(false)}
          />
        </Modal>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card
            className="xl:col-span-2"
            header={
              <div className="flex items-center justify-between">
                <CardTitle>Messages</CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadMessages}
                  disabled={messagesLoading}
                >
                  {messagesLoading ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            }
          >
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

          <div className="space-y-6">
            <Card>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-gray-400" />
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

            {hasPermission('customers', 'manage') && (
              <Card header={<CardTitle>Customer Labels</CardTitle>}>
                <CustomerLabelSelector
                  customerId={customer.id}
                  canEdit
                  initialLabels={availableLabels}
                  initialAssignments={customerLabelAssignments}
                  onLabelsChange={(updatedAssignments) => {
                    setCustomerLabelAssignments(updatedAssignments)
                  }}
                />
              </Card>
            )}

            <Card
              header={
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Booking Snapshot</CardTitle>
                    <CardDescription>Quick totals across all booking types.</CardDescription>
                  </div>
                  <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
                    {bookingInsights.totalBookings}
                  </span>
                </div>
              }
            >
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span>Event bookings</span>
                  <span className="font-medium">{bookingInsights.sourceCounts.event}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Table bookings</span>
                  <span className="font-medium">{bookingInsights.sourceCounts.table}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Private bookings</span>
                  <span className="font-medium">{bookingInsights.sourceCounts.private}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Parking bookings</span>
                  <span className="font-medium">{bookingInsights.sourceCounts.parking}</span>
                </div>
              </div>
            </Card>

            <Card
              header={
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>SMS Messaging Status</CardTitle>
                    <CardDescription>
                      Control whether this customer receives SMS notifications and replies.
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
                <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </div>

        <Card
          header={
            <div>
              <CardTitle>Guest Profile Insights</CardTitle>
              <CardDescription>
                Booking patterns and preferences pulled from event, table, private, and parking data.
              </CardDescription>
            </div>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Total bookings</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{bookingInsights.totalBookings}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Upcoming bookings</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{bookingInsights.upcomingCount}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Average party size</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {bookingInsights.averagePartySize != null ? bookingInsights.averagePartySize.toFixed(1) : 'N/A'}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Private booking value</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {bookingInsights.totalPrivateValue > 0 ? formatCurrency(bookingInsights.totalPrivateValue) : 'N/A'}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Event seats booked</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{bookingInsights.totalEventSeats}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Reminder-only events</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{bookingInsights.reminderOnlyEvents}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">First booking</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatDateForMetric(bookingInsights.firstBooking?.booking_datetime)}
              </p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Most recent booking</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatDateForMetric(bookingInsights.latestBooking?.booking_datetime)}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Behavior Signals</h4>
              <div className="mt-3 space-y-2 text-sm text-gray-700">
                <p>
                  Favorite category:{' '}
                  <span className="font-medium">
                    {bookingInsights.topCategory
                      ? `${bookingInsights.topCategory.category_name} (${bookingInsights.topCategory.times_attended})`
                      : 'No attendance data'}
                  </span>
                </p>
                <p>
                  Top interest:{' '}
                  <span className="font-medium">
                    {bookingInsights.topInterest
                      ? `${bookingInsights.topInterest[0]} (${bookingInsights.topInterest[1]})`
                      : 'N/A'}
                  </span>
                </p>
                <p>
                  Preferred table purpose:{' '}
                  <span className="font-medium">
                    {bookingInsights.topTablePurpose
                      ? `${bookingInsights.topTablePurpose[0]} (${bookingInsights.topTablePurpose[1]})`
                      : 'N/A'}
                  </span>
                </p>
                <p>
                  Preferred booking day:{' '}
                  <span className="font-medium">
                    {bookingInsights.preferredDay
                      ? `${bookingInsights.preferredDay[0]} (${bookingInsights.preferredDay[1]})`
                      : 'N/A'}
                  </span>
                </p>
                <p>
                  Disrupted bookings:{' '}
                  <span className="font-medium">{bookingInsights.disruptedBookings}</span>
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900">Event Category Preferences</h4>
              {topCategoryPreferences.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No event attendance preferences available yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {topCategoryPreferences.map((preference) => (
                    <div key={preference.category_id}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                        <span>{preference.category_name}</span>
                        <span>{preference.times_attended}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200">
                        <div
                          className="h-2 rounded-full bg-green-500"
                          style={{
                            width: `${Math.max((preference.times_attended / maxCategoryAttendance) * 100, 6)}%`
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900">Booking Status Mix</h4>
              {bookingInsights.statusMix.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No booking statuses available yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {bookingInsights.statusMix.map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm text-gray-700">
                      <span>{status}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card
          header={
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>All Bookings</CardTitle>
                <CardDescription>
                  Filter and sort every booking tied to this customer to understand what they attend most.
                </CardDescription>
              </div>
              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {filteredBookings.length} of {unifiedBookings.length}
              </span>
            </div>
          }
        >
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SearchInput
              value={bookingSearch}
              onSearch={setBookingSearch}
              placeholder="Search booking type, status, reference..."
              debounceDelay={150}
            />

            <select
              value={bookingTypeFilter}
              onChange={(event) => setBookingTypeFilter(event.target.value as BookingSource | 'all')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="all">All booking types</option>
              <option value="event">Event bookings</option>
              <option value="table">Table bookings</option>
              <option value="private">Private bookings</option>
              <option value="parking">Parking bookings</option>
            </select>

            <select
              value={bookingTimeFilter}
              onChange={(event) => setBookingTimeFilter(event.target.value as 'all' | 'upcoming' | 'past')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="all">All time</option>
              <option value="upcoming">Upcoming only</option>
              <option value="past">Past only</option>
            </select>

            <select
              value={bookingStatusFilter}
              onChange={(event) => setBookingStatusFilter(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="all">All statuses</option>
              {bookingStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              value={bookingInterestFilter}
              onChange={(event) => setBookingInterestFilter(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
            >
              <option value="all">All interests</option>
              {bookingInterestOptions.map((interest) => (
                <option key={interest} value={interest}>
                  {interest}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            data={filteredBookings}
            columns={bookingColumns}
            getRowKey={(booking) => booking.key}
            emptyMessage={unifiedBookings.length === 0 ? 'No bookings found' : 'No bookings match your filters'}
            emptyDescription={
              unifiedBookings.length === 0
                ? 'This customer has not made a booking yet.'
                : 'Try clearing one or more filters.'
            }
          />
        </Card>
      </div>
    </PageLayout>
  )
}
