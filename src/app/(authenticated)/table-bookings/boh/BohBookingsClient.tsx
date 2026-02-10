'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import toast from 'react-hot-toast'

type BohViewMode = 'day' | 'week' | 'month'
type StatusFilter =
  | 'all'
  | 'confirmed'
  | 'pending_card_capture'
  | 'seated'
  | 'left'
  | 'no_show'
  | 'cancelled'
  | 'completed'
  | 'visited_waiting_for_review'
  | 'review_clicked'

type SortColumn = 'datetime' | 'guest' | 'reference' | 'party_size' | 'tables' | 'status' | 'phone'
type SortDirection = 'asc' | 'desc'

type BohTable = {
  id: string
  name: string
  table_number: string | null
  capacity: number | null
  area_id: string | null
  area: string | null
  is_bookable: boolean
}

type BohBooking = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string
  party_size: number | null
  committed_party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string | null
  visual_status: string
  special_requirements: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  hold_expires_at: string | null
  created_at: string | null
  updated_at: string | null
  customer: {
    id: string | null
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
  guest_name: string | null
  event_id: string | null
  event_name: string | null
  assigned_tables: Array<{
    id: string
    name: string
    table_number: string | null
    capacity: number | null
    area_id: string | null
    area: string | null
    is_bookable: boolean
    start_datetime: string | null
    end_datetime: string | null
  }>
  table_names: string[]
  assignment_count: number
  start_datetime: string | null
  end_datetime: string | null
}

type BohBookingsResponse = {
  success?: boolean
  error?: string
  data?: {
    view: BohViewMode
    focus_date: string
    range_start_date: string
    range_end_date: string
    total: number
    tables: BohTable[]
    bookings: BohBooking[]
  }
}

type MoveTableOption = {
  id: string
  name: string
  table_number?: string | null
  capacity?: number | null
}

type MoveTableAvailabilityResponse = {
  success?: boolean
  error?: string
  data?: {
    booking_id: string
    tables: MoveTableOption[]
  }
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending_card_capture', label: 'Pending card capture' },
  { value: 'seated', label: 'Seated' },
  { value: 'left', label: 'Left' },
  { value: 'no_show', label: 'No-show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Completed' },
  { value: 'visited_waiting_for_review', label: 'Visited waiting for review' },
  { value: 'review_clicked', label: 'Review clicked' }
]

function getTodayIsoDate(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  return formatter.format(now)
}

function toDateMidday(dateIso: string): Date {
  const date = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) {
    return new Date(`${getTodayIsoDate()}T12:00:00Z`)
  }
  return date
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftFocusDate(dateIso: string, view: BohViewMode, direction: 1 | -1): string {
  const date = toDateMidday(dateIso)

  if (view === 'day') {
    date.setUTCDate(date.getUTCDate() + direction)
    return toIsoDate(date)
  }

  if (view === 'week') {
    date.setUTCDate(date.getUTCDate() + direction * 7)
    return toIsoDate(date)
  }

  date.setUTCMonth(date.getUTCMonth() + direction)
  return toIsoDate(date)
}

function formatRangeLabel(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return `${startDate} - ${endDate}`
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

  if (startDate === endDate) {
    return formatter.format(start)
  }

  return `${formatter.format(start)} - ${formatter.format(end)}`
}

function formatBookingDateTime(booking: BohBooking): string {
  const startIso = booking.start_datetime
  if (startIso) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(startIso))
  }

  return `${booking.booking_date} ${booking.booking_time}`
}

function formatLifecycleTime(value: string | null): string | null {
  if (!value) return null

  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(parsed)
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'pending_card_capture':
      return 'bg-amber-100 text-amber-900 border-amber-200'
    case 'seated':
      return 'bg-indigo-100 text-indigo-900 border-indigo-200'
    case 'left':
      return 'bg-sky-100 text-sky-900 border-sky-200'
    case 'no_show':
      return 'bg-red-100 text-red-900 border-red-200'
    case 'cancelled':
      return 'bg-gray-200 text-gray-800 border-gray-300'
    case 'completed':
      return 'bg-blue-100 text-blue-900 border-blue-200'
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'bg-purple-100 text-purple-900 border-purple-200'
    case 'confirmed':
      return 'bg-green-100 text-green-900 border-green-200'
    default:
      return 'bg-gray-100 text-gray-900 border-gray-200'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending_card_capture':
      return 'Pending card'
    case 'no_show':
      return 'No-show'
    case 'visited_waiting_for_review':
      return 'Visited waiting for review'
    case 'review_clicked':
      return 'Review clicked'
    default:
      return status
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
  }
}

function getSortValue(booking: BohBooking, column: SortColumn): string | number {
  switch (column) {
    case 'datetime':
      return booking.start_datetime
        ? Date.parse(booking.start_datetime)
        : Date.parse(`${booking.booking_date}T${booking.booking_time || '00:00'}:00Z`)
    case 'guest':
      return (booking.guest_name || '').toLowerCase()
    case 'reference':
      return (booking.booking_reference || '').toLowerCase()
    case 'party_size':
      return Number(booking.party_size || 0)
    case 'tables':
      return (booking.table_names.join(', ') || '').toLowerCase()
    case 'status':
      return (booking.visual_status || booking.status || '').toLowerCase()
    case 'phone':
      return (booking.customer?.mobile_number || '').toLowerCase()
    default:
      return ''
  }
}

function getDefaultSmsMessage(booking: BohBooking): string {
  const firstName = booking.customer?.first_name?.trim() || booking.guest_name?.split(' ')[0] || 'there'
  const referencePart = booking.booking_reference ? ` (${booking.booking_reference})` : ''
  return `The Anchor: Hi ${firstName}, this is a quick update about your booking${referencePart}. Please reply to this message if you need anything.`
}

function isArrivedBooking(booking: BohBooking): boolean {
  if (booking.seated_at || booking.left_at) return true
  const status = (booking.visual_status || booking.status || '').toLowerCase()
  return ['seated', 'left', 'completed', 'visited_waiting_for_review', 'review_clicked'].includes(status)
}

function isLostBooking(booking: BohBooking): boolean {
  const status = (booking.visual_status || booking.status || '').toLowerCase()
  return status === 'no_show' || status === 'cancelled'
}

function calculateMetrics(bookings: BohBooking[]) {
  const totalBookings = bookings.length
  const totalCovers = bookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.party_size || 0)), 0)
  const arrivedBookings = bookings.filter(isArrivedBooking).length
  const lostBookings = bookings.filter(isLostBooking).length
  const averagePartySize = totalBookings > 0 ? totalCovers / totalBookings : 0

  return {
    totalBookings,
    totalCovers,
    arrivedBookings,
    lostBookings,
    averagePartySize
  }
}

function formatMetricValue(value: number, decimals = 0): string {
  if (decimals > 0) {
    return value.toFixed(decimals)
  }

  return new Intl.NumberFormat('en-GB').format(Math.round(value))
}

function getDeltaDisplay(
  current: number,
  previous: number,
  options?: { decimals?: number; invertTrend?: boolean }
): { label: string; toneClass: string } {
  const decimals = options?.decimals ?? 0
  const invertTrend = options?.invertTrend ?? false
  const rawDelta = current - previous
  const delta = Number(rawDelta.toFixed(decimals))
  const epsilon = decimals > 0 ? Math.pow(10, -decimals) : 0
  const deltaSign = delta > 0 ? '+' : ''
  const deltaText = `${deltaSign}${formatMetricValue(delta, decimals)}`

  let percentText = 'vs previous 0'
  if (previous !== 0) {
    const percent = Number(((rawDelta / previous) * 100).toFixed(1))
    const percentSign = percent > 0 ? '+' : ''
    percentText = `${percentSign}${percent.toFixed(1)}%`
  }

  if (Math.abs(delta) <= epsilon) {
    return {
      label: `${deltaText} (${percentText})`,
      toneClass: 'text-gray-600'
    }
  }

  const positiveDirection = invertTrend ? delta < 0 : delta > 0

  return {
    label: `${deltaText} (${percentText})`,
    toneClass: positiveDirection ? 'text-green-700' : 'text-red-700'
  }
}

export function BohBookingsClient({
  canEdit,
  canManage
}: {
  canEdit: boolean
  canManage: boolean
}) {
  const [view, setView] = useState<BohViewMode>('week')
  const [focusDate, setFocusDate] = useState<string>(getTodayIsoDate())
  const [rangeStartDate, setRangeStartDate] = useState<string>(focusDate)
  const [rangeEndDate, setRangeEndDate] = useState<string>(focusDate)
  const [previousRangeStartDate, setPreviousRangeStartDate] = useState<string>('')
  const [previousRangeEndDate, setPreviousRangeEndDate] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<BohBooking[]>([])
  const [previousPeriodBookings, setPreviousPeriodBookings] = useState<BohBooking[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [moveTableId, setMoveTableId] = useState<string>('')
  const [availableMoveTables, setAvailableMoveTables] = useState<MoveTableOption[]>([])
  const [loadingMoveTables, setLoadingMoveTables] = useState<boolean>(false)
  const [smsBody, setSmsBody] = useState<string>('')
  const [sortColumn, setSortColumn] = useState<SortColumn>('datetime')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)

  const loadBookings = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const searchParams = new URLSearchParams({
        date: focusDate,
        view
      })
      const previousPeriodDate = shiftFocusDate(focusDate, view, -1)
      const previousSearchParams = new URLSearchParams({
        date: previousPeriodDate,
        view
      })

      const [response, previousResponse] = await Promise.all([
        fetch(`/api/boh/table-bookings?${searchParams.toString()}`, {
          cache: 'no-store'
        }),
        fetch(`/api/boh/table-bookings?${previousSearchParams.toString()}`, {
          cache: 'no-store'
        }).catch(() => null)
      ])

      const payload = (await response.json()) as BohBookingsResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Failed to load BOH bookings')
      }

      setBookings(payload.data.bookings || [])
      setRangeStartDate(payload.data.range_start_date || focusDate)
      setRangeEndDate(payload.data.range_end_date || focusDate)
      setFocusDate(payload.data.focus_date || focusDate)

      if (previousResponse) {
        const previousPayload = (await previousResponse.json()) as BohBookingsResponse
        if (previousResponse.ok && previousPayload.success && previousPayload.data) {
          setPreviousPeriodBookings(previousPayload.data.bookings || [])
          setPreviousRangeStartDate(previousPayload.data.range_start_date || '')
          setPreviousRangeEndDate(previousPayload.data.range_end_date || '')
        } else {
          setPreviousPeriodBookings([])
          setPreviousRangeStartDate('')
          setPreviousRangeEndDate('')
        }
      } else {
        setPreviousPeriodBookings([])
        setPreviousRangeStartDate('')
        setPreviousRangeEndDate('')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load BOH bookings'
      setError(message)
      setBookings([])
      setPreviousPeriodBookings([])
      setPreviousRangeStartDate('')
      setPreviousRangeEndDate('')
    } finally {
      setLoading(false)
    }
  }, [focusDate, view])

  useEffect(() => {
    void loadBookings()
  }, [loadBookings])

  useEffect(() => {
    if (!selectedBookingId) return

    const booking = bookings.find((item) => item.id === selectedBookingId)
    if (!booking) {
      setSelectedBookingId(null)
      return
    }

    setSmsBody((current) => current || getDefaultSmsMessage(booking))
  }, [bookings, selectedBookingId])

  const selectedBooking = useMemo(
    () => bookings.find((item) => item.id === selectedBookingId) || null,
    [bookings, selectedBookingId]
  )

  useEffect(() => {
    let cancelled = false

    async function loadAvailableMoveTables() {
      if (!selectedBooking || !canEdit) {
        setAvailableMoveTables([])
        setMoveTableId('')
        setLoadingMoveTables(false)
        return
      }

      setLoadingMoveTables(true)

      try {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/move-table`, {
          cache: 'no-store'
        })

        const payload = (await response.json()) as MoveTableAvailabilityResponse
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || 'Failed to load available tables')
        }

        if (cancelled) return

        const options = Array.isArray(payload.data.tables) ? payload.data.tables : []
        setAvailableMoveTables(options)
        setMoveTableId((current) => (current && options.some((table) => table.id === current) ? current : ''))
      } catch (error) {
        if (cancelled) return
        setAvailableMoveTables([])
        setMoveTableId('')
        toast.error(error instanceof Error ? error.message : 'Failed to load available tables')
      } finally {
        if (!cancelled) {
          setLoadingMoveTables(false)
        }
      }
    }

    void loadAvailableMoveTables()

    return () => {
      cancelled = true
    }
  }, [canEdit, selectedBooking])

  const filteredBookings = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return bookings.filter((booking) => {
      if (statusFilter !== 'all') {
        const status = (booking.status || '').toLowerCase()
        const visualStatus = booking.visual_status.toLowerCase()
        if (status !== statusFilter && visualStatus !== statusFilter) {
          return false
        }
      }

      if (!normalizedSearch) {
        return true
      }

      const searchBlob = [
        booking.booking_reference,
        booking.guest_name,
        booking.event_name,
        booking.special_requirements,
        booking.booking_date,
        booking.booking_time,
        booking.status,
        booking.visual_status,
        booking.customer?.mobile_number,
        booking.table_names.join(' ')
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .toLowerCase()

      return searchBlob.includes(normalizedSearch)
    })
  }, [bookings, searchTerm, statusFilter])

  const sortedBookings = useMemo(() => {
    return [...filteredBookings].sort((a, b) => {
      const aValue = getSortValue(a, sortColumn)
      const bValue = getSortValue(b, sortColumn)

      let result = 0
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        result = aValue - bValue
      } else {
        result = String(aValue).localeCompare(String(bValue), 'en', { numeric: true, sensitivity: 'base' })
      }

      if (result === 0) {
        const fallbackA = getSortValue(a, 'datetime')
        const fallbackB = getSortValue(b, 'datetime')
        const fallbackResult =
          typeof fallbackA === 'number' && typeof fallbackB === 'number'
            ? fallbackA - fallbackB
            : String(fallbackA).localeCompare(String(fallbackB), 'en', { numeric: true, sensitivity: 'base' })

        return sortDirection === 'asc' ? fallbackResult : -fallbackResult
      }

      return sortDirection === 'asc' ? result : -result
    })
  }, [filteredBookings, sortColumn, sortDirection])

  const currentMetrics = useMemo(() => calculateMetrics(bookings), [bookings])
  const previousMetrics = useMemo(() => calculateMetrics(previousPeriodBookings), [previousPeriodBookings])
  const previousPeriodLabel = useMemo(() => {
    if (!previousRangeStartDate || !previousRangeEndDate) {
      return 'previous period'
    }
    return formatRangeLabel(previousRangeStartDate, previousRangeEndDate)
  }, [previousRangeStartDate, previousRangeEndDate])

  const metricsCards = useMemo(() => {
    return [
      {
        key: 'bookings',
        title: 'Total bookings',
        value: currentMetrics.totalBookings,
        previous: previousMetrics.totalBookings,
        decimals: 0
      },
      {
        key: 'covers',
        title: 'Total covers',
        value: currentMetrics.totalCovers,
        previous: previousMetrics.totalCovers,
        decimals: 0
      },
      {
        key: 'arrived',
        title: 'Arrived bookings',
        value: currentMetrics.arrivedBookings,
        previous: previousMetrics.arrivedBookings,
        decimals: 0
      },
      {
        key: 'lost',
        title: 'No-shows + cancellations',
        value: currentMetrics.lostBookings,
        previous: previousMetrics.lostBookings,
        decimals: 0,
        invertTrend: true
      },
      {
        key: 'avg-party',
        title: 'Avg party size',
        value: currentMetrics.averagePartySize,
        previous: previousMetrics.averagePartySize,
        decimals: 1
      }
    ]
  }, [currentMetrics, previousMetrics])

  const statusTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const booking of filteredBookings) {
      const key = booking.visual_status || booking.status || 'unknown'
      totals.set(key, (totals.get(key) || 0) + 1)
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  }, [filteredBookings])

  async function runAction(actionKey: string, task: () => Promise<void>, successMessage: string) {
    setActionLoadingKey(actionKey)
    try {
      await task()
      toast.success(successMessage)
      await loadBookings()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoadingKey(null)
    }
  }

  async function handleStatusAction(action: 'seated' | 'left' | 'no_show' | 'cancelled' | 'confirmed' | 'completed') {
    if (!selectedBooking) return

    await runAction(
      `status:${action}`,
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        })

        const payload = (await response.json()) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to update booking status')
        }
      },
      `Booking updated: ${getStatusLabel(action)}`
    )
  }

  async function handleUpdatePartySize() {
    if (!selectedBooking) return

    const currentSize = Math.max(1, Number(selectedBooking.party_size || 1))
    const raw = window.prompt('New party size', String(currentSize))
    if (raw === null) {
      return
    }

    const nextSize = Number.parseInt(raw, 10)
    if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 20) {
      toast.error('Enter a party size between 1 and 20')
      return
    }

    await runAction(
      'party-size',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/party-size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party_size: nextSize,
            send_sms: true
          })
        })

        const payload = (await response.json()) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to update party size')
        }
      },
      'Party size updated'
    )
  }

  async function handleMoveTable() {
    if (!selectedBooking) return
    if (!moveTableId) {
      toast.error('Select a table to move this booking')
      return
    }

    await runAction(
      'move-table',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/move-table`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_id: moveTableId })
        })

        const payload = (await response.json()) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to move booking to selected table')
        }
      },
      'Table assignment updated'
    )
  }

  async function handleSendSms() {
    if (!selectedBooking) return

    const trimmed = smsBody.trim()
    if (!trimmed) {
      toast.error('Enter an SMS message before sending')
      return
    }

    await runAction(
      'send-sms',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed })
        })

        const payload = (await response.json()) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to send SMS')
        }
      },
      'SMS sent to guest'
    )
  }

  async function handleDeleteBooking() {
    if (!selectedBooking) return

    const confirmed = window.confirm('Delete this booking permanently? This cannot be undone.')
    if (!confirmed) {
      return
    }

    await runAction(
      'delete-booking',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}`, {
          method: 'DELETE'
        })

        const payload = (await response.json()) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to delete booking')
        }

        setSelectedBookingId(null)
      },
      'Booking deleted'
    )
  }

  function handleSort(column: SortColumn) {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'))
        return currentColumn
      }

      setSortDirection('asc')
      return column
    })
  }

  function sortIndicator(column: SortColumn): string {
    if (sortColumn !== column) return '↕'
    return sortDirection === 'asc' ? '↑' : '↓'
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Booking window</p>
            <h2 className="text-lg font-semibold text-gray-900">{formatRangeLabel(rangeStartDate, rangeEndDate)}</h2>
            <p className="text-sm text-gray-500">{filteredBookings.length} booking{filteredBookings.length === 1 ? '' : 's'} in view</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFocusDate((current) => shiftFocusDate(current, view, -1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFocusDate(getTodayIsoDate())}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFocusDate((current) => shiftFocusDate(current, view, 1))}
            >
              Next
            </Button>
            <div className="ml-2 flex rounded-md border border-gray-300 bg-gray-50 p-1">
              {(['day', 'week', 'month'] as BohViewMode[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setView(candidate)}
                  className={`rounded px-3 py-1 text-xs font-medium ${
                    view === candidate
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {candidate.charAt(0).toUpperCase() + candidate.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by guest, ref, table, phone, notes"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {statusTotals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {statusTotals.slice(0, 8).map(([status, count]) => (
              <span
                key={status}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClasses(status)}`}
              >
                {getStatusLabel(status)}: {count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricsCards.map((card) => {
          const delta = getDeltaDisplay(card.value, card.previous, {
            decimals: card.decimals,
            invertTrend: card.invertTrend
          })

          return (
            <div key={card.key} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.title}</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {formatMetricValue(card.value, card.decimals)}
              </p>
              <p className={`mt-2 text-xs font-medium ${delta.toneClass}`}>
                {delta.label}
              </p>
              <p className="mt-1 text-[11px] text-gray-500">Compared with {previousPeriodLabel}</p>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Bookings Table</h3>
          <p className="text-xs text-gray-500">Click column headers to sort</p>
        </div>

        <div className="max-h-[680px] overflow-auto">
          {loading && <p className="px-4 py-3 text-sm text-gray-500">Loading bookings…</p>}
          {!loading && error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}
          {!loading && !error && sortedBookings.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-500">No bookings match the selected filters.</p>
          )}

          {!loading && !error && sortedBookings.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('datetime')}>
                      Date/Time <span className="text-gray-400">{sortIndicator('datetime')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('guest')}>
                      Guest <span className="text-gray-400">{sortIndicator('guest')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('reference')}>
                      Ref <span className="text-gray-400">{sortIndicator('reference')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('party_size')}>
                      Party <span className="text-gray-400">{sortIndicator('party_size')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('tables')}>
                      Tables <span className="text-gray-400">{sortIndicator('tables')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('status')}>
                      Status <span className="text-gray-400">{sortIndicator('status')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort('phone')}>
                      Phone <span className="text-gray-400">{sortIndicator('phone')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {sortedBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{formatBookingDateTime(booking)}</td>
                    <td className="px-3 py-2 text-gray-900">
                      <div className="max-w-[220px] truncate" title={booking.guest_name || ''}>
                        {booking.guest_name || 'Unknown guest'}
                      </div>
                      {booking.event_name && (
                        <div className="max-w-[220px] truncate text-xs text-gray-500" title={booking.event_name}>
                          {booking.event_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{booking.booking_reference || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-900 whitespace-nowrap">{booking.party_size || 0}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <div className="max-w-[220px] truncate" title={booking.table_names.join(', ')}>
                        {booking.table_names.length > 0 ? booking.table_names.join(', ') : 'Unassigned'}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusBadgeClasses(booking.visual_status)}`}>
                        {getStatusLabel(booking.visual_status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{booking.customer?.mobile_number || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSelectedBookingId(booking.id)
                          setMoveTableId('')
                          setSmsBody('')
                        }}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(selectedBooking)}
        onClose={() => {
          setSelectedBookingId(null)
          setMoveTableId('')
          setSmsBody('')
        }}
        title={selectedBooking?.guest_name || selectedBooking?.booking_reference || 'Booking details'}
        description={selectedBooking ? `${selectedBooking.booking_reference || 'No reference'} · ${formatBookingDateTime(selectedBooking)}` : undefined}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelectedBookingId(null)
                setMoveTableId('')
                setSmsBody('')
              }}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedBooking && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Booking</p>
                <p className="mt-1 text-sm text-gray-900">{formatBookingDateTime(selectedBooking)}</p>
                <p className="text-sm text-gray-700">Party size: {selectedBooking.party_size || 0}</p>
                <p className="text-sm text-gray-700">Type: {selectedBooking.booking_type || 'table'}</p>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Guest</p>
                <p className="mt-1 text-sm text-gray-900">{selectedBooking.guest_name || 'Unknown guest'}</p>
                <p className="text-sm text-gray-700">{selectedBooking.customer?.mobile_number || 'No mobile number'}</p>
                <p className="text-sm text-gray-700">SMS status: {selectedBooking.customer?.sms_status || 'unknown'}</p>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tables</p>
                <p className="mt-1 text-sm text-gray-900">
                  {selectedBooking.table_names.length > 0
                    ? selectedBooking.table_names.join(', ')
                    : 'Unassigned'}
                </p>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lifecycle</p>
                <p className="mt-1 text-sm text-gray-700">Seated: {formatLifecycleTime(selectedBooking.seated_at) || 'Not set'}</p>
                <p className="text-sm text-gray-700">Left: {formatLifecycleTime(selectedBooking.left_at) || 'Not set'}</p>
                <p className="text-sm text-gray-700">No-show: {formatLifecycleTime(selectedBooking.no_show_at) || 'Not set'}</p>
              </div>
            </div>

            {selectedBooking.special_requirements && (
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{selectedBooking.special_requirements}</p>
              </div>
            )}

            {canEdit && (
              <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status actions</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'party-size'}
                    onClick={() => void handleUpdatePartySize()}
                  >
                    Edit party size
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:confirmed'}
                    onClick={() => handleStatusAction('confirmed')}
                  >
                    Mark Confirmed
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:seated'}
                    onClick={() => handleStatusAction('seated')}
                  >
                    Mark Seated
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:left'}
                    onClick={() => handleStatusAction('left')}
                  >
                    Mark Left
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:completed'}
                    onClick={() => handleStatusAction('completed')}
                  >
                    Mark Completed
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={actionLoadingKey === 'status:no_show'}
                    onClick={() => handleStatusAction('no_show')}
                  >
                    Mark No-show
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={actionLoadingKey === 'status:cancelled'}
                    onClick={() => handleStatusAction('cancelled')}
                  >
                    Cancel Booking
                  </Button>
                </div>
              </div>
            )}

            {canEdit && (
              <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Move table</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={moveTableId}
                    onChange={(event) => setMoveTableId(event.target.value)}
                    disabled={loadingMoveTables || availableMoveTables.length === 0}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="">
                      {loadingMoveTables
                        ? 'Loading available tables…'
                        : availableMoveTables.length === 0
                          ? 'No available tables'
                          : 'Select table'}
                    </option>
                    {availableMoveTables.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name}
                        {table.table_number ? ` (${table.table_number})` : ''}
                        {table.capacity ? ` · cap ${table.capacity}` : ''}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'move-table'}
                    disabled={loadingMoveTables || availableMoveTables.length === 0}
                    onClick={() => void handleMoveTable()}
                  >
                    Move
                  </Button>
                </div>
              </div>
            )}

            {canEdit && (
              <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Send SMS to guest</p>
                <textarea
                  value={smsBody}
                  onChange={(event) => setSmsBody(event.target.value)}
                  rows={4}
                  maxLength={640}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  placeholder="Type message…"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{smsBody.length}/640</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'send-sms'}
                    onClick={() => void handleSendSms()}
                  >
                    Send SMS
                  </Button>
                </div>
              </div>
            )}

            {canManage && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Danger zone</p>
                <p className="text-sm text-red-800">Delete this booking permanently.</p>
                <Button
                  variant="danger"
                  size="sm"
                  loading={actionLoadingKey === 'delete-booking'}
                  onClick={() => void handleDeleteBooking()}
                >
                  Delete Booking
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
