'use client'

import { useEffect, useMemo, useState, useTransition, type MouseEvent } from 'react'
import {
  formatDateTime,
  parseLondonDateTimeLocal,
  parseLondonDateTimeLocalToIso,
  toLondonDateTimeLocalValue,
} from '@/lib/dateUtils'
import { toast } from '@/ds'
import {
  PageHeader, Card, CardHeader, CardBody, SectionNav,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  CustomerLink,
} from '@/ds'
import {
  Button, Badge, SearchInput, Select, Stat, Spinner, Alert,
  Modal, Input, Textarea, Switch, Dropdown, DropdownItem, Empty, ConfirmDialog,
} from '@/ds'
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

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const statusBadgeTone: Record<ParkingBookingStatus, BadgeTone> = {
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'danger',
  expired: 'neutral',
}

const paymentBadgeTone: Record<ParkingPaymentStatus, BadgeTone> = {
  pending: 'warning',
  paid: 'success',
  refunded: 'info',
  failed: 'danger',
  expired: 'neutral',
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

export default function ParkingClient({ permissions, initialError }: Props) {
  const [bookings, setBookings] = useState<ParkingBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBooking, setSelectedBooking] = useState<ParkingBooking | null>(null)
  const [notifications, setNotifications] = useState<ParkingNotificationRecord[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)
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

  /* ---------- SectionNav ---------- */
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
        toast.error(result?.error || 'Failed to load parking bookings')
        setBookings([])
        return []
      }
      records = result.data
      setBookings(records)
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

  const openRefundForBooking = async (booking: ParkingBooking) => {
    try {
      const { getParkingPaymentForRefund, getRefundHistory } = await import('@/app/actions/refundActions')
      const paymentResult = await getParkingPaymentForRefund(booking.id)
      if (paymentResult.error || !paymentResult.data) {
        toast.error(paymentResult.error || 'No paid payment record found.')
        return
      }
      setRefundPaymentId(paymentResult.data.paymentId)
      setRefundPaymentAmount(paymentResult.data.amount)
      setRefundHasCapture(paymentResult.data.hasCapture)
      const result = await getRefundHistory('parking', paymentResult.data.paymentId)
      if (result.data) {
        const completed = result.data.filter((r: Record<string, unknown>) => r.status === 'completed').reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.amount), 0)
        const pending = result.data.filter((r: Record<string, unknown>) => r.status === 'pending').reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.amount), 0)
        setRefundTotals({ totalRefunded: completed, totalPending: pending })
      }
      setShowRefundDialog(true)
    } catch {
      toast.error('Failed to load payment details for refund.')
    }
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
    if (createForm.send_payment_link) formData.append('send_payment_link', 'true')

    startTransition(async () => {
      const result = await createParkingBooking(formData)
      if (result?.error) { toast.error(result.error); return }
      toast.success('Parking booking created successfully')
      if (result?.paymentLink) toast.info('Payment link generated. Copy it from the booking details.')
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
    try {
      const result = await getParkingBookingNotifications(bookingId)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to load notifications')
        setNotifications([])
        return
      }
      setNotifications(result.data as ParkingNotificationRecord[])
    } finally {
      setLoadingNotifications(false)
    }
  }

  /* ---------- Derived data ---------- */

  const upcomingCount = useMemo(() => bookings.filter((b) => new Date(b.start_at) > new Date() && ['pending_payment', 'confirmed'].includes(b.status)).length, [bookings])
  const pendingPaymentCount = useMemo(() => bookings.filter((b) => b.payment_status === 'pending').length, [bookings])

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Parking' }]}
        title="Parking"
        subtitle={`${bookings.length} booking${bookings.length !== 1 ? 's' : ''} total`}
        className="mb-0"
        actions={
          permissions.canCreate ? (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>New Booking</Button>
          ) : undefined
        }
      />

      {pageError && <Alert tone="danger" title="We couldn't load everything">{pageError}</Alert>}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardBody><Stat label="Total Bookings" value={bookings.length} /></CardBody></Card>
        <Card><CardBody><Stat label="Upcoming" value={upcomingCount} /></CardBody></Card>
        <Card><CardBody><Stat label="Pending Payments" value={pendingPaymentCount} hint={pendingPaymentCount > 0 ? 'Requires attention' : undefined} /></CardBody></Card>
      </div>

      <SectionNav items={sections} activeId={activeSection} onSelect={setActiveSection} />

      {activeSection === 'bookings' && (
        <div className="grid grid-cols-[1fr_320px] gap-6">
          {/* Left: bookings table */}
          <Card>
            <CardHeader title="Bookings" action={<Button variant="secondary" size="sm" onClick={() => void fetchBookings()} disabled={loading}>Refresh</Button>}>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <SearchInput placeholder="Reference or customer" value={search} onChange={setSearch} className="w-64" />
                <Select options={statusOptions} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
                <Select options={paymentStatusOptions} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} />
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {loading && bookings.length === 0 ? (
                <div className="flex items-center justify-center py-12"><Spinner size="md" /></div>
              ) : bookings.length === 0 ? (
                <Empty title="No bookings" description="No bookings found for the current filters." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
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
                          onClick={() => {
                            setSelectedBooking(booking)
                            setRefundPaymentId(null)
                            void loadNotifications(booking.id)
                            if (booking.payment_status === 'paid' && permissions.canRefund) {
                              import('@/app/actions/refundActions').then(({ getParkingPaymentForRefund }) =>
                                getParkingPaymentForRefund(booking.id).then((res) => {
                                  if (res.data) {
                                    setRefundPaymentId(res.data.paymentId)
                                    setRefundPaymentAmount(res.data.amount)
                                    setRefundHasCapture(res.data.hasCapture)
                                  }
                                })
                              )
                            }
                          }}
                        >
                          <TableCell className="font-medium">{booking.reference}</TableCell>
                          <TableCell>
                            <div onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
                              <CustomerLink
                                customerId={booking.customer_id ?? null}
                                name={`${booking.customer_first_name} ${booking.customer_last_name ?? ''}`.trim()}
                                fallback="Unknown Customer"
                                className="text-blue-600 hover:text-blue-700"
                              />
                            </div>
                          </TableCell>
                          <TableCell>{formatDateTime(booking.start_at)}</TableCell>
                          <TableCell>{formatDateTime(booking.end_at)}</TableCell>
                          <TableCell><Badge tone={statusBadgeTone[booking.status]}>{booking.status.replace('_', ' ')}</Badge></TableCell>
                          <TableCell><Badge tone={paymentBadgeTone[booking.payment_status]}>{booking.payment_status}</Badge></TableCell>
                          <TableCell>{formatCurrency(booking.override_price ?? booking.calculated_price ?? 0)}</TableCell>
                          <TableCell>{booking.payment_due_at ? formatDateTime(booking.payment_due_at) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Right: detail sidebar */}
          <div className="space-y-4">
            {selectedBooking ? (
              <>
                <Card>
                  <CardHeader title="Booking Details" action={<Button variant="ghost" size="sm" onClick={() => setSelectedBooking(null)}>Close</Button>} />
                  <CardBody className="space-y-3">
                    <DetailRow label="Reference" value={selectedBooking.reference} />
                    <DetailRow
                      label="Customer"
                      value={
                        <CustomerLink
                          customerId={selectedBooking.customer_id ?? null}
                          name={`${selectedBooking.customer_first_name} ${selectedBooking.customer_last_name ?? ''}`.trim()}
                          fallback="Unknown Customer"
                          className="text-blue-600 hover:text-blue-700"
                        />
                      }
                    />
                    <DetailRow label="Mobile" value={selectedBooking.customer_mobile} />
                    <DetailRow label="Email" value={selectedBooking.customer_email ?? '—'} />
                    <DetailRow label="Vehicle" value={`${selectedBooking.vehicle_registration}${selectedBooking.vehicle_make ? ` - ${selectedBooking.vehicle_make}` : ''}${selectedBooking.vehicle_model ? ` ${selectedBooking.vehicle_model}` : ''}`} />
                    <DetailRow label="Start" value={formatDateTime(selectedBooking.start_at)} />
                    <DetailRow label="End" value={formatDateTime(selectedBooking.end_at)} />
                    <DetailRow label="Status" value={<Badge tone={statusBadgeTone[selectedBooking.status]}>{selectedBooking.status.replace('_', ' ')}</Badge>} />
                    <DetailRow label="Payment" value={<Badge tone={paymentBadgeTone[selectedBooking.payment_status]}>{selectedBooking.payment_status}</Badge>} />
                    <DetailRow label="Amount" value={formatCurrency(selectedBooking.override_price ?? selectedBooking.calculated_price ?? 0)} />

                    {selectedBooking.notes && (
                      <div className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-muted">
                        <strong className="block text-text">Notes</strong>
                        <span className="mt-1 block whitespace-pre-wrap">{selectedBooking.notes}</span>
                      </div>
                    )}

                    {permissions.canManage && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
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

                {selectedBooking.payment_status === 'paid' && refundPaymentId && (
                  <Card>
                    <CardHeader title="Refund History" />
                    <CardBody className="p-0">
                      <RefundHistoryTable sourceType="parking" sourceId={refundPaymentId} />
                    </CardBody>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardBody>
                  <Empty title="No booking selected" description="Click a booking row to view details." />
                </CardBody>
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
          <CardBody className="p-0">
            {loadingNotifications ? (
              <div className="flex items-center justify-center py-8"><Spinner size="md" /></div>
            ) : notifications.length === 0 ? (
              <Empty title="No notifications" description={selectedBooking ? 'No notification history yet.' : 'Select a booking first to view notifications.'} />
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
                      <TableCell>{n.sent_at ? formatDateTime(n.sent_at) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {activeSection === 'rates' && permissions.canManage && (
        <Card>
          <CardHeader
            title="Parking Rates"
            subtitle={activeRateRecord ? `Active from ${formatDateTime(activeRateRecord.effective_from)}` : undefined}
          />
          <CardBody>
            <form onSubmit={handleSaveRates} className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
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
              <div className="flex justify-end">
                <Button type="submit" disabled={isMutating}>
                  {isMutating ? 'Saving...' : 'Save Rates'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Create Booking Modal */}
      <Modal open={showCreateModal} onClose={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }} title="Create Parking Booking">
        <form onSubmit={handleCreateBooking} className="flex flex-col gap-5 p-4">
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
              <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text-strong">Estimated price</span>
                  <span className="text-base font-semibold">{formatCurrency(pricingPreview.total)}</span>
                </div>
                <p className="mt-2 text-text-muted">
                  Covers {formatDuration(pricingPreview.durationMinutes)}
                </p>
                <ul className="list-disc pl-5 mt-1 text-text-muted">
                  {pricingPreview.breakdown.map((line, i) => (
                    <li key={`${line.unit}-${i}`}>{line.quantity} x {line.unit}(s) @ {formatCurrency(line.rate)} = {formatCurrency(line.subtotal)}</li>
                  ))}
                </ul>
              </div>
            )}
            {pricingError && <p className="text-sm text-danger">{pricingError}</p>}
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

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => { if (!isPending) { setShowCreateModal(false); resetForm() } }}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'Creating...' : 'Create Booking'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={showEditModal} onClose={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }} title="Edit Parking Booking">
        <form onSubmit={handleEditBooking} className="flex flex-col gap-5 p-4">
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

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => { if (!isMutating) { setShowEditModal(false); resetEditForm() } }}>Cancel</Button>
            <Button type="submit" disabled={isMutating}>{isMutating ? 'Saving...' : 'Save Booking'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancelBooking}
        type="warning"
        title="Cancel parking booking?"
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
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail row helper                                                  */
/* ------------------------------------------------------------------ */

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide shrink-0">{label}</span>
      <span className="text-sm text-text text-right">{value ?? '—'}</span>
    </div>
  )
}
