'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { formatDateTime } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
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
  listParkingBookings,
  getParkingBookingNotifications,
  getParkingRateConfig
} from '@/app/actions/parking'
import type { ParkingRateConfig } from '@/lib/parking/pricing'

interface ParkingPermissions {
  canCreate: boolean
  canManage: boolean
  canRefund: boolean
}

interface Props {
  permissions: ParkingPermissions
  initialError?: string | null
}

const statusOptions: Array<{ value: 'all' | ParkingBookingStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' }
]

const paymentStatusOptions: Array<{ value: 'all' | ParkingPaymentStatus; label: string }> = [
  { value: 'all', label: 'All payment states' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' }
]

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary'

const statusVariants: Record<ParkingBookingStatus, BadgeVariant> = {
  pending_payment: 'warning',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'error',
  expired: 'default'
}

const paymentVariants: Record<ParkingPaymentStatus, BadgeVariant> = {
  pending: 'warning',
  paid: 'success',
  refunded: 'info',
  failed: 'error',
  expired: 'default'
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
  send_payment_link: true
}

export default function ParkingClient({ permissions, initialError }: Props) {
  const [bookings, setBookings] = useState<ParkingBooking[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedBooking, setSelectedBooking] = useState<ParkingBooking | null>(null)
  const [notifications, setNotifications] = useState<ParkingNotificationRecord[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [activeRates, setActiveRates] = useState<ParkingRateConfig | null>(null)
  const [pricingPreview, setPricingPreview] = useState<ParkingPricingResult | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | ParkingBookingStatus>('all')
  const [paymentFilter, setPaymentFilter] = useState<'all' | ParkingPaymentStatus>('all')
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false)
  const [createForm, setCreateForm] = useState(initialFormState)
  const [isPending, startTransition] = useTransition()
  const [isMutating, startMutation] = useTransition()
  const pageError = initialError ?? null

  useEffect(() => {
    void fetchBookings()
  }, [statusFilter, paymentFilter, search])

  useEffect(() => {
    if (!permissions.canManage) return

    const loadRates = async () => {
      const result = await getParkingRateConfig()
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Unable to load parking rates')
        setActiveRates(null)
        return
      }
      setActiveRates(result.data)
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
      const start = new Date(createForm.start_at)
      const end = new Date(createForm.end_at)
      const preview = calculateParkingPricing(start, end, activeRates)
      setPricingPreview(preview)
      setPricingError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate pricing'
      setPricingPreview(null)
      setPricingError(message)
    }
  }, [activeRates, createForm.start_at, createForm.end_at])

  const fetchBookings = async (): Promise<ParkingBooking[]> => {
    setLoading(true)
    let records: ParkingBooking[] = []
    try {
      const result = await listParkingBookings({
        status: statusFilter === 'all' ? undefined : statusFilter,
        paymentStatus: paymentFilter === 'all' ? undefined : paymentFilter,
        search: search || undefined
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

  const resetForm = () => {
    setCreateForm(initialFormState)
  }

  const handleInputChange = (field: keyof typeof initialFormState, value: string | boolean) => {
    setCreateForm((prev) => ({
      ...prev,
      [field]: value
    }))
  }

  const handleCreateBooking = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const start = createForm.start_at ? new Date(createForm.start_at) : null
    const end = createForm.end_at ? new Date(createForm.end_at) : null

    if (!start || !end) {
      toast.error('Start and end times are required')
      return
    }

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
    formData.append('start_at', start.toISOString())
    formData.append('end_at', end.toISOString())
    if (createForm.notes) formData.append('notes', createForm.notes)
    if (createForm.override_price) formData.append('override_price', createForm.override_price)
    if (createForm.override_reason) formData.append('override_reason', createForm.override_reason)
    if (createForm.capacity_override) {
      formData.append('capacity_override', 'true')
      if (createForm.capacity_override_reason) {
        formData.append('capacity_override_reason', createForm.capacity_override_reason)
      }
    }
    if (createForm.send_payment_link) {
      formData.append('send_payment_link', 'true')
    }

    startTransition(async () => {
      const result = await createParkingBooking(formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      toast.success('Parking booking created successfully')
      if (result?.paymentLink) {
        toast.info('Payment link generated. Copy it from the booking details.')
      }
      setShowCreateModal(false)
      resetForm()

      const latest = await fetchBookings()
      const created = latest.find((b) => b.id === (result?.booking as ParkingBooking | undefined)?.id)
      if (created) {
        setSelectedBooking(created)
      }
    })
  }

  const handleGeneratePaymentLink = (bookingId: string) => {
    startMutation(async () => {
      const result = await generateParkingPaymentLink(bookingId)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      if (result?.approveUrl) {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(result.approveUrl)
            toast.success('Payment link copied to clipboard')
          } else {
            toast.success('Payment link generated')
          }
        } catch (copyError) {
          console.warn('Unable to copy payment link', copyError)
          toast.success('Payment link generated')
        }
      }

      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) {
        setSelectedBooking(updated)
        void loadNotifications(updated.id)
      }
    })
  }

  const handleMarkPaid = (bookingId: string) => {
    startMutation(async () => {
      const result = await markParkingBookingPaid(bookingId)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      toast.success('Booking marked as paid')
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) {
        setSelectedBooking(updated)
        void loadNotifications(updated.id)
      }
    })
  }

  const handleStatusUpdate = (
    bookingId: string,
    status: ParkingBookingStatus,
    paymentStatus?: ParkingPaymentStatus
  ) => {
    startMutation(async () => {
      const result = await updateParkingBookingStatus(bookingId, {
        status,
        ...(paymentStatus ? { payment_status: paymentStatus } : {})
      })

      if (result?.error) {
        toast.error(result.error)
        return
      }

      toast.success('Booking updated')
      const latest = await fetchBookings()
      const updated = latest.find((b) => b.id === bookingId)
      if (updated) {
        setSelectedBooking(updated)
        void loadNotifications(updated.id)
      }
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

  const upcomingCount = useMemo(() => bookings.filter((b) => new Date(b.start_at) > new Date() && ['pending_payment', 'confirmed'].includes(b.status)).length, [bookings])
  const pendingPaymentCount = useMemo(() => bookings.filter((b) => b.payment_status === 'pending').length, [bookings])

  const navActions = permissions.canCreate ? (
    <Button size="sm" onClick={() => setShowCreateModal(true)}>
      New booking
    </Button>
  ) : undefined

  const showInitialLoading = loading && bookings.length === 0

  const renderBookingRow = (booking: ParkingBooking) => (
    <tr
      key={booking.id}
      className="cursor-pointer transition hover:bg-slate-50"
      onClick={() => {
        setSelectedBooking(booking)
        void loadNotifications(booking.id)
      }}
    >
      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">{booking.reference}</td>
      <td className="px-4 py-3 text-sm text-slate-700">
        {booking.customer_first_name} {booking.customer_last_name ?? ''}
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">{formatDateTime(booking.start_at)}</td>
      <td className="px-4 py-3 text-sm text-slate-700">{formatDateTime(booking.end_at)}</td>
      <td className="px-4 py-3 text-sm">
        <Badge variant={statusVariants[booking.status]}>{booking.status.replace('_', ' ')}</Badge>
      </td>
      <td className="px-4 py-3 text-sm">
        <Badge variant={paymentVariants[booking.payment_status]}>{booking.payment_status}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(booking.override_price ?? booking.calculated_price ?? 0)}</td>
      <td className="px-4 py-3 text-sm text-slate-500">{booking.payment_due_at ? formatDateTime(booking.payment_due_at) : '—'}</td>
    </tr>
  )

  const renderSelectedBooking = () => {
    if (!selectedBooking) return null

    const amount = selectedBooking.override_price ?? selectedBooking.calculated_price ?? 0
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailItem label="Reference" value={selectedBooking.reference} />
          <DetailItem label="Customer" value={`${selectedBooking.customer_first_name} ${selectedBooking.customer_last_name ?? ''}`} />
          <DetailItem label="Mobile" value={selectedBooking.customer_mobile} />
          <DetailItem label="Email" value={selectedBooking.customer_email ?? '—'} />
          <DetailItem label="Vehicle" value={`${selectedBooking.vehicle_registration}${selectedBooking.vehicle_make ? ` · ${selectedBooking.vehicle_make}` : ''}${selectedBooking.vehicle_model ? ` ${selectedBooking.vehicle_model}` : ''}`} />
          <DetailItem label="Colour" value={selectedBooking.vehicle_colour ?? '—'} />
          <DetailItem label="Start" value={formatDateTime(selectedBooking.start_at)} />
          <DetailItem label="End" value={formatDateTime(selectedBooking.end_at)} />
          <DetailItem label="Status" value={<Badge variant={statusVariants[selectedBooking.status]}>{selectedBooking.status.replace('_', ' ')}</Badge>} />
          <DetailItem label="Payment" value={<Badge variant={paymentVariants[selectedBooking.payment_status]}>{selectedBooking.payment_status}</Badge>} />
          <DetailItem label="Amount" value={formatCurrency(amount)} />
          <DetailItem label="Payment due" value={selectedBooking.payment_due_at ? formatDateTime(selectedBooking.payment_due_at) : '—'} />
          <DetailItem label="Created" value={formatDateTime(selectedBooking.created_at)} />
          <DetailItem label="Updated" value={formatDateTime(selectedBooking.updated_at)} />
        </div>

        {selectedBooking.notes && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <strong className="block text-slate-900">Notes</strong>
            <span className="mt-1 block whitespace-pre-wrap">{selectedBooking.notes}</span>
          </div>
        )}

        {permissions.canManage && (
          <div className="flex flex-wrap gap-3">
            {selectedBooking.payment_status === 'pending' && (
              <>
                <Button
                  variant="primary"
                  disabled={isMutating}
                  onClick={() => handleGeneratePaymentLink(selectedBooking.id)}
                >
                  {isMutating ? 'Generating…' : 'Generate payment link'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={isMutating}
                  onClick={() => handleMarkPaid(selectedBooking.id)}
                >
                  {isMutating ? 'Updating…' : 'Mark as paid'}
                </Button>
              </>
            )}

            {selectedBooking.status !== 'cancelled' && selectedBooking.status !== 'completed' && (
              <Button
                variant="ghost"
                disabled={isMutating}
                onClick={() => handleStatusUpdate(selectedBooking.id, 'cancelled')}
              >
                {isMutating ? 'Updating…' : 'Cancel booking'}
              </Button>
            )}

            {selectedBooking.status === 'confirmed' && new Date(selectedBooking.end_at) < new Date() && (
              <Button
                variant="secondary"
                disabled={isMutating}
                onClick={() => handleStatusUpdate(selectedBooking.id, 'completed', 'paid')}
              >
                {isMutating ? 'Updating…' : 'Mark completed'}
              </Button>
            )}
          </div>
        )}

        <Section title="Recent notifications" description="SMS and email attempts for this booking.">
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Channel</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Event</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Sent at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {loadingNotifications ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Spinner size="sm" />
                        <span>Loading notifications…</span>
                      </div>
                    </td>
                  </tr>
                ) : notifications.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      No notification history yet.
                    </td>
                  </tr>
                ) : (
                  notifications.map((notification) => (
                    <tr key={notification.id}>
                      <td className="px-3 py-2 text-sm capitalize text-slate-700">{notification.channel}</td>
                      <td className="px-3 py-2 text-sm capitalize text-slate-700">{notification.event_type.replace('_', ' ')}</td>
                      <td className="px-3 py-2 text-sm text-slate-700">{notification.status}</td>
                      <td className="px-3 py-2 text-sm text-slate-500">{notification.sent_at ? formatDateTime(notification.sent_at) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    )
  }

  return (
    <PageLayout
      title="Parking bookings"
      subtitle="Manage onsite car park reservations, monitor payments, and keep customer details up to date."
      navActions={navActions}
      loading={showInitialLoading}
      loadingLabel="Loading bookings..."
    >
      <div className="space-y-6">
        {pageError && (
          <Alert variant="error" title="We couldn’t load everything" description={pageError} />
        )}

        <Section id="overview" className="overflow-hidden" title="Overview" description="Snapshot of upcoming and outstanding activity.">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total bookings" value={bookings.length.toString()} />
            <StatCard label="Upcoming sessions" value={upcomingCount.toString()} />
            <StatCard label="Pending payments" value={pendingPaymentCount.toString()} variant={pendingPaymentCount > 0 ? 'warning' : 'primary'} />
          </div>
        </Section>

        <Section id="bookings" className="mt-6" title="Bookings" description="Filter by status, payment state, or search by reference or customer.">
          <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                <FormGroup label="Search" className="md:w-64">
                  <Input
                    placeholder="Reference or customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Status">
                  <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
                <FormGroup label="Payment">
                  <Select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value as any)}
                  >
                    {paymentStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={fetchBookings} disabled={loading}>
                  Refresh
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Reference</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Start</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">End</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Payment</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                        <div className="flex items-center justify-center gap-2">
                          <Spinner size="sm" />
                          <span>Loading bookings…</span>
                        </div>
                      </td>
                    </tr>
                  ) : bookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                        No bookings found for the current filters.
                      </td>
                    </tr>
                  ) : (
                    bookings.map(renderBookingRow)
                  )}
                </tbody>
              </table>
            </div>

            {selectedBooking && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">Selected booking</h3>
                  <Button variant="secondary" onClick={() => setSelectedBooking(null)}>
                    Close
                  </Button>
                </div>
                {renderSelectedBooking()}
              </div>
            )}
          </div>
        </Section>

        <Section
          id="notifications"
          className="mt-6"
          title="Notifications"
          description="History of customer reminders and payment links."
        >
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">Notification history</h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => selectedBooking && void loadNotifications(selectedBooking.id)}
                disabled={loadingNotifications || !selectedBooking}
              >
                {loadingNotifications ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Channel</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Event</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Sent at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {loadingNotifications ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                        <div className="flex items-center justify-center gap-2">
                          <Spinner size="sm" />
                          <span>Loading notifications…</span>
                        </div>
                      </td>
                    </tr>
                  ) : notifications.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                        No notification history yet.
                      </td>
                    </tr>
                  ) : (
                    notifications.map((notification) => (
                      <tr key={notification.id}>
                        <td className="px-3 py-2 text-sm capitalize text-slate-700">{notification.channel}</td>
                        <td className="px-3 py-2 text-sm capitalize text-slate-700">{notification.event_type.replace('_', ' ')}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{notification.status}</td>
                        <td className="px-3 py-2 text-sm text-slate-500">{notification.sent_at ? formatDateTime(notification.sent_at) : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      </div>

      <Modal
        open={showCreateModal}
        onClose={() => {
          if (!isPending) {
            setShowCreateModal(false)
            resetForm()
          }
        }}
        title="Create parking booking"
        size="lg"
        description="Capture customer and vehicle details to reserve space and send payment link."
      >
        <form onSubmit={handleCreateBooking} className="flex flex-col gap-4">
          <Section title="Customer" description="Match by phone number; email optional if we already have the customer.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup label="First name" required>
                <Input
                  required
                  value={createForm.customer_first_name}
                  onChange={(e) => handleInputChange('customer_first_name', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Last name">
                <Input
                  value={createForm.customer_last_name}
                  onChange={(e) => handleInputChange('customer_last_name', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Mobile number" required>
                <Input
                  required
                  placeholder="+447700900123"
                  value={createForm.customer_mobile}
                  onChange={(e) => handleInputChange('customer_mobile', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Email">
                <Input
                  type="email"
                  value={createForm.customer_email}
                  onChange={(e) => handleInputChange('customer_email', e.target.value)}
                />
              </FormGroup>
            </div>
          </Section>

          <Section title="Schedule" description="Bookings can span multiple days. All times are UK local time.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup label="Start">
                <Input
                  type="datetime-local"
                  required
                  value={createForm.start_at}
                  onChange={(e) => handleInputChange('start_at', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="End">
                <Input
                  type="datetime-local"
                  required
                  value={createForm.end_at}
                  onChange={(e) => handleInputChange('end_at', e.target.value)}
                />
              </FormGroup>
            </div>
          </Section>

          <Section title="Vehicle" description="Registration is required so the team can verify on arrival.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormGroup label="Registration" required>
                <Input
                  required
                  placeholder="AB12CDE"
                  value={createForm.vehicle_registration}
                  onChange={(e) => handleInputChange('vehicle_registration', e.target.value.toUpperCase())}
                />
              </FormGroup>
              <FormGroup label="Make">
                <Input
                  value={createForm.vehicle_make}
                  onChange={(e) => handleInputChange('vehicle_make', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Model">
                <Input
                  value={createForm.vehicle_model}
                  onChange={(e) => handleInputChange('vehicle_model', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Colour">
                <Input
                  value={createForm.vehicle_colour}
                  onChange={(e) => handleInputChange('vehicle_colour', e.target.value)}
                />
              </FormGroup>
            </div>
          </Section>

          <Section title="Pricing & notes" description="Override pricing sparingly—always record why.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Estimated price</span>
                  {pricingPreview && (
                    <span className="text-base font-semibold text-slate-900">{formatCurrency(pricingPreview.total)}</span>
                  )}
                </div>
                {pricingError && (
                  <p className="mt-2 text-sm text-red-600">{pricingError}</p>
                )}
                {!pricingError && !pricingPreview && (
                  <p className="mt-2 text-sm text-slate-600">Enter start and end time to preview the standard charge.</p>
                )}
                {pricingPreview && (
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p>
                      Covers {formatDuration(pricingPreview.durationMinutes)} using the lowest combination of hourly, daily, weekly, and monthly rates.
                    </p>
                    <ul className="list-disc pl-5">
                      {pricingPreview.breakdown.map((line, index) => (
                        <li key={`${line.unit}-${index}`}>
                          {line.quantity} × {line.unit}(s) @ {formatCurrency(line.rate)} = {formatCurrency(line.subtotal)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {createForm.override_price && (
                  <p className="mt-3 text-xs text-slate-500">
                    Override price in effect (£{Number(createForm.override_price).toFixed(2)}). Customers will be charged this amount instead of the estimate above.
                  </p>
                )}
              </div>
              <FormGroup label="Override price (£)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.override_price}
                  onChange={(e) => handleInputChange('override_price', e.target.value)}
                />
              </FormGroup>
              <FormGroup label="Override reason">
                <Input
                  value={createForm.override_reason}
                  onChange={(e) => handleInputChange('override_reason', e.target.value)}
                />
              </FormGroup>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Toggle
                  checked={createForm.capacity_override}
                  onChange={(event) => handleInputChange('capacity_override', event.target.checked)}
                  label="Bypass capacity check"
                />
                <span className="text-xs text-slate-500">Only enable when you are sure there is physical capacity available.</span>
              </div>
              {createForm.capacity_override && (
                <FormGroup label="Capacity override reason" required className="sm:col-span-2">
                  <Textarea
                    required
                    value={createForm.capacity_override_reason}
                    onChange={(e) => handleInputChange('capacity_override_reason', e.target.value)}
                  />
                </FormGroup>
              )}
              <FormGroup label="Internal notes" className="sm:col-span-2">
                <Textarea
                  value={createForm.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                />
              </FormGroup>
            </div>
          </Section>

          <Section title="Payment" description="Customers receive the PayPal link once the booking is saved.">
            <div className="flex items-center gap-3">
              <Toggle
                checked={createForm.send_payment_link}
                onChange={(event) => handleInputChange('send_payment_link', event.target.checked)}
                label="Send payment link now"
              />
              <span className="text-xs text-slate-500">If disabled, you can trigger the payment later from the booking details.</span>
            </div>
          </Section>

          <ModalActions>
            <Button type="button" variant="secondary" onClick={() => {
              if (!isPending) {
                setShowCreateModal(false)
                resetForm()
              }
            }}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create booking'}
            </Button>
          </ModalActions>
        </form>
      </Modal>
    </PageLayout>
  )
}

interface DetailItemProps {
  label: string
  value: React.ReactNode
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-800">{value ?? '—'}</div>
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  variant?: 'primary' | 'warning'
}

function StatCard({ label, value, variant = 'primary' }: StatCardProps) {
  const classes = variant === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'

  return (
    <Card className={`border ${classes}`}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </div>
    </Card>
  )
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0 minutes'
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  }
  if (remainingMinutes > 0) {
    parts.push(`${remainingMinutes} minutes`)
  }

  return parts.join(' ')
}
