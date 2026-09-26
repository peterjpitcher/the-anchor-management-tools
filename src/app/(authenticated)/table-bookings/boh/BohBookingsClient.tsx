'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dropdown,
  DropdownItem,
  Empty,
  Icon,
  Input,
  LinkButton,
  PageLayout,
  PageLoading,
  Segmented,
  Select,
  Stat,
  StatGrid,
  SubHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds'
import { MessageGuestsModal } from './MessageGuestsModal'
import { tableBookingsNav } from '../_shared/nav'
import { FohCreateBookingModal } from '../foh/components/FohCreateBookingModal'
import { useFohCreateBooking } from '../foh/hooks/useFohCreateBooking'
import { buildTimelineRange } from '../foh/utils'
import { downloadBlob, filenameFromContentDisposition } from '@/lib/download-file'
import {
  formatGbp,
  getTableBookingDepositBadgeClasses,
  getTableBookingDepositState,
  getTableBookingStatusBadgeClasses,
  getTableBookingStatusLabel,
  getTableBookingVisualState,
} from '@/lib/table-bookings/ui'
import {
  formatPreorderAddonPrice,
  formatPreorderMoney,
} from '@/lib/table-bookings/preorder'
import {
  PREORDER_ADDON_STAFF_NOTE,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  type PreorderCourse,
} from '@/types/preorders'

export type BohViewMode = 'day' | 'week' | 'month'

/** Dish counts for the focused day, as /api/boh/table-bookings/preorder-totals returns them. */
type PreorderDishTotalsResponse = {
  success?: boolean
  error?: string
  data?: {
    date: string
    bookingCount: number
    coverCount: number
    byCourse: Record<PreorderCourse, Array<{ menuItemId: string; itemName: string; count: number }>>
    /**
     * Add-ons, in their OWN group and never folded into the dessert count. An add-on is an extra the
     * guest has on top of their meal, so counting a cheeseboard as a pudding would have the kitchen
     * make one dessert too few and nobody would charge for the cheeseboard.
     */
    addons: Array<{
      menuItemId: string
      itemName: string
      count: number
      unitPriceGbp: number | null
      totalGbp: number
      hasUnpricedSelection: boolean
    }>
    /** What the pub should take across the day for add-ons, charged on the night. */
    addonTotalGbp: number
    /** True when any add-on that day is unpriced, so the total above is not the whole of it. */
    addonHasUnpricedSelection: boolean
  }
}

/**
 * What one add-on line is worth on the night.
 *
 * Every item on the Christmas menu is unpriced at the time of writing, so a bare "£0.00" is the
 * figure a manager would see most often, and it reads as free. Say what is actually known instead.
 */
function formatAddonLineMoney(totalGbp: number, hasUnpricedSelection: boolean): string {
  if (!hasUnpricedSelection) return formatPreorderMoney(totalGbp)
  return totalGbp > 0 ? `At least ${formatPreorderMoney(totalGbp)}` : 'No price yet'
}
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
  deposit_amount: number | null
  deposit_amount_locked: number | null
  deposit_waived: boolean | null
  high_chair_count: number | null
  is_outside_seating: boolean | null
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

const VIEW_OPTIONS: Array<{ id: BohViewMode; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

/** A sortable column header: the DS TableHead draws the button, the arrow and aria-sort. */
function SortHead({
  column,
  label,
  sortColumn,
  sortDirection,
  onSort,
  align,
  className,
}: {
  column: SortColumn
  label: string
  sortColumn: SortColumn
  sortDirection: SortDirection
  onSort: (column: SortColumn) => void
  align?: 'left' | 'right'
  className?: string
}): React.JSX.Element {
  return (
    <TableHead
      align={align}
      className={className}
      sortable
      sortDirection={sortColumn === column ? sortDirection : null}
      onSort={() => onSort(column)}
    >
      {label}
    </TableHead>
  )
}

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
      hourCycle: 'h12'
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
    hourCycle: 'h12'
  }).format(parsed)
}

function getStatusBadgeClasses(status: string): string {
  return getTableBookingStatusBadgeClasses(status)
}

function getStatusLabel(status: string): string {
  return getTableBookingStatusLabel(status)
}

function getSortValue(booking: BohBooking, column: SortColumn): string | number {
  switch (column) {
    case 'datetime':
      return booking.start_datetime
        ? Date.parse(booking.start_datetime)
        : Date.parse(`${booking.booking_date}T${(booking.booking_time || '00:00').slice(0, 5)}:00Z`)
    case 'guest':
      return (booking.guest_name || '').toLowerCase()
    case 'reference':
      return (booking.booking_reference || '').toLowerCase()
    case 'party_size':
      return Number(booking.party_size || 0)
    case 'tables':
      return (booking.table_names.join(', ') || '').toLowerCase()
    case 'status':
      return getTableBookingVisualState(booking).toLowerCase()
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

/** The change against the previous period in the figure's own units, as "+3" or "-0.5". */
function getDeltaText(current: number, previous: number, decimals = 0): string {
  const delta = Number((current - previous).toFixed(decimals))
  return `${delta > 0 ? '+' : ''}${formatMetricValue(delta, decimals)}`
}

/**
 * The change against the previous period for the Stat's coloured delta, as a percentage. A rise
 * from zero has no percentage, so it shows the change in the figure's own units ("+2") instead,
 * still coloured by whether it is good news; nothing against nothing shows no delta. A change too
 * small to show at the figure's own precision (average party size 4.02 against 4.0, shown as
 * "0.0") reads as no change, so the arrow never contradicts the hint beneath it.
 */
function getStatDelta(
  current: number,
  previous: number,
  decimals = 0
): { delta?: number; deltaLabel?: string } {
  const change = Number((current - previous).toFixed(decimals))
  if (previous === 0) {
    return change === 0 ? {} : { delta: change, deltaLabel: getDeltaText(current, previous, decimals) }
  }
  if (change === 0) return { delta: 0 }
  return { delta: Number((((current - previous) / previous) * 100).toFixed(1)) }
}

export function BohBookingsClient({
  canEdit,
  canManage,
  canWaiveDeposit = false,
  canSendMessages = false,
  canViewReports = false,
  canManageSettings = false,
  initialDate,
  initialView
}: {
  canEdit: boolean
  canManage: boolean
  canWaiveDeposit?: boolean
  canSendMessages?: boolean
  /** Shows the Reports tab. */
  canViewReports?: boolean
  /** Shows the Table Setup header action. */
  canManageSettings?: boolean
  /** Opens on this London date (YYYY-MM-DD), for links such as the weekly Insights report's day links. */
  initialDate?: string
  initialView?: BohViewMode
}) {
  const router = useRouter()
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false)
  const [view, setView] = useState<BohViewMode>(initialView ?? 'week')
  const [focusDate, setFocusDate] = useState<string>(initialDate ?? getTodayIsoDate())
  const [rangeStartDate, setRangeStartDate] = useState<string>(focusDate)
  const [rangeEndDate, setRangeEndDate] = useState<string>(focusDate)
  const [previousRangeStartDate, setPreviousRangeStartDate] = useState<string>('')
  const [previousRangeEndDate, setPreviousRangeEndDate] = useState<string>('')
  // True from the first render: the fetch starts in an effect after mount, and starting at false
  // painted "There are no bookings for this period" before anything had been asked for.
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<BohBooking[]>([])
  const [previousPeriodBookings, setPreviousPeriodBookings] = useState<BohBooking[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortColumn, setSortColumn] = useState<SortColumn>('datetime')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
  const [lastInteractionAtMs, setLastInteractionAtMs] = useState<number>(() => Date.now())
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null)
  const [createStatusMessage, setCreateStatusMessage] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<boolean>(false)
  const [dishTotals, setDishTotals] = useState<PreorderDishTotalsResponse['data'] | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const clockNow = useMemo(() => new Date(), [])
  const createBookingTimeline = useMemo(() => buildTimelineRange(null), [])

  const loadBookings = useCallback(async (options?: { signal?: AbortSignal }) => {
    setLoading(true)
    setError(null)

    try {
      const searchParams = new URLSearchParams({
        date: focusDate,
        view
      })
      const previousPeriodDate = shiftFocusDate(focusDate, view === 'day' ? 'week' : view, -1)
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
      setLastLoadedAt(new Date())
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

  const createBooking = useFohCreateBooking({
    date: focusDate,
    clockNow,
    canEdit,
    schedule: null,
    timeline: createBookingTimeline,
    setErrorMessage: setCreateErrorMessage,
    setStatusMessage: setCreateStatusMessage,
    reloadSchedule: async () => {
      await loadBookings()
    }
  })

  useEffect(() => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    void loadBookings({ signal: controller.signal })
    return () => controller.abort()
  }, [loadBookings])

  // Dish totals are a day-view thing: the kitchen preps a day, not a month. Loaded separately from
  // the booking list so a failure here leaves the day's bookings on screen.
  useEffect(() => {
    if (view !== 'day') {
      setDishTotals(null)
      return
    }

    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(
          `/api/boh/table-bookings/preorder-totals?date=${focusDate}`,
          { cache: 'no-store', signal: controller.signal }
        )
        const payload = (await response.json()) as PreorderDishTotalsResponse
        if (!response.ok || !payload.success || !payload.data) {
          setDishTotals(null)
          return
        }
        setDishTotals(payload.data)
      } catch {
        // An aborted fetch is the normal case when the date changes. Either way the panel simply
        // does not appear, which is honest: no totals shown beats stale totals shown.
        setDishTotals(null)
      }
    })()

    return () => controller.abort()
  }, [focusDate, view])

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
      if (actionLoadingKey || createBooking.isCreateModalOpen || createBooking.submittingBooking) return
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
      toast.info('Returned to today after inactivity')
    }, BOH_AUTO_RETURN_POLL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [actionLoadingKey, createBooking.isCreateModalOpen, createBooking.submittingBooking, focusDate, lastInteractionAtMs])

  const filteredBookings = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return bookings.filter((booking) => {
      if (statusFilter !== 'all') {
        const status = (booking.status || '').toLowerCase()
        const visualStatus = getTableBookingVisualState(booking)
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

  // deltaGood: which way is good news. Only no-shows and cancellations are better when they fall.
  const metricsCards = useMemo((): Array<{
    key: string
    title: string
    value: number
    previous: number
    decimals: number
    deltaGood: 'up' | 'down'
  }> => {
    return [
      {
        key: 'bookings',
        title: 'Total bookings',
        value: currentMetrics.totalBookings,
        previous: previousMetrics.totalBookings,
        decimals: 0,
        deltaGood: 'up'
      },
      {
        key: 'covers',
        title: 'Total covers',
        value: currentMetrics.totalCovers,
        previous: previousMetrics.totalCovers,
        decimals: 0,
        deltaGood: 'up'
      },
      {
        key: 'arrived',
        title: 'Arrived bookings',
        value: currentMetrics.arrivedBookings,
        previous: previousMetrics.arrivedBookings,
        decimals: 0,
        deltaGood: 'up'
      },
      {
        key: 'lost',
        title: 'No-shows + cancellations',
        value: currentMetrics.lostBookings,
        previous: previousMetrics.lostBookings,
        decimals: 0,
        deltaGood: 'down'
      },
      {
        key: 'avg-party',
        title: 'Avg party size',
        value: currentMetrics.averagePartySize,
        previous: previousMetrics.averagePartySize,
        decimals: 1,
        deltaGood: 'up'
      }
    ]
  }, [currentMetrics, previousMetrics])

  const statusTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const booking of filteredBookings) {
      const key = getTableBookingVisualState(booking)
      totals.set(key, (totals.get(key) || 0) + 1)
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  }, [filteredBookings])

  function handleSort(column: SortColumn) {
    const newDirection = sortColumn === column ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'asc'
    setSortColumn(column)
    setSortDirection(newDirection)
  }

  // `bookings` holds the whole loaded range (week/month), not one day — filter to the focused day.
  // The list route applies no status filter, so it includes cancelled/no_show rows that the sheets
  // route excludes. Without matching that exclusion the button enables on a day of only cancelled
  // bookings and then 404s.
  const printableBookingCount = bookings.filter(
    (booking) =>
      booking.booking_date === focusDate &&
      booking.status !== 'cancelled' &&
      booking.status !== 'no_show'
  ).length
  // Settled for *this* day: `loading === false` alone is not enough because focusDate drives the
  // refetch. rangeStartDate/rangeEndDate are only ever set from a successful payload.
  const scheduleSettled = !loading && !error && rangeStartDate <= focusDate && focusDate <= rangeEndDate
  const isDayView = view === 'day'
  const canDownload = isDayView && scheduleSettled && printableBookingCount > 0

  async function handleDownloadPdf() {
    if (downloading) return
    setDownloading(true)
    try {
      const response = await fetch(`/api/boh/table-bookings/booking-sheets?date=${focusDate}`)

      if (!response.ok) {
        toast.error(
          response.status === 404 ? 'No bookings to print for this day'
          : response.status === 422 ? 'Too many bookings to print in one PDF'
          : response.status === 401 ? 'Your session has expired — please sign in again'
          : response.status === 403 ? "You don't have permission to export booking sheets"
          : 'Could not generate the booking sheets'
        )
        return
      }

      if (!response.headers.get('content-type')?.includes('application/pdf')) {
        toast.error('Unexpected response — no PDF was downloaded')
        return
      }

      const blob = await response.blob()
      // The server-set filename is authoritative; the client value is only a fallback.
      downloadBlob(
        blob,
        filenameFromContentDisposition(
          response.headers.get('content-disposition'),
          `table-bookings-${focusDate}.pdf`
        )
      )
      toast.success(`Downloaded booking sheets for ${focusDate}`)
    } catch {
      toast.error('Could not generate the booking sheets')
    } finally {
      setDownloading(false)
    }
  }

  const sortHeadProps = { sortColumn, sortDirection, onSort: handleSort }

  // Until the first load settles, the page shows one loading state rather than figures and a list
  // of zeros. Later reloads keep what is on screen and load the list in place. The page body (and
  // the dialogs in it) is not mounted during that first load, so the buttons that open a dialog
  // wait for it rather than opening one late.
  const initialLoading = loading && !lastLoadedAt && !error

  // More than three header actions collapse the extras (Message Guests, Table Setup) into one
  // "More" menu. Refresh, Download PDF and Book Table stay one tap away.
  const extraActionCount = (canSendMessages ? 1 : 0) + (canManageSettings ? 1 : 0)
  const extrasInMenu = 2 + extraActionCount + (canEdit ? 1 : 0) > 3

  const headerActions = (
    // display: contents keeps the buttons as items of the header's own row; the attribute gives
    // them the same 44px touch floor on the iPad as the page body below.
    <div className="contents" data-touch-targets>
      <Segmented
        size="sm"
        aria-label="View"
        options={VIEW_OPTIONS}
        value={view}
        onChange={(id) => setView(id as BohViewMode)}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void loadBookings()}
        loading={loading}
      >
        Refresh
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void handleDownloadPdf()}
        loading={downloading}
        disabled={!canDownload || downloading}
        aria-busy={downloading}
        title={!isDayView ? "Switch to Day view to print a day's sheets" : undefined}
      >
        Download PDF
      </Button>
      {extrasInMenu ? (
        <Dropdown
          width="auto"
          trigger={
            <Button type="button" size="sm" variant="secondary" iconRight={<Icon name="chevronDown" size={14} />}>
              More
            </Button>
          }
        >
          {canSendMessages && (
            <DropdownItem
              icon={<Icon name="message" size={16} />}
              onClick={() => setIsMessageModalOpen(true)}
              disabled={initialLoading}
            >
              Message Guests
            </DropdownItem>
          )}
          {canManageSettings && (
            <DropdownItem icon={<Icon name="cog" size={16} />} onClick={() => router.push('/settings/table-bookings')}>
              Table Setup
            </DropdownItem>
          )}
        </Dropdown>
      ) : (
        <>
          {canSendMessages && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="message" size={16} />}
              onClick={() => setIsMessageModalOpen(true)}
              disabled={initialLoading}
            >
              Message Guests
            </Button>
          )}
          {canManageSettings && (
            <LinkButton href="/settings/table-bookings" variant="secondary" size="sm">
              Table Setup
            </LinkButton>
          )}
        </>
      )}
      {canEdit && (
        <Button
          variant="primary"
          size="sm"
          icon={<Icon name="plus" size={16} />}
          onClick={() => createBooking.openCreateModal({ mode: 'booking', prefill: { booking_date: focusDate } })}
          disabled={initialLoading}
        >
          Book Table
        </Button>
      )}
    </div>
  )

  return (
    <PageLayout
      title="Table Bookings"
      subtitle="Back of House: every booking by day, week or month"
      navItems={tableBookingsNav({ canViewReports })}
      headerActions={headerActions}
      loading={initialLoading}
      loadingLabel="Loading bookings"
    >
      {/* data-touch-targets: BOH is also used on a tablet, and the 44px floor in globals.css
          only applies below 821px. See the note in FohScheduleClient. This wrapper carries the
          attribute for the page body and keeps the page's own 24px rhythm between blocks. */}
      <div className="space-y-6" data-touch-targets>
        <Card>
          <CardHeader
            title={formatRangeLabel(rangeStartDate, rangeEndDate)}
            // No count on a failed load: "0 bookings in view" would contradict the alert below.
            subtitle={error ? undefined : `${filteredBookings.length} booking${filteredBookings.length === 1 ? '' : 's'} in view${
              lastLoadedAt ? ` · updated ${lastLoadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''
            }`}
          />
          <CardBody className="space-y-4">
            {/* The date moves every block below it (figures, kitchen totals and the list), so it
                stays at the top. Search and the status filter only narrow the list, so they sit
                directly above it in the Bookings Table card. */}
            <div className="flex flex-wrap gap-2">
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
            </div>

            {createStatusMessage && (
              <Alert tone="success" role="status">
                {createStatusMessage}
              </Alert>
            )}
          </CardBody>
        </Card>

        {/* A failed load zeroes the arrays, so the figures and the list would read "0 bookings",
            which a manager takes for a dead service rather than a broken request. On failure the
            alert replaces both, near the top where a narrow screen still shows it. */}
        {error ? (
          <Alert tone="danger" title="Bookings could not be loaded">
            {error}
            {/* The same retry row as PageLayout's own error state. */}
            <div className="mt-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => void loadBookings()}>
                Try Again
              </Button>
            </div>
          </Alert>
        ) : (
          <StatGrid columns={5}>
            {metricsCards.map((card) => (
              <Stat
                key={card.key}
                label={card.title}
                value={formatMetricValue(card.value, card.decimals)}
                {...getStatDelta(card.value, card.previous, card.decimals)}
                deltaGood={card.deltaGood}
                hint={`${getDeltaText(card.value, card.previous, card.decimals)} compared with ${previousPeriodLabel}`}
              />
            ))}
          </StatGrid>
        )}

        {isDayView && dishTotals && dishTotals.coverCount > 0 && (
          <Card>
            <CardHeader
              title="Kitchen Pre-Orders"
              // CardHeader wraps its subtitle, so the sentence sits under the counts as it did before.
              subtitle={`${dishTotals.coverCount} cover${dishTotals.coverCount === 1 ? '' : 's'} across ${dishTotals.bookingCount} booking${dishTotals.bookingCount === 1 ? '' : 's'}. Dietary notes and allergies are on the booking sheet.`}
            />
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-3">
                {PREORDER_COURSES.map((course) => {
                  const dishes = dishTotals.byCourse[course] ?? []
                  return (
                    <div key={course}>
                      <SubHeading>{PREORDER_COURSE_LABELS[course]}</SubHeading>
                      {dishes.length === 0 ? (
                        <p className="mt-2 text-sm text-text-muted">None chosen</p>
                      ) : (
                        <ul className="mt-2 space-y-1">
                          {dishes.map((dish) => (
                            <li
                              key={dish.menuItemId}
                              className="flex items-baseline justify-between gap-3 text-sm text-text"
                            >
                              <span className="min-w-0 break-words">{dish.itemName}</span>
                              <span className="shrink-0 font-semibold tabular-nums">{dish.count}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardBody>

            {(dishTotals.addons ?? []).length > 0 && (
              <CardBody className="border-t border-border">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <SubHeading>Add-ons, Extra to the Courses</SubHeading>
                  <p className="text-sm font-semibold tabular-nums text-text">
                    {formatAddonLineMoney(
                      dishTotals.addonTotalGbp ?? 0,
                      dishTotals.addonHasUnpricedSelection ?? false
                    )}
                  </p>
                </div>
                <ul className="mt-2 space-y-1">
                  {(dishTotals.addons ?? []).map((addon) => (
                    <li
                      key={addon.menuItemId}
                      className="flex items-baseline justify-between gap-3 text-sm text-text"
                    >
                      <span className="min-w-0 break-words">
                        {addon.itemName}
                        <span className="ml-2 text-xs text-text-muted">
                          {addon.unitPriceGbp === null
                            ? formatPreorderAddonPrice(null)
                            : `${formatPreorderMoney(addon.unitPriceGbp)} each`}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold">{addon.count}</span>
                        <span className="ml-3 text-text-muted">
                          {formatAddonLineMoney(addon.totalGbp, addon.hasUnpricedSelection)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Verbatim from the shared constant: four surfaces wording this four ways is how one
                    of them ends up implying the guest has already paid. */}
                <p className="mt-3 text-xs text-text-muted">{PREORDER_ADDON_STAFF_NOTE}</p>
              </CardBody>
            )}
          </Card>
        )}

        {!error && (
          <Card>
            <CardHeader title="Bookings Table" subtitle="Click column headers to sort" />
            <CardBody className="space-y-3 border-b border-border">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-60">
                  <Input
                    id="boh-search"
                    type="search"
                    aria-label="Search bookings"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search by guest, ref, table, phone, notes"
                  />
                </div>
                <div className="w-full sm:w-48">
                  <Select
                    id="boh-status-filter"
                    aria-label="Filter by status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    options={STATUS_OPTIONS}
                  />
                </div>
              </div>

              {statusTotals.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {statusTotals.slice(0, 8).map(([status, count]) => (
                    <Badge key={status} className={getStatusBadgeClasses(status)}>
                      {getStatusLabel(status)}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardBody>

            {loading ? (
              <PageLoading inline label="Loading bookings" />
            ) : sortedBookings.length === 0 ? (
              <Empty
                icon="calendar"
                title={searchTerm || statusFilter !== 'all' ? 'No bookings match these filters' : 'No bookings for this period'}
                description={
                  searchTerm || statusFilter !== 'all'
                    ? 'Clear the search or the status filter to see every booking in view.'
                    : 'Use Previous and Next to look at another period.'
                }
                size="sm"
                variant="minimal"
              />
            ) : (
              <>
                {/* Mobile card list: the 9-column table is unusable at phone width, so below md
                    each booking renders as a stacked card with the key fields as label/value pairs. */}
                <ul className="max-h-[680px] divide-y divide-border overflow-auto md:hidden">
                  {sortedBookings.map((booking) => {
                    const visualState = getTableBookingVisualState(booking)
                    const depositState = getTableBookingDepositState(booking)

                    return (
                      <li key={booking.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-text" title={booking.guest_name || ''}>
                              {booking.guest_name || 'Unknown guest'}
                            </p>
                            <p className="mt-0.5 text-xs text-text-muted">{formatBookingDateTime(booking)}</p>
                          </div>
                          <Badge size="sm" className={`shrink-0 ${getStatusBadgeClasses(visualState)}`}>
                            {getStatusLabel(visualState)}
                          </Badge>
                        </div>

                        {booking.event_name && (
                          <p className="mt-1 truncate text-xs text-text-muted" title={booking.event_name}>
                            {booking.event_name}
                          </p>
                        )}

                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                          <div>
                            <dt className="text-xs text-text-muted">Party</dt>
                            <dd className="font-semibold text-text">{booking.party_size || 0}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-text-muted">Tables</dt>
                            <dd className="font-medium text-text">
                              {booking.is_outside_seating
                                ? 'Outside'
                                : booking.table_names.length > 0
                                  ? booking.table_names.join(', ')
                                  : 'Unassigned'}
                            </dd>
                          </div>
                          {booking.customer?.mobile_number && (
                            <div>
                              <dt className="text-xs text-text-muted">Phone</dt>
                              <dd className="font-medium text-text">{booking.customer.mobile_number}</dd>
                            </div>
                          )}
                          {booking.booking_reference && (
                            <div>
                              <dt className="text-xs text-text-muted">Ref</dt>
                              <dd className="font-medium text-text">{booking.booking_reference}</dd>
                            </div>
                          )}
                        </dl>

                        {((booking.high_chair_count ?? 0) > 0 || depositState.kind !== 'none') && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(booking.high_chair_count ?? 0) > 0 && (
                              <Badge tone="neutral">High chair ×{booking.high_chair_count}</Badge>
                            )}
                            {depositState.kind !== 'none' && (
                              <Badge size="sm" className={getTableBookingDepositBadgeClasses(depositState.kind)}>
                                {depositState.label}
                                {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                                {depositState.methodLabel ? ` · ${depositState.methodLabel}` : ''}
                              </Badge>
                            )}
                          </div>
                        )}

                        <div className="mt-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full"
                            aria-label={`Manage booking for ${booking.guest_name || booking.booking_reference || 'unknown guest'}`}
                            onClick={() => router.push(`/table-bookings/${booking.id}`)}
                          >
                            Manage
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>

                {/* The table scrolls inside its own 680px frame, so the sticky header stays in view. */}
                <Table className="hidden max-h-[680px] overflow-y-auto md:block">
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow>
                      <SortHead column="datetime" label="Date/Time" {...sortHeadProps} />
                      <SortHead column="guest" label="Guest" {...sortHeadProps} />
                      <SortHead column="reference" label="Ref" className="hidden lg:table-cell" {...sortHeadProps} />
                      <SortHead column="party_size" label="Party" align="right" {...sortHeadProps} />
                      <SortHead column="tables" label="Tables" {...sortHeadProps} />
                      <SortHead column="status" label="Status" {...sortHeadProps} />
                      <SortHead column="phone" label="Phone" className="hidden lg:table-cell" {...sortHeadProps} />
                      <TableHead className="hidden lg:table-cell">Deposit</TableHead>
                      <TableHead align="right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBookings.map((booking) => {
                      const visualState = getTableBookingVisualState(booking)
                      const depositState = getTableBookingDepositState(booking)

                      return (
                        <TableRow key={booking.id}>
                          <TableCell className="font-medium">{formatBookingDateTime(booking)}</TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="max-w-[220px] truncate font-medium" title={booking.guest_name || ''}>
                              {booking.guest_name || 'Unknown guest'}
                            </div>
                            {booking.event_name && (
                              <div className="max-w-[220px] truncate text-xs text-text-muted" title={booking.event_name}>
                                {booking.event_name}
                              </div>
                            )}
                            {(booking.high_chair_count ?? 0) > 0 && (
                              <div className="mt-1">
                                <Badge tone="neutral">High chair ×{booking.high_chair_count}</Badge>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">{booking.booking_reference || '-'}</TableCell>
                          <TableCell align="right">
                            <span className="text-base font-bold text-text">{booking.party_size || 0}</span>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {booking.is_outside_seating ? (
                              <Badge tone="info">Outside</Badge>
                            ) : (
                              <div className="max-w-[220px] truncate font-medium" title={booking.table_names.join(', ')}>
                                {booking.table_names.length > 0 ? booking.table_names.join(', ') : 'Unassigned'}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge size="sm" className={getStatusBadgeClasses(visualState)}>
                              {getStatusLabel(visualState)}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">{booking.customer?.mobile_number || '-'}</TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {depositState.kind !== 'none' ? (
                              <Badge size="sm" className={getTableBookingDepositBadgeClasses(depositState.kind)}>
                                {depositState.label}
                                {depositState.amount != null ? ` · ${formatGbp(depositState.amount)}` : ''}
                                {depositState.methodLabel ? ` · ${depositState.methodLabel}` : ''}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label={`Manage booking for ${booking.guest_name || booking.booking_reference || 'unknown guest'}`}
                              onClick={() => router.push(`/table-bookings/${booking.id}`)}
                            >
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </Card>
        )}

        <MessageGuestsModal
          open={isMessageModalOpen}
          onClose={() => setIsMessageModalOpen(false)}
          bookingDate={focusDate}
        />

        <FohCreateBookingModal
          open={createBooking.isCreateModalOpen}
          createMode={createBooking.createMode}
          createForm={createBooking.createForm}
          canWaiveDeposit={canWaiveDeposit}
          canEdit={canEdit}
          walkInTargetTable={createBooking.walkInTargetTable}
          submittingBooking={createBooking.submittingBooking}
          customerQuery={createBooking.customerQuery}
          completedCustomerSearchQuery={createBooking.completedCustomerSearchQuery}
          customerResults={createBooking.customerResults}
          selectedCustomer={createBooking.selectedCustomer}
          searchingCustomers={createBooking.searchingCustomers}
          eventOptions={createBooking.eventOptions}
          loadingEventOptions={createBooking.loadingEventOptions}
          eventOptionsError={createBooking.eventOptionsError}
          selectedEventOption={createBooking.selectedEventOption}
          overlappingEventForTable={createBooking.overlappingEventForTable}
          tableEventPromptAcknowledgedEventId={createBooking.tableEventPromptAcknowledgedEventId}
          walkInPurposeAutoSelectionEnabled={createBooking.walkInPurposeAutoSelectionEnabled}
          formRequiresDeposit={createBooking.formRequiresDeposit}
          seasonalPeriod={createBooking.seasonalPeriod}
          seasonalAnswer={createBooking.seasonalAnswer}
          onSetSeasonalAnswer={createBooking.setSeasonalAnswer}
          errorMessage={createErrorMessage}
          onClose={createBooking.closeCreateModal}
          onSubmit={createBooking.handleCreateBooking}
          onSetCreateForm={createBooking.setCreateForm}
          onSetCustomerQuery={createBooking.setCustomerQuery}
          onSelectCustomer={(customer) => {
            createBooking.setSelectedCustomer(customer)
            createBooking.setCreateForm((current) => ({
              ...current,
              phone: customer.mobile_e164 || customer.mobile_number || ''
            }))
          }}
          onClearCustomer={() => {
            createBooking.setSelectedCustomer(null)
            createBooking.setCustomerQuery('')
            createBooking.setCustomerResults([])
          }}
          onSetTableEventPromptAcknowledgedEventId={createBooking.setTableEventPromptAcknowledgedEventId}
          onSetWalkInPurposeAutoSelectionEnabled={createBooking.setWalkInPurposeAutoSelectionEnabled}
          onSetErrorMessage={setCreateErrorMessage}
        />
      </div>
    </PageLayout>
  )
}
