'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
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
  const [lastInteractionAtMs, setLastInteractionAtMs] = useState<number>(() => Date.now())

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmBookingId, setDeleteConfirmBookingId] = useState<string | null>(null)

  // Party size edit modal
  const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
  const [partySizeEditValue, setPartySizeEditValue] = useState('')
  const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)

  // No-show / cancel confirmation
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  const closeSelectedBookingModal = useCallback(() => {
    setSelectedBookingId(null)
    setMoveTableId('')
    setSmsBody('')
  }, [])

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
      if (selectedBookingId || actionLoadingKey) return
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
  }, [actionLoadingKey, focusDate, lastInteractionAtMs, selectedBookingId])

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
  }, [canEdit, selectedBooking?.id])

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

  function openPartySizeEdit() {
    if (!selectedBooking) return
    const currentSize = Math.max(1, Number(selectedBooking.party_size || 1))
    setPartySizeEditValue(String(currentSize))
    setPartySizeEditSendSms(true)
    setPartySizeEditOpen(true)
  }

  async function handleSubmitPartySize() {
    if (!selectedBooking) return

    const nextSize = Number.parseInt(partySizeEditValue, 10)
    if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 50) {
      toast.error('Enter a party size between 1 and 50')
      return
    }

    setPartySizeEditOpen(false)

    await runAction(
      'party-size',
      async () => {
        const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/party-size`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party_size: nextSize,
            send_sms: partySizeEditSendSms
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

  function openDeleteConfirm() {
    if (!selectedBooking) return
    setDeleteConfirmBookingId(selectedBooking.id)
    setDeleteConfirmOpen(true)
  }

  async function handleDeleteBooking() {
    const bookingId = deleteConfirmBookingId
    if (!bookingId) return

    setDeleteConfirmOpen(false)
    setDeleteConfirmBookingId(null)
    closeSelectedBookingModal()

    await runAction(
      'delete-booking',
      async () => {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 15_000)
        let response: Response

        try {
          response = await fetch(`/api/boh/table-bookings/${bookingId}`, {
            method: 'DELETE',
            signal: controller.signal
          })
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Delete request timed out. Please try again.')
          }
          throw error
        } finally {
          window.clearTimeout(timeoutId)
        }

        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to delete booking')
        }
      },
      'Booking deleted'
    )
  }

  async function handleCopyDepositLink() {
    if (!selectedBooking) return
    setActionLoadingKey('copy-deposit-link')
    try {
      const response = await fetch(`/api/boh/table-bookings/${selectedBooking.id}/deposit-link`)
      const data = (await response.json()) as { url?: string; error?: string }
      if (!response.ok) throw new Error(data.error || 'Failed to generate deposit link')
      if (!data.url) throw new Error('No deposit link returned')
      await navigator.clipboard.writeText(data.url)
      toast.success('Deposit link copied to clipboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to copy deposit link')
    } finally {
      setActionLoadingKey(null)
    }
  }

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
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusBadgeClasses(booking.visual_status)}`}>
                          {getStatusLabel(booking.visual_status)}
                        </span>
                        {booking.status === 'confirmed' && booking.payment_status === 'pending' && (
                          <span className="inline-flex rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-800">
                            Deposit outstanding
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 text-gray-700 whitespace-nowrap lg:table-cell">{booking.customer?.mobile_number || '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Manage booking for ${booking.guest_name || booking.booking_reference || 'unknown guest'}`}
                        onClick={() => {
                          setSelectedBookingId(booking.id)
                          setMoveTableId('')
                          setSmsBody('')
                          setLastInteractionAtMs(Date.now())
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
        onClose={closeSelectedBookingModal}
        title={selectedBooking?.guest_name || selectedBooking?.booking_reference || 'Booking details'}
        description={selectedBooking ? `${selectedBooking.booking_reference || 'No reference'} · ${formatBookingDateTime(selectedBooking)}` : undefined}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={closeSelectedBookingModal}
            >
              Close
            </Button>
          </div>
        }
      >
        {selectedBooking && (
          <div className="space-y-5">
            {/* Key info strip: status, party size, table — scannable at a glance */}
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClasses(selectedBooking.visual_status)}`}>
                {getStatusLabel(selectedBooking.visual_status)}
              </span>
              {selectedBooking.status === 'confirmed' && selectedBooking.payment_status === 'pending' && (
                <span className="inline-flex rounded-full border border-yellow-300 bg-yellow-50 px-2.5 py-1 text-xs font-semibold text-yellow-800">
                  Deposit outstanding
                </span>
              )}
              <span className="text-lg font-bold text-gray-900">{selectedBooking.party_size || 0} guests</span>
              <span className="text-sm font-medium text-gray-700">
                {selectedBooking.table_names.length > 0
                  ? selectedBooking.table_names.join(', ')
                  : 'Unassigned'}
              </span>
              <span className="text-sm text-gray-500">{selectedBooking.booking_type || 'table'}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Guest</p>
                <p className="mt-1 text-sm font-medium text-gray-900">{selectedBooking.guest_name || 'Unknown guest'}</p>
                <p className="text-sm text-gray-700">{selectedBooking.customer?.mobile_number || 'No mobile number'}</p>
                <p className="text-sm text-gray-500">SMS: {selectedBooking.customer?.sms_status || 'unknown'}</p>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lifecycle</p>
                <p className="mt-1 text-sm text-gray-700">Seated: {formatLifecycleTime(selectedBooking.seated_at) || 'Not set'}</p>
                <p className="text-sm text-gray-700">Left: {formatLifecycleTime(selectedBooking.left_at) || 'Not set'}</p>
                <p className="text-sm text-gray-700">No-show: {formatLifecycleTime(selectedBooking.no_show_at) || 'Not set'}</p>
              </div>
            </div>

            {selectedBooking.special_requirements && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Special requirements</p>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-amber-900">{selectedBooking.special_requirements}</p>
              </div>
            )}

            {canEdit && (
              <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick actions</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionLoadingKey === 'status:seated'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => handleStatusAction('seated')}
                  >
                    Seat guest
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionLoadingKey === 'status:left'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => handleStatusAction('left')}
                  >
                    Mark left
                  </Button>
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">Other status</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'party-size'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={openPartySizeEdit}
                  >
                    Edit party size
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:confirmed'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => handleStatusAction('confirmed')}
                  >
                    Mark Confirmed
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingKey === 'status:completed'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => handleStatusAction('completed')}
                  >
                    Mark Completed
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={actionLoadingKey === 'status:no_show'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => setNoShowConfirmOpen(true)}
                  >
                    Mark No-show
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={actionLoadingKey === 'status:cancelled'}
                    disabled={Boolean(actionLoadingKey)}
                    onClick={() => setCancelConfirmOpen(true)}
                  >
                    Cancel Booking
                  </Button>
                  {(selectedBooking.status === 'pending_payment' || selectedBooking.payment_status === 'pending') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={actionLoadingKey === 'copy-deposit-link'}
                      disabled={Boolean(actionLoadingKey)}
                      onClick={() => void handleCopyDepositLink()}
                    >
                      Copy deposit link
                    </Button>
                  )}
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
                    disabled={loadingMoveTables || availableMoveTables.length === 0 || Boolean(actionLoadingKey)}
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
                    disabled={Boolean(actionLoadingKey)}
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
                  disabled={Boolean(actionLoadingKey)}
                  onClick={openDeleteConfirm}
                >
                  Delete Booking
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false)
          setDeleteConfirmBookingId(null)
        }}
        onConfirm={() => void handleDeleteBooking()}
        type="danger"
        destructive
        title="Delete this booking?"
        message={`Delete booking ${selectedBooking?.booking_reference || ''} for ${selectedBooking?.guest_name || 'unknown guest'} permanently? This cannot be undone.`}
        confirmText="Delete"
      />

      {/* No-show confirmation dialog */}
      <ConfirmDialog
        open={noShowConfirmOpen}
        onClose={() => setNoShowConfirmOpen(false)}
        onConfirm={async () => {
          setNoShowConfirmOpen(false)
          await handleStatusAction('no_show')
        }}
        type="warning"
        title="Mark as no-show?"
        message="This may trigger a charge request for the customer."
        confirmText="Mark No-show"
        closeOnConfirm={false}
      />

      {/* Cancel booking confirmation dialog */}
      <ConfirmDialog
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        onConfirm={async () => {
          setCancelConfirmOpen(false)
          await handleStatusAction('cancelled')
        }}
        type="warning"
        title="Cancel this booking?"
        message="The customer will be notified."
        confirmText="Cancel Booking"
        confirmVariant="danger"
        closeOnConfirm={false}
      />

      {/* Party size edit modal */}
      <Modal
        open={partySizeEditOpen}
        onClose={() => setPartySizeEditOpen(false)}
        title="Edit party size"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="party-size-input" className="block text-sm font-medium text-gray-700">
              New party size
            </label>
            <input
              id="party-size-input"
              type="number"
              min={1}
              max={50}
              value={partySizeEditValue}
              onChange={(e) => setPartySizeEditValue(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={partySizeEditSendSms}
              onChange={(e) => setPartySizeEditSendSms(e.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            Notify guest by SMS
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPartySizeEditOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSubmitPartySize()}
              disabled={!partySizeEditValue || Number.parseInt(partySizeEditValue, 10) < 1}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
