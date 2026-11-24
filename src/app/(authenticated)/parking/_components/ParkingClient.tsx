'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from 'react'
import {
  formatDateTime,
  parseLondonDateTimeLocal,
  parseLondonDateTimeLocalToIso,
  toLondonDateTimeLocalValue,
} from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  CustomerLink,
  DescriptionList,
  Empty,
  FormFooter,
  Input,
  Modal,
  PageLayout,
  PageLoading,
  SearchInput,
  Select,
  Stat,
  StatGrid,
  SubHeading,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
  toast,
} from '@/ds'
import {
  PARKING_BOOKING_STATUS_LABEL,
  PARKING_BOOKING_STATUS_TONE,
  PARKING_PAYMENT_STATUS_LABEL,
  PARKING_PAYMENT_STATUS_TONE,
} from '../_shared/status-ui'
import { messageDeliveryStatusLabel, messageDeliveryStatusTone } from '@/lib/messages/status-ui'
import { RefundDialog } from './RefundDialog'
import type { ParkingRefundablePayment } from '@/app/actions/refundActions'
import { RefundHistoryTable } from './RefundHistoryTable'
import { ChangeDatesDialog } from './ChangeDatesDialog'
import { RefundDueDialog } from './RefundDueDialog'
import { parkingBalanceLabel } from '@/lib/parking/balance'
import type {
  ParkingBookingWithBalance as ParkingBooking,
  ParkingBookingStatus,
  ParkingNotificationRecord,
  ParkingPaymentStatus,
  ParkingPricingResult
} from '@/types/parking'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import {
  createParkingBooking,
  generateParkingPaymentLink,
  markParkingBookingPaid,
  updateParkingBookingStatus,
  updateParkingBookingDetails,
  listParkingBookings,
  getParkingBookingNotifications,
  saveParkingRateConfig
} from '@/app/actions/parking'
import { parkingRateConfigFromRecord, type ParkingRateConfig } from '@/lib/parking/pricing'
import type { ParkingRate } from '@/types/parking'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParkingPermissions {
  canCreate: boolean
  canManage: boolean
  canRefund: boolean
}

/** The first bookings list, loaded by the server page: the rows, or why they could not be read. */
export type ParkingInitialBookings = { data: ParkingBooking[] } | { error: string }

/** The current rate row, loaded by the server page for managers only (null when not loaded). */
export type ParkingInitialRates = { data: ParkingRate } | { error: string } | null

interface Props {
  permissions: ParkingPermissions
  initialError?: string | null
  initialBookings: ParkingInitialBookings
  initialRates: ParkingInitialRates
}

/** How long the search box waits after the last keystroke before it asks the server. */
export const PARKING_SEARCH_DEBOUNCE_MS = 300

function rateFormFromRecord(rate: ParkingRate) {
  return {
    hourly_rate: String(rate.hourly_rate),
    daily_rate: String(rate.daily_rate),
    weekly_rate: String(rate.weekly_rate),
    monthly_rate: String(rate.monthly_rate),
    capacity_override: rate.capacity_override == null ? '' : String(rate.capacity_override),
    notes: rate.notes ?? '',
  }
}

const EMPTY_RATE_FORM = {
  hourly_rate: '',
  daily_rate: '',
  weekly_rate: '',
  monthly_rate: '',
  capacity_override: '',
  notes: '',
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

// The filters use the same words as the status badges.
const statusOptions = [
  { value: 'all', label: 'All statuses' },
  ...Object.entries(PARKING_BOOKING_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

const paymentStatusOptions = [
  { value: 'all', label: 'All payment states' },
  ...Object.entries(PARKING_PAYMENT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

const NOTIFICATION_CHANNEL_LABEL: Record<ParkingNotificationRecord['channel'], string> = {
  sms: 'SMS',
  email: 'Email',
}

// Sentence case, as a table cell (the old `capitalize` class turned these into Title Case).
const NOTIFICATION_EVENT_LABEL: Record<ParkingNotificationRecord['event_type'], string> = {
  payment_request: 'Payment request',
  payment_reminder: 'Payment reminder',
  payment_confirmation: 'Payment confirmation',
  session_start: 'Session start',
  session_end: 'Session end',
  payment_overdue: 'Payment overdue',
  refund_confirmation: 'Refund confirmation',
  booking_changed: 'Dates changed',
  top_up_received: 'Extra payment received',
}

const initialFormState = {
  customer_first_name: '',
  customer_last_name: '',
  customer_mobile: '',
  customer_email: '',
  vehicle_registration: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_colour: '',
  start_at: '',
  end_at: '',
  notes: '',
  override_price: '',
  override_reason: '',
  capacity_override: false,
  capacity_override_reason: '',
  send_payment_link: true,
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 minutes'
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (rem > 0) parts.push(`${rem} minutes`)
  return parts.join(' ')
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ParkingClient({ permissions, initialError, initialBookings, initialRates }: Props) {
  const [bookings, setBookings] = useState<ParkingBooking[]>(() =>
    'data' in initialBookings ? initialBookings.data : []
  )
  const [loading, setLoading] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<ParkingBooking | null>(null)
  // A failed load is shown as a failure, never as "No bookings": an empty list after an outage
  // reads as a quiet day rather than a broken request.
  const [loadError, setLoadError] = useState<string | null>(() =>
    'error' in initialBookings ? initialBookings.error : null
  )
  const [notifications, setNotifications] = useState<ParkingNotificationRecord[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const initialRateRecord = initialRates && 'data' in initialRates ? initialRates.data : null
  // The pricing figures are derived from the same rate row the Rates tab edits, not read again.
  const [activeRates, setActiveRates] = useState<ParkingRateConfig | null>(() =>
    initialRateRecord ? parkingRateConfigFromRecord(initialRateRecord) : null
  )
  const [pricingPreview, setPricingPreview] = useState<ParkingPricingResult | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  // The settled search: the search box holds keystrokes for PARKING_SEARCH_DEBOUNCE_MS before it
  // reports, so typing a name is one request rather than one per keystroke.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [createForm, setCreateForm] = useState(initialFormState)
  const [editForm, setEditForm] = useState(initialFormState)
  const [cancelTarget, setCancelTarget] = useState<ParkingBooking | null>(null)
  const [showChangeDates, setShowChangeDates] = useState(false)
  const [showRefundDue, setShowRefundDue] = useState(false)
  const [activeRateRecord, setActiveRateRecord] = useState<ParkingRate | null>(initialRateRecord)
  const [rateForm, setRateForm] = useState(() =>
    initialRateRecord ? rateFormFromRecord(initialRateRecord) : EMPTY_RATE_FORM
  )
  const [isPending, startTransition] = useTransition()
  const [isMutating, startMutation] = useTransition()
  // Which detail-card action started the running mutation, so only that button shows it is busy.
  const [mutatingAction, setMutatingAction] = useState<'payment-link' | 'mark-paid' | null>(null)
  const pageError = initialError ?? null

  // Refund state
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null)
  const [refundPaymentAmount, setRefundPaymentAmount] = useState(0)
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })
  const [refundHasCapture, setRefundHasCapture] = useState(false)
  // Every paid payment on the booking (a top-up adds a second): staff pick which one to refund.
  const [refundPayments, setRefundPayments] = useState<ParkingRefundablePayment[]>([])
  // Bumped after a refund to remount RefundHistoryTable, which otherwise only
  // refetches when the payment it is showing changes.
  const [refundHistoryKey, setRefundHistoryKey] = useState(0)

  /* ---------- In-page tabs ---------- */
  const [activeSection, setActiveSection] = useState('bookings')
  const sections = [
    { id: 'bookings', label: 'Bookings' },
    { id: 'notifications', label: 'Notifications' },
    ...(permissions.canManage ? [{ id: 'rates', label: 'Rates' }] : []),
  ]

  /* ---------- Data loading ---------- */

  const fetchBookings = async (): Promise<ParkingBooking[]> => {
    setLoading(true)
    let records: ParkingBooking[] = []
    try {
      const result = await listParkingBookings({
        status: statusFilter === 'all' ? undefined : statusFilter as ParkingBookingStatus,
        paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter as ParkingPaymentStatus,
        search: search || undefined,
      })
      if (!result || 'error' in result) {
        const message = result?.error || 'Failed to load parking bookings'
        toast.error(message)
        setLoadError(message)
        setBookings([])
        return []
      }
      records = result.data
      setBookings(records)
      setLoadError(null)
    } catch {
      // The server action itself failed (network, deploy mid-request): the same failure state.
      const message = 'Failed to load parking bookings'
      toast.error(message)
      setLoadError(message)
      setBookings([])
      return []
    } finally {
      setLoading(false)
    }
    return records
  }

  // The server page sent the unfiltered list, so the list is only fetched again once a filter or
  // the settled search differs from what was last fetched. Keyed rather than a "first run" flag so
  // React's development double-run of effects does not fetch it again either.
  const lastFetchedQuery = useRef<string>(JSON.stringify(['all', 'all', '']))
  useEffect(() => {
    const queryKey = JSON.stringify([statusFilter, paymentFilter, search])
    if (queryKey === lastFetchedQuery.current) return
    lastFetchedQuery.current = queryKey
    void fetchBookings()
  }, [statusFilter, paymentFilter, search])

  // A failed first load says so once, as a refetch failure does.
  const initialBookingsError = 'error' in initialBookings ? initialBookings.error : null
  const initialRatesError = initialRates && 'error' in initialRates ? initialRates.error : null
  useEffect(() => {
    if (initialBookingsError) toast.error(initialBookingsError)
    if (initialRatesError) toast.error(initialRatesError)
    // Only the server's first answer is reported here (deliberately run once); later failures
    // report themselves.
  }, [])

  useEffect(() => {
    if (!activeRates || !createForm.start_at || !createForm.end_at) {
      setPricingPreview(null)
      setPricingError(null)
      return
    }
    try {
      const start = parseLondonDateTimeLocal(createForm.start_at)
      const end = parseLondonDateTimeLocal(createForm.end_at)
      if (!start || !end) throw new Error('Start and end times are required')
      const preview = calculateParkingPricing(start, end, activeRates)
      setPricingPreview(preview)
      setPricingError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate pricing'
      setPricingPreview(null)
      setPricingError(message)
    }
  }, [activeRates, createForm.start_at, createForm.end_at])

  /* ---------- Mutation handlers ---------- */

  const resetForm = () => setCreateForm(initialFormState)
  const resetEditForm = () => setEditForm(initialFormState)

  const handleInputChange = (field: keyof typeof initialFormState, value: string | boolean) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleEditInputChange = (field: keyof typeof initialFormState, value: string | boolean) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const openEditBooking = (booking: ParkingBooking) => {
    setEditForm({
      customer_first_name: booking.customer_first_name,
      customer_last_name: booking.customer_last_name ?? '',
      customer_mobile: booking.customer_mobile,
      customer_email: booking.customer_email ?? '',
      vehicle_registration: booking.vehicle_registration,
      vehicle_make: booking.vehicle_make ?? '',
      vehicle_model: booking.vehicle_model ?? '',
      vehicle_colour: booking.vehicle_colour ?? '',
      start_at: toLondonDateTimeLocalValue(booking.start_at),
      end_at: toLondonDateTimeLocalValue(booking.end_at),
      notes: booking.notes ?? '',
      override_price: booking.override_price == null ? '' : String(booking.override_price),
      override_reason: booking.override_reason ?? '',
      capacity_override: booking.capacity_override ?? false,
      capacity_override_reason: booking.capacity_override_reason ?? '',
      send_payment_link: false,
    })
    setShowEditModal(true)
  }

  // Loads the captured payment behind a booking and what has already been
  // refunded against it. Shared by row selection, the Refund button and the
  // post-refund refresh so all three agree on the refundable balance.
  // Returns an error message, or null on success.
  const loadRefundTotals = async (paymentId: string) => {
    const { getRefundHistory } = await import('@/app/actions/refundActions')
    const history = await getRefundHistory('parking', paymentId)
    const rows = (history.data ?? []) as Record<string, unknown>[]
    const completed = rows.filter((r) => r.status === 'completed').reduce((sum, r) => sum + Number(r.amount), 0)
    const pending = rows.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.amount), 0)
    setRefundTotals({ totalRefunded: completed, totalPending: pending })
  }

  const loadRefundSummary = async (bookingId: string, preferredPaymentId?: string | null): Promise<string | null> => {
    try {
      const { getParkingPaymentForRefund } = await import('@/app/actions/refundActions')
      const paymentResult = await getParkingPaymentForRefund(bookingId)
      if (paymentResult.error || !paymentResult.data) {
        setRefundPaymentId(null)
        setRefundPayments([])
        return paymentResult.error || 'No paid payment record found.'
      }
      const payments = paymentResult.data.payments ?? []
      setRefundPayments(payments)
      const chosen =
        payments.find((payment) => payment.paymentId === preferredPaymentId) ??
        payments.find((payment) => payment.paymentId === paymentResult.data?.paymentId)
      setRefundPaymentId(chosen?.paymentId ?? paymentResult.data.paymentId)
      setRefundPaymentAmount(chosen?.amount ?? paymentResult.data.amount)
      setRefundHasCapture(chosen?.hasCapture ?? paymentResult.data.hasCapture)
      await loadRefundTotals(chosen?.paymentId ?? paymentResult.data.paymentId)
      return null
    } catch {
      return 'Failed to load payment details for refund.'
    }
  }

  const selectRefundPayment = async (paymentId: string) => {
    const chosen = refundPayments.find((payment) => payment.paymentId === paymentId)
    if (!chosen) return
    setRefundPaymentId(chosen.paymentId)
    setRefundPaymentAmount(chosen.amount)
    setRefundHasCapture(chosen.hasCapture)
    try {
      await loadRefundTotals(chosen.paymentId)
    } catch {
      toast.error('Failed to load the refunds on that payment.')
    }
    setRefundHistoryKey((key) => key + 1)
  }

  const openRefundForBooking = async (booking: ParkingBooking) => {
    // Keeps the payment chosen in Refund History, so the dialog refunds that one.
    const error = await loadRefundSummary(booking.id, refundPaymentId)
    if (error) { toast.error(error); return }
    setShowRefundDialog(true)
  }

  // A refund flips the booking to refunded and cancelled, and the bookings table
  // lives in client state, so the dialog's router.refresh() leaves the row, the
  // stats and the detail panel all still claiming the booking is paid.
  const handleRefundProcessed = async () => {
    const bookingId = selectedBooking?.id
    const latest = await fetchBookings()
    if (!bookingId) return
    // The refunded booking may no longer match the active filters, in which case
    // it has genuinely left the list and the detail panel closes with it.
    setSelectedBooking(latest.find((b) => b.id === bookingId) ?? null)
    await loadRefundSummary(bookingId, refundPaymentId)
    setRefundHistoryKey((key) => key + 1)
  }

  const handleCreateBooking = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const start = parseLondonDateTimeLocalToIso(createForm.start_at)
    const end = parseLondonDateTimeLocalToIso(createForm.end_at)
    if (!start || !end) { toast.error('Start and end times are required'); return }

    const formData = new FormData()
    formData.append('customer_first_name', createForm.customer_first_name)
    if (createForm.customer_last_name) formData.append('customer_last_name', createForm.customer_last_name)
    formData.append('customer_mobile', createForm.customer_mobile)
    formData.append('default_country_code', '44')
    if (createForm.customer_email) formData.append('customer_email', createForm.customer_email)
    formData.append('vehicle_registration', createForm.vehicle_registration)
    if (createForm.vehicle_make) formData.append('vehicle_make', createForm.vehicle_make)
    if (createForm.vehicle_model) formData.append('vehicle_model', createForm.vehicle_model)
    if (createForm.vehicle_colour) formData.append('vehicle_colour', createForm.vehicle_colour)
    formData.append('start_at', start)
    formData.append('end_at', end)
    if (createForm.notes) formData.append('notes', createForm.notes)
    if (createForm.override_price) formData.append('override_price', createForm.override_price)
    if (createForm.override_reason) formData.append('override_reason', createForm.override_reason)
    if (createForm.capacity_override) {
      formData.append('capacity_override', 'true')
      if (createForm.capacity_override_reason) formData.append('capacity_override_reason', createForm.capacity_override_reason)
    }
    // Always sent. Omitting it when the switch was off let the server fall back
    // to its default of true and text the customer regardless.
    formData.append('send_payment_link', createForm.send_payment_link ? 'true' : 'false')

    startTransition(async () => {
      const result = await createParkingBooking(formData)
      if (result?.error) { toast.error(result.error); return }
      toast.success('Parking booking created successfully')
      if (result?.warning) {
        // The booking saved but the customer cannot pay and has not been texted.
        // This has to be loud, or nobody follows up and the booking expires.
        toast.error(result.warning, { duration: 12000 })
      } else if (result?.paymentLink) {
        toast.info('Payment link generated. Copy it from the booking details.')
      }
      setShowCreateModal(false)
      resetForm()
      const latest = await fetchBookings()
      const created = latest.find((b) => b.id === (result?.booking as ParkingBooking | undefined)?.id)
      if (created) setSelectedBooking(created)
    })
  }

  const handleEditBooking = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedBooking) return

    // Dates are not sent: they move only through Change dates, which reprices and settles.
    const formData = new FormData()
    formData.append('customer_first_name', editForm.customer_first_name)
    if (editForm.customer_last_name) formData.append('customer_last_name', editForm.customer_last_name)
    formData.append('customer_mobile', editForm.customer_mobile)
    formData.append('default_country_code', '44')
    if (editForm.customer_email) formData.append('customer_email', editForm.customer_email)
    formData.append('vehicle_registration', editForm.vehicle_registration)
    if (editForm.vehicle_make) formData.append('vehicle_make', editForm.vehicle_make)
    if (editForm.vehicle_model) formData.append('vehicle_model', editForm.vehicle_model)
    if (editForm.vehicle_colour) formData.append('vehicle_colour', editForm.vehicle_colour)
    if (editForm.notes) formData.append('notes', editForm.notes)
    if (editForm.override_price) formData.append('override_price', editForm.override_price)
    if (editForm.override_reason) formData.append('override_reason', editForm.override_reason)
    if (editForm.capacity_override) {
      formData.append('capacity_override', 'true')
      if (editForm.capacity_override_reason) formData.append('capacity_override_reason', editForm.capacity_override_reason)
    }

    startMutation(async () => {
      const result = await updateParkingBookingDetails(selectedBooking.id, formData)
      if (result?.error) { toast.error(result.error); return }
      toast.success('Parking booking updated')
      setShowEditModal(false)
      resetEditForm()
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === selectedBooking.id)
      if (updated) { setSelectedBooking(updated); void loadNotifications(updated.id) }
    })
  }

  const handleConfirmCancelBooking = () => {
    if (!cancelTarget) return
    const target = cancelTarget
    setCancelTarget(null)
    handleStatusUpdate(target.id, 'cancelled')
  }

  const handleSaveRates = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData()
    formData.append('hourly_rate', rateForm.hourly_rate)
    formData.append('daily_rate', rateForm.daily_rate)
    formData.append('weekly_rate', rateForm.weekly_rate)
    formData.append('monthly_rate', rateForm.monthly_rate)
    if (rateForm.capacity_override) formData.append('capacity_override', rateForm.capacity_override)
    if (rateForm.notes) formData.append('notes', rateForm.notes)

    startMutation(async () => {
      const result = await saveParkingRateConfig(formData)
      if (result?.error) { toast.error(result.error); return }
      if (!result?.success) { toast.error('Failed to save parking rates'); return }
      const savedRate = result.data
      toast.success('Parking rates updated')
      setActiveRateRecord(savedRate)
      setActiveRates(parkingRateConfigFromRecord(savedRate))
      setRateForm(rateFormFromRecord(savedRate))
    })
  }

  const handleGeneratePaymentLink = (bookingId: string) => {
    startMutation(async () => {
      const result = await generateParkingPaymentLink(bookingId)
      if (result?.error) { toast.error(result.error); return }
      if (result?.approveUrl) {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(result.approveUrl)
            toast.success('Payment link copied to clipboard')
          } else { toast.success('Payment link generated') }
        } catch { toast.success('Payment link generated') }
      }
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) { setSelectedBooking(updated); void loadNotifications(updated.id) }
    })
  }

  const handleMarkPaid = (bookingId: string) => {
    startMutation(async () => {
      const result = await markParkingBookingPaid(bookingId)
      if (result?.error) { toast.error(result.error); return }
      toast.success('Booking marked as paid')
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) { setSelectedBooking(updated); void loadNotifications(updated.id) }
    })
  }

  const handleStatusUpdate = (bookingId: string, status: ParkingBookingStatus, paymentStatus?: ParkingPaymentStatus) => {
    startMutation(async () => {
      const result = await updateParkingBookingStatus(bookingId, {
        status,
        ...(paymentStatus ? { payment_status: paymentStatus } : {}),
      })
      if (result?.error) { toast.error(result.error); return }
      toast.success('Booking updated')
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) { setSelectedBooking(updated); void loadNotifications(updated.id) }
    })
  }

  const loadNotifications = async (bookingId: string) => {
    setLoadingNotifications(true)
    setNotificationsError(null)
    try {
      const result = await getParkingBookingNotifications(bookingId)
      if (!result || 'error' in result) {
        const message = result?.error || 'Failed to load notifications'
        toast.error(message)
        setNotificationsError(message)
        setNotifications([])
        return
      }
      setNotifications(result.data as ParkingNotificationRecord[])
    } catch {
      const message = 'Failed to load notifications'
      toast.error(message)
      setNotificationsError(message)
      setNotifications([])
    } finally {
      setLoadingNotifications(false)
    }
  }

  // Shared select handler for both the desktop table row and the mobile card.
  const handleSelectBooking = (booking: ParkingBooking) => {
    setSelectedBooking(booking)
    setRefundPaymentId(null)
    void loadNotifications(booking.id)
    // 'refunded' is included so an already-refunded booking still shows its
    // refund history instead of an empty panel.
    if (permissions.canRefund && ['paid', 'refunded'].includes(booking.payment_status)) {
      void loadRefundSummary(booking.id)
    }
  }

  /* ---------- Derived data ---------- */

  const upcomingCount = useMemo(() => bookings.filter((b) => new Date(b.start_at) > new Date() && ['pending_payment', 'confirmed'].includes(b.status)).length, [bookings])
  const pendingPaymentCount = useMemo(() => bookings.filter((b) => b.payment_status === 'pending').length, [bookings])

  /* ---------- Render ---------- */

  return (
    <PageLayout
      title="Parking"
      // No count while the list failed to load: "0 bookings total" would be a claim, not a fact.
      subtitle={loadError ? undefined : `${bookings.length} booking${bookings.length !== 1 ? 's' : ''} total`}
      headerActions={
        <>
          <Button variant="secondary" size="sm" onClick={() => void fetchBookings()} disabled={loading}>
            Refresh
          </Button>
          {permissions.canCreate && (
            <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>New Booking</Button>
          )}
        </>
      }
    >
      {pageError && <Alert tone="danger" title="We couldn't load everything">{pageError}</Alert>}

      {/* After a failed load the figures would all read 0. The bookings card shows the alert
          that explains the gap instead. */}
      {!loadError && (
        <StatGrid columns={3}>
          <Stat label="Total Bookings" value={bookings.length} />
          <Stat label="Upcoming" value={upcomingCount} />
          <Stat
            label="Pending Payments"
            value={pendingPaymentCount}
            tone={pendingPaymentCount > 0 ? 'warning' : 'default'}
            hint={pendingPaymentCount > 0 ? 'Requires attention' : undefined}
          />
        </StatGrid>
      )}

      <Tabs aria-label="Parking sections" tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />

      {activeSection === 'bookings' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
          {/* Left: bookings table */}
          <Card>
            <CardHeader title="Bookings" />
            <CardBody className="flex flex-wrap items-end gap-3 border-b border-border">
              <SearchInput
                id="parking-search"
                aria-label="Search parking bookings"
                placeholder="Reference or customer"
                value={search}
                onChange={setSearch}
                debounceDelay={PARKING_SEARCH_DEBOUNCE_MS}
                className="w-full sm:w-64"
              />
              <Select aria-label="Filter by status" options={statusOptions} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
              <Select aria-label="Filter by payment" options={paymentStatusOptions} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} />
            </CardBody>
            {loading && bookings.length === 0 ? (
              <PageLoading inline label="Loading bookings" />
            ) : loadError ? (
              <CardBody>
                <Alert tone="danger" title="Bookings could not be loaded">
                  {loadError}
                  <div className="mt-3">
                    <Button type="button" variant="secondary" size="sm" onClick={() => void fetchBookings()}>
                      Try Again
                    </Button>
                  </div>
                </Alert>
              </CardBody>
            ) : bookings.length === 0 ? (
              search || statusFilter !== 'all' || paymentFilter !== 'all' ? (
                <Empty size="sm" title="No bookings match these filters" description="Clear the search or the filters to see every booking." />
              ) : (
                <Empty size="sm" title="No bookings yet" description="Bookings show here once they are made." />
              )
            ) : (
              <>
                {/* Desktop: full table */}
                <Table className="hidden md:block">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((booking) => (
                      <TableRow
                        key={booking.id}
                        className="cursor-pointer"
                        onClick={() => handleSelectBooking(booking)}
                      >
                        <TableCell className="font-medium">{booking.reference}</TableCell>
                        <TableCell>
                          <div onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
                            <CustomerLink
                              customerId={booking.customer_id ?? null}
                              name={`${booking.customer_first_name} ${booking.customer_last_name ?? ''}`.trim()}
                              fallback="Unknown Customer"
                            />
                          </div>
                        </TableCell>
                        <TableCell>{formatDateTime(booking.start_at)}</TableCell>
                        <TableCell>{formatDateTime(booking.end_at)}</TableCell>
                        <TableCell><Badge tone={PARKING_BOOKING_STATUS_TONE[booking.status]}>{PARKING_BOOKING_STATUS_LABEL[booking.status]}</Badge></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone={PARKING_PAYMENT_STATUS_TONE[booking.payment_status]}>{PARKING_PAYMENT_STATUS_LABEL[booking.payment_status]}</Badge>
                            <BalanceBadge booking={booking} />
                          </div>
                        </TableCell>
                        <TableCell>{formatCurrency(booking.override_price ?? booking.calculated_price ?? 0)}</TableCell>
                        <TableCell>{booking.payment_due_at ? formatDateTime(booking.payment_due_at) : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Mobile: stacked cards. Each card is one DS Button, restyled as a full-width
                    row, so the whole card selects the booking from the keyboard as well. */}
                <div className="divide-y divide-border md:hidden">
                  {bookings.map((booking) => (
                    <Button
                      key={booking.id}
                      type="button"
                      variant="ghost"
                      onClick={() => handleSelectBooking(booking)}
                      className={cn(
                        'h-auto w-full flex-col items-stretch justify-start gap-2 rounded-none border-0 px-4 py-3 text-left font-normal whitespace-normal focus-visible:shadow-ring-inset',
                        selectedBooking?.id === booking.id && 'bg-primary-soft',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-text-strong">{booking.reference}</span>
                        <span className="text-sm font-medium text-text">
                          {formatCurrency(booking.override_price ?? booking.calculated_price ?? 0)}
                        </span>
                      </div>
                      <div className="text-sm text-text">
                        {`${booking.customer_first_name} ${booking.customer_last_name ?? ''}`.trim() || 'Unknown Customer'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={PARKING_BOOKING_STATUS_TONE[booking.status]}>{PARKING_BOOKING_STATUS_LABEL[booking.status]}</Badge>
                        <Badge tone={PARKING_PAYMENT_STATUS_TONE[booking.payment_status]}>{PARKING_PAYMENT_STATUS_LABEL[booking.payment_status]}</Badge>
                        <BalanceBadge booking={booking} />
                      </div>
                      <dl className="space-y-1 text-xs text-text-muted">
                        <div className="flex justify-between gap-2">
                          <dt>Start</dt>
                          <dd className="text-right text-text">{formatDateTime(booking.start_at)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>End</dt>
                          <dd className="text-right text-text">{formatDateTime(booking.end_at)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Due</dt>
                          <dd className="text-right text-text">{booking.payment_due_at ? formatDateTime(booking.payment_due_at) : '-'}</dd>
                        </div>
                      </dl>
                    </Button>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Right: detail sidebar */}
          <div className="space-y-6">
            {selectedBooking ? (
              <>
                <Card>
                  <CardHeader title="Booking Details" action={<Button variant="ghost" size="sm" onClick={() => setSelectedBooking(null)}>Close</Button>} />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={1}
                      items={[
                        { key: 'reference', label: 'Reference', value: selectedBooking.reference },
                        {
                          key: 'customer',
                          label: 'Customer',
                          value: (
                            <CustomerLink
                              customerId={selectedBooking.customer_id ?? null}
                              name={`${selectedBooking.customer_first_name} ${selectedBooking.customer_last_name ?? ''}`.trim()}
                              fallback="Unknown Customer"
                            />
                          ),
                        },
                        { key: 'mobile', label: 'Mobile', value: selectedBooking.customer_mobile || '-' },
                        { key: 'email', label: 'Email', value: selectedBooking.customer_email || '-' },
                        {
                          key: 'vehicle',
                          label: 'Vehicle',
                          value: `${selectedBooking.vehicle_registration}${selectedBooking.vehicle_make ? ` - ${selectedBooking.vehicle_make}` : ''}${selectedBooking.vehicle_model ? ` ${selectedBooking.vehicle_model}` : ''}`,
                        },
                        { key: 'start', label: 'Start', value: formatDateTime(selectedBooking.start_at) },
                        { key: 'end', label: 'End', value: formatDateTime(selectedBooking.end_at) },
                        {
                          key: 'status',
                          label: 'Status',
                          value: (
                            <Badge tone={PARKING_BOOKING_STATUS_TONE[selectedBooking.status]}>
                              {PARKING_BOOKING_STATUS_LABEL[selectedBooking.status]}
                            </Badge>
                          ),
                        },
                        {
                          key: 'payment',
                          label: 'Payment',
                          value: (
                            <Badge tone={PARKING_PAYMENT_STATUS_TONE[selectedBooking.payment_status]}>
                              {PARKING_PAYMENT_STATUS_LABEL[selectedBooking.payment_status]}
                            </Badge>
                          ),
                        },
                        {
                          key: 'amount',
                          label: 'Price',
                          value: formatCurrency(selectedBooking.override_price ?? selectedBooking.calculated_price ?? 0),
                        },
                        ...(selectedBooking.override_price != null && selectedBooking.override_reason
                          ? [{ key: 'override', label: 'Agreed price note', value: selectedBooking.override_reason }]
                          : []),
                        ...(selectedBooking.balance && selectedBooking.balance.state !== 'none'
                          ? [
                              { key: 'paid', label: 'Paid', value: formatCurrency(selectedBooking.balance.paid) },
                              { key: 'refunded', label: 'Refunded', value: formatCurrency(selectedBooking.balance.refunded) },
                              {
                                key: 'balance',
                                label: 'Balance',
                                value: parkingBalanceLabel(selectedBooking.balance) ? (
                                  <BalanceBadge booking={selectedBooking} />
                                ) : (
                                  'Settled'
                                ),
                              },
                            ]
                          : []),
                        ...(selectedBooking.notes
                          ? [{
                              key: 'notes',
                              label: 'Notes',
                              // Notes keep the line breaks staff typed.
                              value: <span className="whitespace-pre-wrap">{selectedBooking.notes}</span>,
                            }]
                          : []),
                      ]}
                    />

                    {permissions.canManage && (
                      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => openEditBooking(selectedBooking)}>
                          Edit
                        </Button>
                        {(selectedBooking.status === 'pending_payment' || selectedBooking.status === 'confirmed') && (
                          <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => setShowChangeDates(true)}>
                            Change dates
                          </Button>
                        )}
                        {(selectedBooking.payment_status === 'pending' || selectedBooking.balance?.state === 'to_pay') && (
                          <>
                            <Button
                              size="sm"
                              disabled={isMutating}
                              loading={isMutating && mutatingAction === 'payment-link'}
                              onClick={() => { setMutatingAction('payment-link'); handleGeneratePaymentLink(selectedBooking.id) }}
                            >
                              {selectedBooking.balance?.state === 'to_pay'
                                ? `Payment link for ${formatCurrency(selectedBooking.balance.balance)}`
                                : 'Payment Link'}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isMutating}
                              loading={isMutating && mutatingAction === 'mark-paid'}
                              onClick={() => { setMutatingAction('mark-paid'); handleMarkPaid(selectedBooking.id) }}
                            >
                              {selectedBooking.balance?.state === 'to_pay'
                                ? `Mark ${formatCurrency(selectedBooking.balance.balance)} paid`
                                : 'Mark Paid'}
                            </Button>
                          </>
                        )}
                        {selectedBooking.status !== 'cancelled' && selectedBooking.status !== 'completed' && (
                          <Button variant="danger" size="sm" disabled={isMutating} onClick={() => setCancelTarget(selectedBooking)}>
                            Cancel Booking
                          </Button>
                        )}
                        {selectedBooking.status === 'confirmed' && new Date(selectedBooking.end_at) < new Date() && (
                          <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => handleStatusUpdate(selectedBooking.id, 'completed', 'paid')}>
                            Complete
                          </Button>
                        )}
                        {permissions.canRefund && selectedBooking.payment_status === 'paid' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isMutating}
                            onClick={() =>
                              selectedBooking.balance?.state === 'refund_due'
                                ? setShowRefundDue(true)
                                : openRefundForBooking(selectedBooking)
                            }
                          >
                            Refund
                          </Button>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>

                {['paid', 'refunded'].includes(selectedBooking.payment_status) && refundPaymentId && (
                  <Card>
                    <CardHeader title="Refund History" />
                    {refundPayments.length > 1 && (
                      <div className="px-4 pt-3">
                        <Select
                          label="Payment"
                          value={refundPaymentId}
                          onChange={(event) => void selectRefundPayment(event.target.value)}
                          options={refundPayments.map((payment) => ({
                            value: payment.paymentId,
                            label: `${payment.purpose === 'top_up' ? 'Extra payment' : 'First payment'}: ${formatCurrency(payment.amount)}${
                              payment.provider === 'manual' ? ' at the venue' : ' by PayPal'
                            }, ${formatCurrency(payment.refundable)} refundable`,
                          }))}
                        />
                        <p className="mt-1 text-xs text-text-muted">The Refund button refunds the payment chosen here.</p>
                      </div>
                    )}
                    <RefundHistoryTable key={refundHistoryKey} sourceType="parking" sourceId={refundPaymentId} />
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <Empty size="sm" title="No booking selected" description="Click a booking row to view details." />
              </Card>
            )}
          </div>
        </div>
      )}

      {activeSection === 'notifications' && (
        <Card>
          <CardHeader title="Notification History" action={
            <Button variant="secondary" size="sm" onClick={() => selectedBooking && void loadNotifications(selectedBooking.id)} loading={loadingNotifications} disabled={!selectedBooking}>
              Refresh
            </Button>
          } />
          {loadingNotifications ? (
            <PageLoading inline label="Loading notifications" />
          ) : notificationsError ? (
            <CardBody>
              <Alert tone="danger" title="Notifications could not be loaded">{notificationsError}</Alert>
            </CardBody>
          ) : notifications.length === 0 ? (
            selectedBooking ? (
              <Empty size="sm" title="No notifications yet" description="Texts and emails about this booking show here once sent." />
            ) : (
              <Empty size="sm" title="No booking selected" description="Select a booking on the Bookings tab to see its notifications." />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>{NOTIFICATION_CHANNEL_LABEL[n.channel] ?? n.channel}</TableCell>
                    <TableCell>{NOTIFICATION_EVENT_LABEL[n.event_type] ?? n.event_type.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Badge tone={messageDeliveryStatusTone(n.status)}>{messageDeliveryStatusLabel(n.status)}</Badge>
                    </TableCell>
                    <TableCell>{n.sent_at ? formatDateTime(n.sent_at) : '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {activeSection === 'rates' && permissions.canManage && (
        <Card>
          <CardHeader
            title="Parking Rates"
            subtitle={activeRateRecord ? `Active from ${formatDateTime(activeRateRecord.effective_from)}` : undefined}
          />
          <CardBody>
            <form onSubmit={handleSaveRates} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="Hourly rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rateForm.hourly_rate}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, hourly_rate: event.target.value }))}
                />
                <Input
                  label="Daily rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rateForm.daily_rate}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, daily_rate: event.target.value }))}
                />
                <Input
                  label="Weekly rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rateForm.weekly_rate}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, weekly_rate: event.target.value }))}
                />
                <Input
                  label="Monthly rate"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rateForm.monthly_rate}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, monthly_rate: event.target.value }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
                <Input
                  label="Capacity override"
                  type="number"
                  min="0"
                  step="1"
                  value={rateForm.capacity_override}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, capacity_override: event.target.value }))}
                />
                <Textarea
                  label="Notes"
                  value={rateForm.notes}
                  onChange={(event) => setRateForm((prev) => ({ ...prev, notes: event.target.value }))}
                  rows={2}
                />
              </div>
              <FormFooter>
                <Button type="submit" variant="primary" loading={isMutating}>
                  Save Rates
                </Button>
              </FormFooter>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Create Booking Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }}
        title="New Booking"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }}>Cancel</Button>
            <Button type="submit" form="parking-create-form" variant="primary" loading={isPending}>Create Booking</Button>
          </>
        }
      >
        <form id="parking-create-form" onSubmit={handleCreateBooking} className="flex flex-col gap-5">
          {/* Each group keeps its fieldset, and its legend is a real sub-heading (h3 under the
              dialog's h2 title), so both the group and the heading reach a screen reader. */}
          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Customer</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" required value={createForm.customer_first_name} onChange={(e) => handleInputChange('customer_first_name', e.target.value)} />
              <Input label="Last name" value={createForm.customer_last_name} onChange={(e) => handleInputChange('customer_last_name', e.target.value)} />
              <Input label="Mobile" required placeholder="+447700900123" value={createForm.customer_mobile} onChange={(e) => handleInputChange('customer_mobile', e.target.value)} />
              <Input label="Email" type="email" value={createForm.customer_email} onChange={(e) => handleInputChange('customer_email', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Schedule</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Start" type="datetime-local" required value={createForm.start_at} onChange={(e) => handleInputChange('start_at', e.target.value)} />
              <Input label="End" type="datetime-local" required value={createForm.end_at} onChange={(e) => handleInputChange('end_at', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Vehicle</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Registration" required placeholder="AB12CDE" value={createForm.vehicle_registration} onChange={(e) => handleInputChange('vehicle_registration', e.target.value.toUpperCase())} />
              <Input label="Make" value={createForm.vehicle_make} onChange={(e) => handleInputChange('vehicle_make', e.target.value)} />
              <Input label="Model" value={createForm.vehicle_model} onChange={(e) => handleInputChange('vehicle_model', e.target.value)} />
              <Input label="Colour" value={createForm.vehicle_colour} onChange={(e) => handleInputChange('vehicle_colour', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Pricing</SubHeading></legend>
            {pricingPreview && (
              <Alert tone="info" role="status" title={`Estimated price: ${formatCurrency(pricingPreview.total)}`}>
                <p>Covers {formatDuration(pricingPreview.durationMinutes)}</p>
                <ul className="mt-1 list-disc pl-5">
                  {pricingPreview.breakdown.map((line, i) => (
                    <li key={`${line.unit}-${i}`}>{line.quantity} x {line.unit}(s) @ {formatCurrency(line.rate)} = {formatCurrency(line.subtotal)}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {pricingError && <Alert tone="danger" size="sm">{pricingError}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Override price" type="number" min="0" step="0.01" value={createForm.override_price} onChange={(e) => handleInputChange('override_price', e.target.value)} />
              <Input label="Override reason" value={createForm.override_reason} onChange={(e) => handleInputChange('override_reason', e.target.value)} />
            </div>
            <Switch label="Bypass capacity check" checked={createForm.capacity_override} onChange={(v) => handleInputChange('capacity_override', v)} />
            {createForm.capacity_override && (
              <Textarea label="Capacity override reason" required value={createForm.capacity_override_reason} onChange={(e) => handleInputChange('capacity_override_reason', e.target.value)} />
            )}
            <Textarea label="Internal notes" value={createForm.notes} onChange={(e) => handleInputChange('notes', e.target.value)} />
            <Switch label="Send payment link now" checked={createForm.send_payment_link} onChange={(v) => handleInputChange('send_payment_link', v)} />
          </fieldset>
        </form>
      </Modal>

      <Modal
        open={showEditModal}
        onClose={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }}
        title="Edit Parking Booking"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }}>Cancel</Button>
            <Button type="submit" form="parking-edit-form" variant="primary" loading={isMutating}>Save Changes</Button>
          </>
        }
      >
        <form id="parking-edit-form" onSubmit={handleEditBooking} className="flex flex-col gap-5">
          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Customer</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" required value={editForm.customer_first_name} onChange={(e) => handleEditInputChange('customer_first_name', e.target.value)} />
              <Input label="Last name" value={editForm.customer_last_name} onChange={(e) => handleEditInputChange('customer_last_name', e.target.value)} />
              <Input label="Mobile" required placeholder="+447700900123" value={editForm.customer_mobile} onChange={(e) => handleEditInputChange('customer_mobile', e.target.value)} />
              <Input label="Email" type="email" value={editForm.customer_email} onChange={(e) => handleEditInputChange('customer_email', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Vehicle</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Registration" required placeholder="AB12CDE" value={editForm.vehicle_registration} onChange={(e) => handleEditInputChange('vehicle_registration', e.target.value.toUpperCase())} />
              <Input label="Make" value={editForm.vehicle_make} onChange={(e) => handleEditInputChange('vehicle_make', e.target.value)} />
              <Input label="Model" value={editForm.vehicle_model} onChange={(e) => handleEditInputChange('vehicle_model', e.target.value)} />
              <Input label="Colour" value={editForm.vehicle_colour} onChange={(e) => handleEditInputChange('vehicle_colour', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend><SubHeading as="h3">Pricing</SubHeading></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Override price" type="number" min="0" step="0.01" value={editForm.override_price} onChange={(e) => handleEditInputChange('override_price', e.target.value)} />
              <Input label="Override reason" value={editForm.override_reason} onChange={(e) => handleEditInputChange('override_reason', e.target.value)} />
            </div>
            <Switch label="Bypass capacity check" checked={editForm.capacity_override} onChange={(v) => handleEditInputChange('capacity_override', v)} />
            {editForm.capacity_override && (
              <Textarea label="Capacity override reason" required value={editForm.capacity_override_reason} onChange={(e) => handleEditInputChange('capacity_override_reason', e.target.value)} />
            )}
            <Textarea label="Internal notes" value={editForm.notes} onChange={(e) => handleEditInputChange('notes', e.target.value)} />
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelBooking}
        tone="danger"
        title="Cancel Booking"
        message={cancelTarget ? `Cancel parking booking ${cancelTarget.reference}?` : 'Cancel this parking booking?'}
        confirmLabel="Cancel Booking"
        cancelLabel="Keep Booking"
      />

      {selectedBooking && (
        <ChangeDatesDialog
          open={showChangeDates}
          booking={selectedBooking}
          onClose={() => setShowChangeDates(false)}
          onChanged={async () => {
            const bookingId = selectedBooking.id
            const latest = await fetchBookings()
            const updated = latest.find((b) => b.id === bookingId)
            if (updated) { setSelectedBooking(updated); void loadNotifications(updated.id) }
            if (permissions.canRefund) void loadRefundSummary(bookingId)
            setRefundHistoryKey((key) => key + 1)
          }}
        />
      )}

      {selectedBooking && selectedBooking.balance?.state === 'refund_due' && (
        <RefundDueDialog
          open={showRefundDue}
          bookingId={selectedBooking.id}
          reference={selectedBooking.reference}
          due={Math.abs(selectedBooking.balance.balance)}
          onClose={() => setShowRefundDue(false)}
          onSettled={handleRefundProcessed}
        />
      )}

      {/* Refund Dialog */}
      {permissions.canRefund && refundPaymentId && (
        <RefundDialog
          open={showRefundDialog}
          onOpenChange={setShowRefundDialog}
          sourceType="parking"
          sourceId={refundPaymentId}
          originalAmount={refundPaymentAmount}
          totalRefunded={refundTotals.totalRefunded}
          totalPending={refundTotals.totalPending}
          hasPayPalCapture={refundHasCapture}
          captureExpired={false}
          onRefunded={handleRefundProcessed}
        />
      )}
    </PageLayout>
  )
}

/** "£X to pay" or "£X refund to do" beside the payment badge, or nothing when settled. */
function BalanceBadge({ booking }: { booking: ParkingBooking }) {
  const label = parkingBalanceLabel(booking.balance)
  if (!label || !booking.balance) return null
  return <Badge tone={booking.balance.state === 'to_pay' ? 'warning' : 'info'}>{label}</Badge>
}
