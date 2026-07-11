'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  UserGroupIcon,
  PhoneIcon,
  MapPinIcon,
  SparklesIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'
import { toast } from '@/ds'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { deletePrivateBooking, cancelPrivateBooking, extendBookingHold } from '@/app/actions/privateBookingActions'
import DeleteBookingButton from '@/components/private-bookings/DeleteBookingButton'
import {
  fetchPrivateBookings,
  type PrivateBookingDashboardItem,
} from '@/app/actions/private-bookings-dashboard'
import type { BookingStatus } from '@/types/private-bookings'
import { formatDistanceToNowStrict } from 'date-fns'
import { usePermissions } from '@/contexts/PermissionContext'

import {
  Badge,
  Button,
  Spinner,
  SearchInput,
  ConfirmDialog,
  Drawer,
  Modal,
  Select,
  Field,
  Input,
  Textarea,
  Empty,
} from '@/ds/primitives'

import {
  PageHeader,
  Tabs,
  Card,
  CardBody,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
  CustomerLink,
} from '@/ds/composites'

/* ---------- Constants ---------- */

const DEFAULT_PAGE_SIZE = 20

const statusTone: Record<BookingStatus, 'neutral' | 'success' | 'info' | 'danger'> = {
  draft: 'neutral',
  confirmed: 'success',
  completed: 'info',
  cancelled: 'danger',
}

const statusLabel: Record<BookingStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/* ---------- Icons ---------- */

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" /><path d="M5 12h14" />
  </svg>
)

/* ---------- Helpers ---------- */

const toNumber = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') { const p = Number(value); return Number.isFinite(p) ? p : 0 }
  return 0
}

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)

const getHoldExpiryCountdown = (holdExpiry: string | null | undefined): string | null => {
  if (!holdExpiry) return null
  const expiry = new Date(holdExpiry)
  if (Number.isNaN(expiry.getTime())) return null
  const relative = formatDistanceToNowStrict(expiry, { addSuffix: true })
  const prefix = expiry.getTime() <= Date.now() ? 'Hold expired' : 'Hold expires'
  return `${prefix} ${relative}`
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

/* ---------- Types ---------- */

interface PrivateBookingsClientProps {
  permissions: {
    hasCreatePermission: boolean
    hasDeletePermission: boolean
    hasEditPermission: boolean
  }
  initialBookings: PrivateBookingDashboardItem[]
  initialTotalCount: number
  pageSize: number
  initialError?: string | null
}

type FetchParams = {
  status: BookingStatus | 'all'
  dateFilter: 'all' | 'upcoming' | 'past'
  search: string
  page: number
  includeCancelled: boolean
}

/* ---------- Component ---------- */

export default function PrivateBookingsClient({
  permissions,
  initialBookings,
  initialTotalCount,
  pageSize,
  initialError,
}: PrivateBookingsClientProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageSettings = hasPermission('private_bookings', 'manage')

  /* --- Data state --- */
  const [bookings, setBookings] = useState<PrivateBookingDashboardItem[]>(initialBookings)
  const [totalCount, setTotalCount] = useState(initialTotalCount)
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null)

  /* --- Filter state --- */
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming')
  const [includeCancelled, setIncludeCancelled] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isPending, startTransition] = useTransition()

  /* --- Action state --- */
  const [cancelConfirmBookingId, setCancelConfirmBookingId] = useState<string | null>(null)
  const [extendingHoldId, setExtendingHoldId] = useState<string | null>(null)
  // Extending a hold requires a recorded reason (SOP) — collected in a modal
  const [extendHoldTarget, setExtendHoldTarget] = useState<{ bookingId: string; days: 7 | 14 | 30 } | null>(null)
  const [extendHoldReason, setExtendHoldReason] = useState('')
  const [extendingHold, setExtendingHold] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  /* --- Hide bookings (localStorage) --- */
  const HIDDEN_KEY = 'pb_hidden_cancelled_ids'
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem(HIDDEN_KEY)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const hideBooking = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* noop */ }
      return next
    })
  }

  const restoreHidden = () => {
    setHiddenIds(new Set())
    try { localStorage.removeItem(HIDDEN_KEY) } catch { /* noop */ }
  }

  /* --- Derived --- */
  const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize))
  const visibleBookings = bookings.filter((b) => !hiddenIds.has(b.id))
  const hiddenCount = bookings.filter((b) => hiddenIds.has(b.id)).length
  const canToggleCancelled = dateFilter === 'upcoming' && statusFilter === 'all'
  const loading = isPending
  const debouncedSearch = useDebouncedValue(searchDraft, 300)

  /* --- Fetching --- */
  const runFetch = useCallback(
    (params: FetchParams) => {
      setSearchTerm(params.search)
      setCurrentPage(params.page)
      setLoadError(null)

      startTransition(async () => {
        const result = await fetchPrivateBookings({
          status: params.status,
          dateFilter: params.dateFilter,
          includeCancelled: params.includeCancelled,
          search: params.search,
          page: params.page,
          pageSize: effectivePageSize,
        })

        if ('error' in result) {
          toast.error(result.error ?? 'Failed to load private bookings.')
          if (bookings.length === 0) setLoadError(result.error ?? 'Failed to load private bookings.')
          return
        }

        setBookings(result.data)
        setTotalCount(result.totalCount)
      })
    },
    [effectivePageSize, bookings.length],
  )

  const fetchWithState = useCallback(
    (overrides: Partial<FetchParams> = {}) => {
      runFetch({
        status: overrides.status ?? statusFilter,
        dateFilter: overrides.dateFilter ?? dateFilter,
        search: overrides.search ?? searchTerm,
        page: overrides.page ?? currentPage,
        includeCancelled: overrides.includeCancelled ?? includeCancelled,
      })
    },
    [statusFilter, dateFilter, searchTerm, currentPage, includeCancelled, runFetch],
  )

  /* --- Debounced search effect --- */
  useEffect(() => {
    const trimmed = debouncedSearch.trim()
    if (trimmed === searchTerm) return
    fetchWithState({ search: trimmed, page: 1 })
  }, [debouncedSearch, searchTerm, fetchWithState])

  /* --- Handlers --- */
  const handleStatusChange = (value: string) => {
    const v = value as BookingStatus | 'all'
    setStatusFilter(v)
    fetchWithState({ status: v, page: 1 })
  }

  const handleDateFilterChange = (value: string) => {
    const v = value as 'all' | 'upcoming' | 'past'
    setDateFilter(v)
    fetchWithState({ dateFilter: v, page: 1 })
  }

  const handleClearFilters = () => {
    setStatusFilter('all')
    setDateFilter('upcoming')
    setSearchDraft('')
    setIncludeCancelled(true)
    fetchWithState({ status: 'all', dateFilter: 'upcoming', includeCancelled: true, search: '', page: 1 })
  }

  const handleDeleteBooking = async (bookingId: string) => {
    const result = await deletePrivateBooking(bookingId)
    if (result.error) { toast.error(result.error ?? 'Failed to delete booking.'); return }
    toast.success('Booking deleted successfully')
    const nextPage = bookings.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage
    fetchWithState({ page: nextPage })
  }

  const handleCancelBookingConfirm = async () => {
    if (!cancelConfirmBookingId) return
    const result = await cancelPrivateBooking(cancelConfirmBookingId, 'Cancelled from list view')
    if ('error' in result && result.error) { toast.error(result.error ?? 'Failed to cancel booking.'); return }
    toast.success('Booking cancelled and customer notified')
    setCancelConfirmBookingId(null)
    fetchWithState({ page: currentPage })
  }

  const handleExtendHoldRequest = (bookingId: string, days: 7 | 14 | 30) => {
    setExtendHoldReason('')
    setExtendHoldTarget({ bookingId, days })
  }

  const handleExtendHoldConfirm = async () => {
    if (!extendHoldTarget || extendingHold) return
    const reason = extendHoldReason.trim()
    if (!reason) { toast.error('Please record a reason for extending the hold'); return }
    const { bookingId, days } = extendHoldTarget
    setExtendingHold(true)
    setExtendingHoldId(bookingId)
    try {
      const result = await extendBookingHold(bookingId, days, reason)
      if ('error' in result && result.error) { toast.error(result.error); return }
      toast.success(
        `Hold extended by ${days} days${'smsSent' in result && result.smsSent ? ' -- customer notified by SMS' : ''}`,
      )
      setExtendHoldTarget(null)
      fetchWithState({ page: currentPage })
    } finally {
      setExtendingHold(false)
      setExtendingHoldId(null)
    }
  }

  const handleToggleCancelledVisibility = () => {
    const next = !includeCancelled
    setIncludeCancelled(next)
    fetchWithState({ includeCancelled: next, page: 1 })
  }

  /* --- Tab config --- */
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Cancel booking confirmation dialog */}
      <ConfirmDialog
        open={cancelConfirmBookingId !== null}
        onClose={() => setCancelConfirmBookingId(null)}
        onConfirm={handleCancelBookingConfirm}
        title="Cancel this booking?"
        message="An SMS will be sent to inform the customer. This action cannot be undone."
        tone="warning"
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
      />

      {/* Extend hold — a reason is required (recorded in the audit trail) */}
      <Modal
        open={extendHoldTarget !== null}
        onClose={() => setExtendHoldTarget(null)}
        title={extendHoldTarget ? `Extend hold by ${extendHoldTarget.days} days` : 'Extend hold'}
      >
        <div className="space-y-4">
          <Field
            label="Reason for extending the hold"
            required
            hint="Recorded against the booking's audit trail."
          >
            <Textarea
              value={extendHoldReason}
              onChange={(e) => setExtendHoldReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer confirming numbers after the weekend"
              disabled={extendingHold}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setExtendHoldTarget(null)}
              disabled={extendingHold}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleExtendHoldConfirm}
              loading={extendingHold}
              disabled={extendingHold || !extendHoldReason.trim()}
            >
              Extend hold
            </Button>
          </div>
        </div>
      </Modal>

      <PageHeader
        breadcrumbs={[{ label: 'Private Bookings' }]}
        title="Private Bookings"
        subtitle="Manage private venue bookings and events"
        className="mb-0"
        actions={
          <div className="flex items-center gap-2">
            {permissions.hasCreatePermission && (
              <Link href="/private-bookings/new">
                <Button variant="primary" size="sm" icon={<PlusIcon />}>New Booking</Button>
              </Link>
            )}
            {canManageSettings && (
              <Link href="/private-bookings/settings">
                <Button variant="secondary" size="sm">PB Settings</Button>
              </Link>
            )}
          </div>
        }
      />

      {loadError && (
        <div className="p-3 bg-danger-soft text-danger-fg rounded-lg text-sm flex items-center justify-between">
          <span>{loadError}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runFetch({ status: statusFilter, dateFilter, search: searchTerm, page: currentPage, includeCancelled })}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Tabs for status filter */}
      <Tabs
        tabs={tabs}
        activeTab={statusFilter}
        onTabChange={handleStatusChange}
      />

      {/* Mobile filter button */}
      <div className="block sm:hidden">
        <Button
          variant="secondary"
          className="w-full flex items-center justify-center gap-2"
          onClick={() => setMobileFiltersOpen(true)}
        >
          <FunnelIcon className="h-4 w-4" />
          Filters
          {(statusFilter !== 'all' || dateFilter !== 'upcoming' || searchDraft) && (
            <span className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-fg text-xs">
              {[statusFilter !== 'all', dateFilter !== 'upcoming', Boolean(searchDraft)].filter(Boolean).length}
            </span>
          )}
        </Button>
      </div>

      {/* Mobile filters drawer */}
      <Drawer
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        title="Filter Bookings"
        side="right"
      >
        <div className="flex flex-col gap-4">
          <Field label="Search">
            <Input
              type="text"
              placeholder="Search customer name..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </Field>

          <Field label="Date">
            <Select
              value={dateFilter}
              onChange={(e) => handleDateFilterChange(e.target.value)}
              options={[
                { value: 'all', label: 'All Dates' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'past', label: 'Past' },
              ]}
            />
          </Field>

          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => { handleClearFilters(); setMobileFiltersOpen(false) }}
            >
              Clear Filters
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => setMobileFiltersOpen(false)}
            >
              Apply
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Desktop filter bar */}
      <Card className="hidden sm:block">
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Search">
              <SearchInput
                value={searchDraft}
                onChange={setSearchDraft}
                placeholder="Search customer name..."
              />
            </Field>

            <Field label="Date">
              <Select
                value={dateFilter}
                onChange={(e) => handleDateFilterChange(e.target.value)}
                options={[
                  { value: 'all', label: 'All Dates' },
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'past', label: 'Past' },
                ]}
              />
            </Field>

            <div className="flex items-end">
              <Button onClick={handleClearFilters} variant="secondary" className="w-full">
                Clear Filters
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Bookings count + actions bar */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-strong">Bookings ({totalCount})</span>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <Button variant="secondary" size="sm" onClick={restoreHidden}>
              {hiddenCount} hidden -- Restore
            </Button>
          )}
          {canToggleCancelled && (
            <Button variant="secondary" size="sm" onClick={handleToggleCancelledVisibility} disabled={loading}>
              {includeCancelled ? 'Hide cancelled' : 'Show cancelled'}
            </Button>
          )}
          {loading && <Spinner size="sm" />}
        </div>
      </div>

      {/* Bookings table */}
      <Card>
        {visibleBookings.length === 0 ? (
          <CardBody>
            <Empty
              title="No bookings found"
              description={searchDraft ? `No results for "${searchDraft}"` : 'Create your first private booking.'}
            />
          </CardBody>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Financials</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBookings.map((booking) => (
                    <TableRow
                      key={booking.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/private-bookings/${booking.id}`)}
                    >
                      <TableCell>
                        {booking.is_date_tbd ? (
                          <span className="text-sm font-medium text-warning-fg">To be confirmed</span>
                        ) : (
                          <>
                            <div className="text-[13px] text-text-strong">{formatDateFull(booking.event_date)}</div>
                            <div className="text-[12px] text-text-muted">{formatTime12Hour(booking.start_time)}</div>
                          </>
                        )}
                        {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event !== null && booking.days_until_event >= 0 && (
                          <div className="text-[11px] text-text-subtle mt-0.5">
                            {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div
                          className="text-[13px] font-medium"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <CustomerLink
                            customerId={booking.customer_id ?? null}
                            name={booking.customer_name}
                            fallback="Unknown Customer"
                            className="text-blue-600 hover:text-blue-700"
                          />
                        </div>
                        {booking.contact_phone && (
                          <div className="text-[12px] text-text-muted flex items-center gap-1">
                            <PhoneIcon className="h-3 w-3" />
                            {booking.contact_phone}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="text-[13px] text-text flex items-center gap-1">
                          <UserGroupIcon className="h-4 w-4 text-text-muted" />
                          {booking.guest_count ?? 0} guests
                        </div>
                        {booking.event_type && (
                          <div className="text-[11px] text-text-muted mt-0.5">{booking.event_type}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge tone={statusTone[booking.status]} dot>{statusLabel[booking.status]}</Badge>
                        {booking.status === 'draft' && (
                          <div className="mt-1 text-[11px] text-text-muted">
                            {getHoldExpiryCountdown(booking.hold_expiry) ?? 'Hold expiry not set'}
                          </div>
                        )}
                        {booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                          <div className="mt-1">
                            <Badge tone={booking.deposit_status === 'Paid' ? 'success' : 'warning'}>
                              Deposit {booking.deposit_status}
                              {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                            </Badge>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="text-[13px] text-text-strong">
                          {formatCurrency(toNumber(booking.gross_total ?? booking.calculated_total ?? booking.total_amount))}
                        </div>
                        {booking.final_payment_date ? (
                          <div className="text-[11px] text-success-fg font-medium">Fully paid</div>
                        ) : booking.balance_remaining != null && booking.balance_remaining > 0 ? (
                          <div className="text-[11px] text-warning-fg font-medium">
                            Balance: {formatCurrency(booking.balance_remaining)}
                          </div>
                        ) : null}
                        {booking.deposit_paid_date && (
                          <div className="text-[11px] text-text-muted">Deposit paid {formatDateFull(booking.deposit_paid_date)}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <Link
                            href={`/private-bookings/${booking.id}`}
                            className="text-[12px] font-medium text-primary hover:underline"
                          >
                            View
                          </Link>

                          {booking.status === 'draft' && permissions.hasEditPermission && (
                            <>
                              <select
                                disabled={extendingHoldId === booking.id}
                                defaultValue=""
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const days = Number(e.target.value) as 7 | 14 | 30
                                  if (days) { handleExtendHoldRequest(booking.id, days); e.target.value = '' }
                                }}
                                className="text-xs border border-border rounded-default px-1.5 py-0.5 text-text bg-surface focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 cursor-pointer"
                                title="Extend hold"
                              >
                                <option value="" disabled>Extend hold...</option>
                                <option value="7">+7 days</option>
                                <option value="14">+14 days</option>
                                <option value="30">+30 days</option>
                              </select>
                              {extendingHoldId === booking.id && <Spinner size="sm" />}
                            </>
                          )}

                          {booking.status === 'confirmed' && (
                            <Button variant="secondary" size="sm" onClick={() => setCancelConfirmBookingId(booking.id)}>
                              Cancel
                            </Button>
                          )}

                          {booking.status === 'cancelled' && (
                            <Button variant="secondary" size="sm" onClick={() => hideBooking(booking.id)} title="Hide this booking from view">
                              Hide
                            </Button>
                          )}

                          {permissions.hasDeletePermission && (booking.status === 'draft' || booking.status === 'cancelled') && (
                            <DeleteBookingButton
                              bookingId={booking.id}
                              bookingName={booking.customer_name}
                              status={booking.status}
                              eventDate={booking.event_date}
                              deleteAction={async (formData) => {
                                const id = formData.get('bookingId') as string
                                await handleDeleteBooking(id)
                              }}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card layout */}
            <div className="block md:hidden divide-y divide-border">
              {visibleBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="p-4 cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => router.push(`/private-bookings/${booking.id}`)}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 mr-2">
                      <div
                        className="font-medium truncate"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <CustomerLink
                          customerId={booking.customer_id ?? null}
                          name={booking.customer_name}
                          fallback="Unknown Customer"
                          className="text-blue-600 hover:text-blue-700"
                        />
                      </div>
                      {booking.is_date_tbd ? (
                        <div className="text-sm text-warning-fg">Date to be confirmed</div>
                      ) : (
                        <>
                          <div className="text-sm text-text-muted">{formatDateFull(booking.event_date)}</div>
                          <div className="text-sm text-text-muted">{formatTime12Hour(booking.start_time)}</div>
                        </>
                      )}
                      {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event !== null && booking.days_until_event >= 0 && (
                        <div className="text-xs text-text-subtle mt-1">
                          {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                        </div>
                      )}
                      {booking.status === 'draft' && (
                        <div className="text-xs text-text-muted mt-1">
                          {getHoldExpiryCountdown(booking.hold_expiry) ?? 'Hold expiry not set'}
                        </div>
                      )}
                    </div>
                    <Badge tone={statusTone[booking.status]} dot>{statusLabel[booking.status]}</Badge>
                  </div>

                  {booking.contact_phone && (
                    <div className="text-sm text-text-muted mb-2 flex items-center gap-1">
                      <PhoneIcon className="h-3 w-3" />
                      {booking.contact_phone}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div className="text-text-muted">
                      <div className="flex items-center gap-1">
                        <UserGroupIcon className="h-4 w-4" />
                        <span>{booking.guest_count ?? 0} guests</span>
                      </div>
                      {booking.event_type && (
                        <div className="text-xs text-text-muted mt-1">{booking.event_type}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-text-strong">
                        {formatCurrency(toNumber(booking.gross_total ?? booking.calculated_total ?? booking.total_amount))}
                      </span>
                      {booking.final_payment_date ? (
                        <div className="text-xs text-success-fg font-medium">Fully paid</div>
                      ) : booking.balance_remaining != null && booking.balance_remaining > 0 ? (
                        <div className="text-xs text-warning-fg font-medium">
                          Balance: {formatCurrency(booking.balance_remaining)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                    <div className="mb-3">
                      <Badge tone={booking.deposit_status === 'Paid' ? 'success' : 'warning'}>
                        Deposit {booking.deposit_status}
                        {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                      </Badge>
                    </div>
                  )}

                  <div className="flex justify-end items-center gap-2 pt-2 border-t border-border flex-wrap" onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={`/private-bookings/${booking.id}`}
                      className="inline-flex min-h-[44px] md:min-h-0 items-center text-sm font-medium text-primary hover:underline px-3 py-1"
                    >
                      View Details
                    </Link>
                    {booking.status === 'draft' && permissions.hasEditPermission && (
                      <div className="flex items-center gap-1">
                        <select
                          disabled={extendingHoldId === booking.id}
                          defaultValue=""
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const days = Number(e.target.value) as 7 | 14 | 30
                            if (days) { handleExtendHoldRequest(booking.id, days); e.target.value = '' }
                          }}
                          className="text-xs border border-border rounded-default px-1.5 py-0.5 text-text bg-surface focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 cursor-pointer"
                        >
                          <option value="" disabled>Extend hold...</option>
                          <option value="7">+7 days</option>
                          <option value="14">+14 days</option>
                          <option value="30">+30 days</option>
                        </select>
                        {extendingHoldId === booking.id && <Spinner size="sm" />}
                      </div>
                    )}
                    {booking.status === 'cancelled' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => hideBooking(booking.id)}
                      >
                        Hide
                      </Button>
                    )}
                    {permissions.hasDeletePermission && (booking.status === 'draft' || booking.status === 'cancelled') && (
                      <DeleteBookingButton
                        bookingId={booking.id}
                        bookingName={booking.customer_name}
                        status={booking.status}
                        eventDate={booking.event_date}
                        deleteAction={async (formData) => {
                          const id = formData.get('bookingId') as string
                          await handleDeleteBooking(id)
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <TablePagination
                page={currentPage}
                totalPages={totalPages}
                pageSize={effectivePageSize}
                totalItems={totalCount}
                onPageChange={(page) => fetchWithState({ page })}
              />
            )}
          </>
        )}
      </Card>

      {/* Quick links */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <Button
          variant="secondary"
          onClick={() => router.push('/private-bookings/settings/spaces')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <MapPinIcon className="h-5 w-5" />
          <span>Manage Spaces</span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push('/private-bookings/settings/catering')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <SparklesIcon className="h-5 w-5" />
          <span>Catering Options</span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push('/private-bookings/settings/vendors')}
          className="flex items-center justify-center gap-2 py-6"
        >
          <UserGroupIcon className="h-5 w-5" />
          <span>Preferred Vendors</span>
        </Button>
      </div>
    </div>
  )
}
