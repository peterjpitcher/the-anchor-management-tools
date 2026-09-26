'use client'

import { useEffect, useMemo, useState, useTransition, type MouseEvent } from 'react'
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
import { PARKING_BOOKING_STATUS_TONE, PARKING_PAYMENT_STATUS_TONE } from '../_shared/status-ui'
import { RefundDialog } from './RefundDialog'
import { RefundHistoryTable } from './RefundHistoryTable'
import type {
  ParkingBooking,
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
  getParkingRateConfig,
  getParkingRateSettings,
  saveParkingRateConfig
} from '@/app/actions/parking'
import type { ParkingRateConfig } from '@/lib/parking/pricing'
import type { ParkingRate } from '@/types/parking'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParkingPermissions {
  canCreate: boolean
  canManage: boolean
  canRefund: boolean
}

interface Props {
  permissions: ParkingPermissions
  initialError?: string | null
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
]

const paymentStatusOptions = [
  { value: 'all', label: 'All payment states' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' },
]

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

export default function ParkingClient({ permissions, initialError }: Props) {
  const [bookings, setBookings] = useState<ParkingBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBooking, setSelectedBooking] = useState<ParkingBooking | null>(null)
  // A failed load is shown as a failure, never as "No bookings": an empty list after an outage
  // reads as a quiet day rather than a broken request.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<ParkingNotificationRecord[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [activeRates, setActiveRates] = useState<ParkingRateConfig | null>(null)
  const [pricingPreview, setPricingPreview] = useState<ParkingPricingResult | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [createForm, setCreateForm] = useState(initialFormState)
  const [editForm, setEditForm] = useState(initialFormState)
  const [cancelTarget, setCancelTarget] = useState<ParkingBooking | null>(null)
  const [activeRateRecord, setActiveRateRecord] = useState<ParkingRate | null>(null)
  const [rateForm, setRateForm] = useState({
    hourly_rate: '',
    daily_rate: '',
    weekly_rate: '',
    monthly_rate: '',
    capacity_override: '',
    notes: '',
  })
  const [isPending, startTransition] = useTransition()
  const [isMutating, startMutation] = useTransition()
  const pageError = initialError ?? null

  // Refund state
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null)
  const [refundPaymentAmount, setRefundPaymentAmount] = useState(0)
  const [refundTotals, setRefundTotals] = useState({ totalRefunded: 0, totalPending: 0 })
  const [refundHasCapture, setRefundHasCapture] = useState(false)
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

  useEffect(() => { void fetchBookings() }, [statusFilter, paymentFilter, search])

  useEffect(() => {
    if (!permissions.canManage) return
    const loadRates = async () => {
      const result = await getParkingRateConfig()
      if (!result || 'error' in result) {
        toast.error((result && 'error' in result ? result.error : undefined) || 'Unable to load parking rates')
        setActiveRates(null)
        return
      }
      setActiveRates(result.data)
      const settings = await getParkingRateSettings()
      if ('success' in settings) {
        setActiveRateRecord(settings.data)
        setRateForm({
          hourly_rate: String(settings.data.hourly_rate),
          daily_rate: String(settings.data.daily_rate),
          weekly_rate: String(settings.data.weekly_rate),
          monthly_rate: String(settings.data.monthly_rate),
          capacity_override: settings.data.capacity_override == null ? '' : String(settings.data.capacity_override),
          notes: settings.data.notes ?? '',
        })
      }
    }
    void loadRates()
  }, [permissions.canManage])

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
  const loadRefundSummary = async (bookingId: string): Promise<string | null> => {
    try {
      const { getParkingPaymentForRefund, getRefundHistory } = await import('@/app/actions/refundActions')
      const paymentResult = await getParkingPaymentForRefund(bookingId)
      if (paymentResult.error || !paymentResult.data) {
        setRefundPaymentId(null)
        return paymentResult.error || 'No paid payment record found.'
      }
      setRefundPaymentId(paymentResult.data.paymentId)
      setRefundPaymentAmount(paymentResult.data.amount)
      setRefundHasCapture(paymentResult.data.hasCapture)

      const history = await getRefundHistory('parking', paymentResult.data.paymentId)
      const rows = (history.data ?? []) as Record<string, unknown>[]
      const completed = rows.filter((r) => r.status === 'completed').reduce((sum, r) => sum + Number(r.amount), 0)
      const pending = rows.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.amount), 0)
      setRefundTotals({ totalRefunded: completed, totalPending: pending })
      return null
    } catch {
      return 'Failed to load payment details for refund.'
    }
  }

  const openRefundForBooking = async (booking: ParkingBooking) => {
    const error = await loadRefundSummary(booking.id)
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
    await loadRefundSummary(bookingId)
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

    const start = parseLondonDateTimeLocalToIso(editForm.start_at)
    const end = parseLondonDateTimeLocalToIso(editForm.end_at)
    if (!start || !end) { toast.error('Start and end times are required'); return }

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
    formData.append('start_at', start)
    formData.append('end_at', end)
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
      setActiveRates({
        hourlyRate: Number(savedRate.hourly_rate),
        dailyRate: Number(savedRate.daily_rate),
        weeklyRate: Number(savedRate.weekly_rate),
        monthlyRate: Number(savedRate.monthly_rate),
      })
      setRateForm({
        hourly_rate: String(savedRate.hourly_rate),
        daily_rate: String(savedRate.daily_rate),
        weekly_rate: String(savedRate.weekly_rate),
        monthly_rate: String(savedRate.monthly_rate),
        capacity_override: savedRate.capacity_override == null ? '' : String(savedRate.capacity_override),
        notes: savedRate.notes ?? '',
      })
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

      {/* On a failed load the figures would all read 0, so the alert in the bookings card
          explains the gap instead. */}
      {!loadError && (
        <StatGrid columns={3}>
          <Stat label="Total Bookings" value={bookings.length} />
          <Stat label="Upcoming" value={upcomingCount} />
          <Stat label="Pending Payments" value={pendingPaymentCount} hint={pendingPaymentCount > 0 ? 'Requires attention' : undefined} />
        </StatGrid>
      )}

      <Tabs tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />

      {activeSection === 'bookings' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
          {/* Left: bookings table */}
          <Card>
            <CardHeader title="Bookings" />
            <CardBody className="flex flex-wrap items-end gap-3 border-b border-border">
              <SearchInput placeholder="Reference or customer" value={search} onChange={setSearch} className="w-full sm:w-64" />
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
                      Try again
                    </Button>
                  </div>
                </Alert>
              </CardBody>
            ) : bookings.length === 0 ? (
              <Empty size="sm" title="No bookings" description="No bookings found for the current filters." />
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
                        <TableCell><Badge tone={PARKING_BOOKING_STATUS_TONE[booking.status]}>{booking.status.replace('_', ' ')}</Badge></TableCell>
                        <TableCell><Badge tone={PARKING_PAYMENT_STATUS_TONE[booking.payment_status]}>{booking.payment_status}</Badge></TableCell>
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
                        <Badge tone={PARKING_BOOKING_STATUS_TONE[booking.status]}>{booking.status.replace('_', ' ')}</Badge>
                        <Badge tone={PARKING_PAYMENT_STATUS_TONE[booking.payment_status]}>{booking.payment_status}</Badge>
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
                              {selectedBooking.status.replace('_', ' ')}
                            </Badge>
                          ),
                        },
                        {
                          key: 'payment',
                          label: 'Payment',
                          value: (
                            <Badge tone={PARKING_PAYMENT_STATUS_TONE[selectedBooking.payment_status]}>
                              {selectedBooking.payment_status}
                            </Badge>
                          ),
                        },
                        {
                          key: 'amount',
                          label: 'Amount',
                          value: formatCurrency(selectedBooking.override_price ?? selectedBooking.calculated_price ?? 0),
                        },
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
                        {selectedBooking.payment_status === 'pending' && (
                          <>
                            <Button size="sm" disabled={isMutating} onClick={() => handleGeneratePaymentLink(selectedBooking.id)}>
                              {isMutating ? 'Generating...' : 'Payment Link'}
                            </Button>
                            <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => handleMarkPaid(selectedBooking.id)}>
                              {isMutating ? 'Updating...' : 'Mark Paid'}
                            </Button>
                          </>
                        )}
                        {selectedBooking.status !== 'cancelled' && selectedBooking.status !== 'completed' && (
                          <Button variant="ghost" size="sm" disabled={isMutating} onClick={() => setCancelTarget(selectedBooking)}>
                            Cancel
                          </Button>
                        )}
                        {selectedBooking.status === 'confirmed' && new Date(selectedBooking.end_at) < new Date() && (
                          <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => handleStatusUpdate(selectedBooking.id, 'completed', 'paid')}>
                            Complete
                          </Button>
                        )}
                        {permissions.canRefund && selectedBooking.payment_status === 'paid' && (
                          <Button variant="secondary" size="sm" disabled={isMutating} onClick={() => openRefundForBooking(selectedBooking)}>
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
            <Button variant="secondary" size="sm" onClick={() => selectedBooking && void loadNotifications(selectedBooking.id)} disabled={loadingNotifications || !selectedBooking}>
              {loadingNotifications ? 'Refreshing...' : 'Refresh'}
            </Button>
          } />
          {loadingNotifications ? (
            <PageLoading inline label="Loading notifications" />
          ) : notificationsError ? (
            <CardBody>
              <Alert tone="danger" title="Notifications could not be loaded">{notificationsError}</Alert>
            </CardBody>
          ) : notifications.length === 0 ? (
            <Empty size="sm" title="No notifications" description={selectedBooking ? 'No notification history yet.' : 'Select a booking first to view notifications.'} />
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
                    <TableCell className="capitalize">{n.channel}</TableCell>
                    <TableCell className="capitalize">{n.event_type.replace('_', ' ')}</TableCell>
                    <TableCell>{n.status}</TableCell>
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
                <Button type="submit" variant="primary" disabled={isMutating}>
                  {isMutating ? 'Saving...' : 'Save Rates'}
                </Button>
              </FormFooter>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Create Booking Modal */}
      <Modal open={showCreateModal} onClose={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }} title="Create Parking Booking">
        <form onSubmit={handleCreateBooking} className="flex flex-col gap-5">
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Customer</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" required value={createForm.customer_first_name} onChange={(e) => handleInputChange('customer_first_name', e.target.value)} />
              <Input label="Last name" value={createForm.customer_last_name} onChange={(e) => handleInputChange('customer_last_name', e.target.value)} />
              <Input label="Mobile" required placeholder="+447700900123" value={createForm.customer_mobile} onChange={(e) => handleInputChange('customer_mobile', e.target.value)} />
              <Input label="Email" type="email" value={createForm.customer_email} onChange={(e) => handleInputChange('customer_email', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Schedule</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Start" type="datetime-local" required value={createForm.start_at} onChange={(e) => handleInputChange('start_at', e.target.value)} />
              <Input label="End" type="datetime-local" required value={createForm.end_at} onChange={(e) => handleInputChange('end_at', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Vehicle</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Registration" required placeholder="AB12CDE" value={createForm.vehicle_registration} onChange={(e) => handleInputChange('vehicle_registration', e.target.value.toUpperCase())} />
              <Input label="Make" value={createForm.vehicle_make} onChange={(e) => handleInputChange('vehicle_make', e.target.value)} />
              <Input label="Model" value={createForm.vehicle_model} onChange={(e) => handleInputChange('vehicle_model', e.target.value)} />
              <Input label="Colour" value={createForm.vehicle_colour} onChange={(e) => handleInputChange('vehicle_colour', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Pricing</legend>
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

          <FormFooter>
            <Button type="button" variant="secondary" onClick={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending}>{isPending ? 'Creating...' : 'Create Booking'}</Button>
          </FormFooter>
        </form>
      </Modal>

      <Modal open={showEditModal} onClose={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }} title="Edit Parking Booking">
        <form onSubmit={handleEditBooking} className="flex flex-col gap-5">
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Customer</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" required value={editForm.customer_first_name} onChange={(e) => handleEditInputChange('customer_first_name', e.target.value)} />
              <Input label="Last name" value={editForm.customer_last_name} onChange={(e) => handleEditInputChange('customer_last_name', e.target.value)} />
              <Input label="Mobile" required placeholder="+447700900123" value={editForm.customer_mobile} onChange={(e) => handleEditInputChange('customer_mobile', e.target.value)} />
              <Input label="Email" type="email" value={editForm.customer_email} onChange={(e) => handleEditInputChange('customer_email', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Schedule</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Start" type="datetime-local" required value={editForm.start_at} onChange={(e) => handleEditInputChange('start_at', e.target.value)} />
              <Input label="End" type="datetime-local" required value={editForm.end_at} onChange={(e) => handleEditInputChange('end_at', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Vehicle</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Registration" required placeholder="AB12CDE" value={editForm.vehicle_registration} onChange={(e) => handleEditInputChange('vehicle_registration', e.target.value.toUpperCase())} />
              <Input label="Make" value={editForm.vehicle_make} onChange={(e) => handleEditInputChange('vehicle_make', e.target.value)} />
              <Input label="Model" value={editForm.vehicle_model} onChange={(e) => handleEditInputChange('vehicle_model', e.target.value)} />
              <Input label="Colour" value={editForm.vehicle_colour} onChange={(e) => handleEditInputChange('vehicle_colour', e.target.value)} />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-strong">Pricing</legend>
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

          <FormFooter>
            <Button type="button" variant="secondary" onClick={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isMutating}>{isMutating ? 'Saving...' : 'Save Booking'}</Button>
          </FormFooter>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelBooking}
        type="warning"
        title="Cancel Parking Booking?"
        message={cancelTarget ? `Cancel booking ${cancelTarget.reference}?` : 'Cancel this parking booking?'}
        confirmText="Cancel Booking"
        confirmVariant="danger"
      />

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
