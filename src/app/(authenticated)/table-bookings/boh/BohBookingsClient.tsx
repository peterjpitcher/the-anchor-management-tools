'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui-v2/forms/Button'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import toast from 'react-hot-toast'

type BohViewMode = 'day' | 'week' | 'month'
type StatusFilter =
  | 'all'
  | 'confirmed'
  | 'pending_payment'
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
  payment_status: string | null
  payment_method: string | null
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

const BOH_AUTO_RETURN_IDLE_MS = 5 * 60 * 1000
const BOH_AUTO_RETURN_POLL_MS = 30 * 1000

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending_payment', label: 'Pending payment' },
  { value: 'seated', label: 'Seated' },
  { value: 'left', label: 'Left' },
  { value: 'no_show', label: 'No-show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'completed', label: 'Completed' },
  { value: 'visited_waiting_for_review', label: 'Visited waiting for review' },
  { value: 'review_clicked', label: 'Review clicked' }
]

function getTodayIsoDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value
      }
      return acc
    }, {})

  const year = parts.year || '1970'
  const month = parts.month || '01'
  const day = parts.day || '01'
  return `${year}-${month}-${day}`
}

function toDateMidday(dateIso: string): Date {
  const date = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date(`${getTodayIsoDate()}T12:00:00Z`)
    if (Number.isFinite(fallback.getTime())) {
      return fallback
    }
    return new Date(Date.UTC(1970, 0, 1, 12, 0, 0))
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
    case 'confirmed':
    case 'pending':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'seated':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'pending_payment':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'left':
    case 'completed':
      return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'no_show':
      return 'bg-red-100 text-red-700 border-red-200'
    case 'cancelled':
      return 'bg-gray-100 text-gray-500 border-gray-200'
    case 'visited_waiting_for_review':
    case 'review_clicked':
      return 'bg-purple-100 text-purple-900 border-purple-200'
    default:
      return 'bg-gray-100 text-gray-900 border-gray-200'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending_payment':
      return 'Pending payment'
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
  const activeBookings = bookings.filter((booking) => !isLostBooking(booking))
  const totalCovers = activeBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.party_size || 0)), 0)
  const arrivedBookings = bookings.filter(isArrivedBooking).length
  const lostBookings = bookings.filter(isLostBooking).length
  const averagePartySize = activeBookings.length > 0 ? totalCovers / activeBookings.length : 0

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
  const router = useRouter()
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
  const [sortColumn, setSortColumn] = useState<SortColumn>('datetime')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  const [lastInteractionAtMs, setLastInteractionAtMs] = useState<number>(() => Date.now())

  const abortControllerRef = useRef<AbortController | null>(null)

  const loadBookings = useCallback(async (options?: { signal?: AbortSignal }) => {
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

      const fetchOptions: RequestInit = { cache: 'no-store', signal: options?.signal }

      const [response, previousResponse] = await Promise.all([
        fetch(`/api/boh/table-bookings?${searchParams.toString()}`, fetchOptions),
        fetch(`/api/boh/table-bookings?${previousSearchParams.toString()}`, fetchOptions).catch(() => null)
      ])

      const payload = (await response.json()) as BohBookingsResponse

      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Failed to load BOH bookings')
      }

      if (options?.signal?.aborted) return

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
      if (err instanceof DOMException && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Failed to load BOH bookings'
      setError(message)
      setBookings([])
      setPreviousPeriodBookings([])
      setPreviousRangeStartDate('')
      setPreviousRangeEndDate('')
    } finally {
      if (!options?.signal?.aborted) {
        setLoading(false)
      }
    }
  }, [focusDate, view])

  useEffect(() => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    void loadBookings({ signal: controller.signal })
    return () => controller.abort()
  }, [loadBookings])

  useEffect(() => {
    const markInteraction = () => {
      setLastInteractionAtMs(Date.now())
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markInteraction()
      }
    }

    window.addEventListener('pointerdown', markInteraction, { passive: true })
    window.addEventListener('wheel', markInteraction, { passive: true })
    window.addEventListener('keydown', markInteraction)
    window.addEventListener('touchstart', markInteraction, { passive: true })
    window.addEventListener('focus', markInteraction)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pointerdown', markInteraction)
      window.removeEventListener('wheel', markInteraction)
      window.removeEventListener('keydown', markInteraction)
      window.removeEventListener('touchstart', markInteraction)
      window.removeEventListener('focus', markInteraction)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const todayDate = getTodayIsoDate()
      if (focusDate === todayDate) return
      if (actionLoadingKey) return
      if (document.visibilityState !== 'visible') return

      const activeElement = document.activeElement
      const isEditing =
        activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
        || activeElement?.getAttribute('contenteditable') === 'true'

      if (isEditing) return
      if (Date.now() - lastInteractionAtMs < BOH_AUTO_RETURN_IDLE_MS) return

      setFocusDate(todayDate)
      setLastInteractionAtMs(Date.now())
      toast('Returned to today after inactivity')
    }, BOH_AUTO_RETURN_POLL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [actionLoadingKey, focusDate, lastInteractionAtMs])

  const filteredBookings = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return bookings.filter((booking) => {
      if (statusFilter !== 'all') {
        const status = (booking.status || '').toLowerCase()
        const visualStatus = booking.visual_status.toLowerCase()
        const paymentStatus = (booking.payment_status || '').toLowerCase()
        if (statusFilter === 'pending_payment') {
          if (status !== 'pending_payment' && visualStatus !== 'pending_payment' && paymentStatus !== 'pending') {
            return false
          }
        } else if (status !== statusFilter && visualStatus !== statusFilter) {
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

  function handleSort(column: SortColumn) {
    const newDirection = sortColumn === column ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortColumn(column)
    setSortDirection(newDirection)
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
            <a
              href={`/api/boh/table-bookings/preorder-sheet?date=${focusDate}`}
              download
              className="ml-2 inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Kitchen pre-order sheet
            </a>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <label htmlFor="boh-search" className="sr-only">Search bookings</label>
            <input
              id="boh-search"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by guest, ref, table, phone, notes"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
          <div>
            <label htmlFor="boh-status-filter" className="sr-only">Filter by status</label>
            <select
              id="boh-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          </div>
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

        <div className="max-h-[680px] overflow-auto overflow-x-auto">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              <p className="text-sm text-gray-500">Loading bookings…</p>
            </div>
          )}
          {!loading && error && (
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadBookings()}>
                Retry
              </Button>
            </div>
          )}
          {!loading && !error && sortedBookings.length === 0 && (
            <EmptyState
              icon="calendar"
              title="No bookings"
              description={searchTerm || statusFilter !== 'all' ? 'No bookings match the selected filters.' : 'There are no bookings for this period.'}
              size="sm"
              variant="minimal"
            />
          )}

          {!loading && !error && sortedBookings.length > 0 && (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('datetime')}>
                      Date/Time <span className="text-gray-400">{sortIndicator('datetime')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('guest')}>
                      Guest <span className="text-gray-400">{sortIndicator('guest')}</span>
                    </button>
                  </th>
                  <th className="hidden px-3 py-2 text-left font-semibold text-gray-700 lg:table-cell">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('reference')}>
                      Ref <span className="text-gray-400">{sortIndicator('reference')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('party_size')}>
                      Party <span className="text-gray-400">{sortIndicator('party_size')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('tables')}>
                      Tables <span className="text-gray-400">{sortIndicator('tables')}</span>
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('status')}>
                      Status <span className="text-gray-400">{sortIndicator('status')}</span>
                    </button>
                  </th>
                  <th className="hidden px-3 py-2 text-left font-semibold text-gray-700 lg:table-cell">
                    <button type="button" className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-2 focus:ring-gray-400" onClick={() => handleSort('phone')}>
                      Phone <span className="text-gray-400">{sortIndicator('phone')}</span>
                    </button>
                  </th>
                  <th className="hidden px-3 py-2 text-left font-semibold text-gray-700 lg:table-cell">Deposit</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {sortedBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{formatBookingDateTime(booking)}</td>
                    <td className="px-3 py-2 text-gray-900">
                      <div className="max-w-[220px] truncate font-medium" title={booking.guest_name || ''}>
                        {booking.guest_name || 'Unknown guest'}
                      </div>
                      {booking.event_name && (
                        <div className="max-w-[220px] truncate text-xs text-gray-500" title={booking.event_name}>
                          {booking.event_name}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-gray-700 whitespace-nowrap lg:table-cell">{booking.booking_reference || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="text-base font-bold text-gray-900">{booking.party_size || 0}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <div className="max-w-[220px] truncate font-medium" title={booking.table_names.join(', ')}>
                        {booking.table_names.length > 0 ? booking.table_names.join(', ') : 'Unassigned'}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusBadgeClasses(booking.visual_status)}`}>
                        {getStatusLabel(booking.visual_status)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-gray-700 whitespace-nowrap lg:table-cell">{booking.customer?.mobile_number || '—'}</td>
                    <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">
                      {booking.payment_status === 'completed' ? (
                        <span className="inline-flex rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800">
                          Paid · {booking.payment_method === 'paypal' ? 'PayPal' : booking.payment_method === 'cash' ? 'Cash' : 'Card'}
                        </span>
                      ) : (booking.payment_status === 'pending' || booking.status === 'pending_payment') ? (
                        <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          Outstanding
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Manage booking for ${booking.guest_name || booking.booking_reference || 'unknown guest'}`}
                        onClick={() => router.push(`/table-bookings/${booking.id}`)}
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
    </div>
  )
}
