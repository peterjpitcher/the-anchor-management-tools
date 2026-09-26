'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast, Icon } from '@/ds'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import {
  deletePrivateBooking,
  cancelPrivateBooking,
  extendBookingHold,
  getCancellationPreview,
} from '@/app/actions/privateBookingActions'
import DeleteBookingButton from '@/components/private-bookings/DeleteBookingButton'
import {
  fetchPrivateBookings,
  type PrivateBookingDashboardItem,
} from '@/app/actions/private-bookings-dashboard'
import type { BookingStatus } from '@/types/private-bookings'
import { formatDistanceToNowStrict } from 'date-fns'
import { usePermissions } from '@/contexts/PermissionContext'

import {
  Alert,
  Badge,
  Button,
  LinkButton,
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
  PageLayout,
  FormFooter,
  Segmented,
  Card,
  CardHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TablePagination,
  CustomerLink,
} from '@/ds/composites'

import {
  privateBookingPaymentTextClass,
  privateBookingPaymentTone,
  privateBookingStatusLabel,
  privateBookingStatusTone,
} from '../_shared/status-ui'
import { privateBookingsNav } from '../_shared/nav'

/* ---------- Constants ---------- */

const DEFAULT_PAGE_SIZE = 20

const DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Dates' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
]

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

type CancellationPreview = Awaited<ReturnType<typeof getCancellationPreview>>

// Outcomes that need a decision the list cannot offer: retaining part of the
// deposit is a General Manager call, and a disputed booking has to be reviewed
// by hand. Both live on the booking page, so send staff there.
const OUTCOMES_NEEDING_THE_BOOKING_PAGE = new Set(['gm_review_required', 'manual_review'])

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
  const canViewReports = hasPermission('reports', 'view')
  const canViewSmsQueue =
    hasPermission('private_bookings', 'view_sms_queue') || hasPermission('private_bookings', 'manage')

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
  // Cancelling has money consequences (refund, deposit retention) and texts the
  // customer, so the list shows the same preview the booking page does rather
  // than asking staff to confirm something they cannot see.
  const [cancelPreview, setCancelPreview] = useState<CancellationPreview | null>(null)
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false)
  const cancelPreviewRequestRef = useRef<string | null>(null)
  const [extendingHoldId, setExtendingHoldId] = useState<string | null>(null)
  // Extending a hold requires a recorded reason (SOP), collected in a modal
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

  const handleCancelRequest = async (bookingId: string) => {
    setCancelConfirmBookingId(bookingId)
    setCancelPreview(null)
    setCancelPreviewLoading(true)
    cancelPreviewRequestRef.current = bookingId

    let preview: CancellationPreview
    try {
      preview = await getCancellationPreview(bookingId)
    } catch {
      // A failed request says so in the dialog rather than leaving it waiting forever.
      preview = {
        outcome: null,
        refund_amount: 0,
        retained_amount: 0,
        deposit_deduction: 0,
        max_retainable: 0,
        preview_body: null,
        error: 'The cancellation could not be worked out. Close this and try again.',
      }
    }
    // Ignore a preview that arrives after the dialog moved on to another booking
    if (cancelPreviewRequestRef.current !== bookingId) return
    setCancelPreview(preview)
    setCancelPreviewLoading(false)
  }

  const closeCancelDialog = () => {
    cancelPreviewRequestRef.current = null
    setCancelConfirmBookingId(null)
    setCancelPreview(null)
    setCancelPreviewLoading(false)
  }

  // Some outcomes need a decision on the booking itself, so the list sends staff there instead.
  const cancelNeedsBookingPage = Boolean(
    cancelPreview?.outcome && OUTCOMES_NEEDING_THE_BOOKING_PAGE.has(cancelPreview.outcome),
  )

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
      const notToldBecauseDepositUnconfirmed =
        'guestNotNotifiedReason' in result && result.guestNotNotifiedReason === 'deposit_to_be_confirmed'
      toast.success(
        notToldBecauseDepositUnconfirmed
          ? `Hold extended by ${days} days. The guest was not told, because their deposit is still to be confirmed.`
          : `Hold extended by ${days} days${'smsSent' in result && result.smsSent ? ' -- customer notified by SMS' : ''}`,
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

  /* --- Status filter: a Segmented, because the section tab row is this page's one tab row --- */
  const statusOptions = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
  ]

  const extendHoldOptions = [
    { value: '7', label: '+7 days' },
    { value: '14', label: '+14 days' },
    { value: '30', label: '+30 days' },
  ]

  // The extend-hold picker in each row: choosing a number of days opens the reason dialog.
  const renderExtendHoldSelect = (bookingId: string) => (
    <Select
      aria-label="Extend hold"
      title="Extend hold"
      disabled={extendingHoldId === bookingId}
      defaultValue=""
      placeholder="Extend hold..."
      options={extendHoldOptions}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const days = Number(e.target.value) as 7 | 14 | 30
        if (days) { handleExtendHoldRequest(bookingId, days); e.target.value = '' }
      }}
      className="h-btn-h-sm w-auto text-xs"
    />
  )

  const activeFilterCount = [statusFilter !== 'all', dateFilter !== 'upcoming', Boolean(searchDraft)].filter(Boolean).length

  return (
    <PageLayout
      title="Private Bookings"
      subtitle="Bookings: venue hire and events"
      navItems={privateBookingsNav({ canViewSmsQueue, canViewReports })}
      headerActions={
        permissions.hasCreatePermission ? (
          <LinkButton href="/private-bookings/new" variant="primary" size="sm" icon={<Icon name="plus" size={16} />}>
            New Booking
          </LinkButton>
        ) : undefined
      }
    >
      {/* Cancel booking: same preview the booking page shows before committing. A yes/no
          confirmation, so the DS ConfirmDialog: a refused cancellation shows in place and the
          dialog stays open. When the outcome needs a decision on the booking itself, the confirm
          button opens the booking instead. */}
      <ConfirmDialog
        open={cancelConfirmBookingId !== null}
        onClose={closeCancelDialog}
        onConfirm={async () => {
          if (!cancelConfirmBookingId) return
          if (cancelNeedsBookingPage) {
            router.push(`/private-bookings/${cancelConfirmBookingId}`)
            return
          }
          const result = await cancelPrivateBooking(cancelConfirmBookingId, 'Cancelled from list view')
          if ('error' in result && result.error) throw new Error(result.error)
          toast.success('Booking cancelled and customer notified')
          fetchWithState({ page: currentPage })
        }}
        title="Cancel Booking"
        confirmLabel={cancelNeedsBookingPage ? 'Open the Booking' : 'Cancel Booking'}
        cancelLabel="Keep Booking"
        tone={cancelNeedsBookingPage ? 'primary' : 'danger'}
        // While the outcome is being worked out there is nothing to confirm yet.
        loading={cancelPreviewLoading}
        message={
          <div className="space-y-4">
            {cancelPreviewLoading && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Spinner size="sm" />
                Working out what the customer will be told…
              </div>
            )}

            {cancelPreview?.error && (
              <Alert tone="danger" size="sm">{cancelPreview.error}</Alert>
            )}

            {cancelPreview && !cancelPreview.error && (
              <div className="space-y-3">
                {(cancelPreview.refund_amount > 0 || cancelPreview.retained_amount > 0) && (
                  <div className="text-sm text-text">
                    {cancelPreview.refund_amount > 0 && (
                      <div>Refund due: <span className="font-medium">{formatCurrency(cancelPreview.refund_amount)}</span></div>
                    )}
                    {cancelPreview.retained_amount > 0 && (
                      <div>Retained from the deposit: <span className="font-medium">{formatCurrency(cancelPreview.retained_amount)}</span></div>
                    )}
                  </div>
                )}

                {cancelPreview.preview_body && (
                  <div>
                    <div className="text-xs font-medium text-text-muted mb-1">The customer will be texted:</div>
                    <p className="text-sm text-text bg-surface-2 border border-border rounded-default p-3 whitespace-pre-wrap">
                      {cancelPreview.preview_body}
                    </p>
                  </div>
                )}

                {cancelNeedsBookingPage && (
                  <Alert tone="warning" size="sm">
                    This one needs a decision on the booking itself (how much of the deposit is
                    kept, or a payment dispute to review). Open the booking to cancel it.
                  </Alert>
                )}
              </div>
            )}

            <p className="text-sm text-text-muted">This cannot be undone.</p>
          </div>
        }
      />

      {/* Extend hold: a reason is required (recorded in the audit trail) */}
      <Modal
        open={extendHoldTarget !== null}
        onClose={() => setExtendHoldTarget(null)}
        title={extendHoldTarget ? `Extend Hold by ${extendHoldTarget.days} Days` : 'Extend Hold'}
        footer={
          <>
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
              Extend Hold
            </Button>
          </>
        }
      >
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
      </Modal>

      {loadError && (
        <Alert tone="danger" title="Could not load private bookings">
          {loadError}
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runFetch({ status: statusFilter, dateFilter, search: searchTerm, page: currentPage, includeCancelled })}
            >
              Try Again
            </Button>
          </div>
        </Alert>
      )}

      {/* Filters, directly above the list they filter. Search and date sit in a drawer on phones. */}
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          aria-label="Status"
          options={statusOptions}
          value={statusFilter}
          onChange={handleStatusChange}
          className="max-w-full overflow-x-auto"
        />

        <Field label="Search" className="hidden sm:flex w-72">
          <SearchInput
            value={searchDraft}
            onChange={setSearchDraft}
            placeholder="Search customer name..."
          />
        </Field>

        <Field label="Date" className="hidden sm:flex w-48">
          <Select
            value={dateFilter}
            onChange={(e) => handleDateFilterChange(e.target.value)}
            options={DATE_FILTER_OPTIONS}
          />
        </Field>

        <Button onClick={handleClearFilters} variant="secondary" className="hidden sm:inline-flex">
          Clear Filters
        </Button>

        <Button
          variant="secondary"
          className="w-full sm:hidden"
          icon={<Icon name="filter" size={16} />}
          onClick={() => setMobileFiltersOpen(true)}
        >
          Filters
          {activeFilterCount > 0 && (
            <Badge tone="primary" size="sm" className="ml-1">{activeFilterCount}</Badge>
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
              options={DATE_FILTER_OPTIONS}
            />
          </Field>

          <FormFooter>
            <Button
              variant="secondary"
              onClick={() => { handleClearFilters(); setMobileFiltersOpen(false) }}
            >
              Clear Filters
            </Button>
            <Button
              variant="primary"
              onClick={() => setMobileFiltersOpen(false)}
            >
              Apply
            </Button>
          </FormFooter>
        </div>
      </Drawer>

      {/* Bookings table. A failed load shows the error above, never an empty list. */}
      {!loadError && (
      <Card padding="none">
        <CardHeader
          title={`Bookings (${totalCount})`}
          action={
            <div className="flex items-center gap-2">
              {loading && <Spinner size="sm" />}
              {hiddenCount > 0 && (
                <Button variant="secondary" size="sm" onClick={restoreHidden}>
                  Restore {hiddenCount} Hidden
                </Button>
              )}
              {canToggleCancelled && (
                <Button variant="secondary" size="sm" onClick={handleToggleCancelledVisibility} disabled={loading}>
                  {includeCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
                </Button>
              )}
            </div>
          }
        />
        {visibleBookings.length === 0 ? (
          <Empty
            size="sm"
            title={statusFilter !== 'all' || dateFilter !== 'all' || searchDraft ? 'No bookings match these filters' : 'No bookings yet'}
            description={
              statusFilter !== 'all' || dateFilter !== 'all' || searchDraft
                ? 'Try another search, status or date.'
                : 'Create your first private booking with New Booking.'
            }
          />
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
                            <div className="text-ui text-text-strong">{formatDateFull(booking.event_date)}</div>
                            <div className="text-xs text-text-muted">{formatTime12Hour(booking.start_time)}</div>
                          </>
                        )}
                        {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event !== null && booking.days_until_event >= 0 && (
                          <div className="text-meta text-text-soft mt-0.5">
                            {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div
                          className="text-ui font-medium"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <CustomerLink
                            customerId={booking.customer_id ?? null}
                            name={booking.customer_name}
                            fallback="Unknown Customer"
                          />
                        </div>
                        {booking.contact_phone && (
                          <div className="text-xs text-text-muted flex items-center gap-1">
                            <Icon name="phone" size={12} />
                            {booking.contact_phone}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="text-ui text-text flex items-center gap-1">
                          <Icon name="users" size={16} className="text-text-muted" />
                          {booking.guest_count ?? 0} guests
                        </div>
                        {booking.event_type && (
                          <div className="text-meta text-text-muted mt-0.5">{booking.event_type}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge tone={privateBookingStatusTone(booking.status)} dot>{privateBookingStatusLabel(booking.status)}</Badge>
                        {booking.status === 'draft' && (
                          <div className="mt-1 text-meta text-text-muted">
                            {getHoldExpiryCountdown(booking.hold_expiry) ?? 'Hold expiry not set'}
                          </div>
                        )}
                        {booking.deposit_awaiting_confirmation ? (
                          <div className="mt-1">
                            <Badge tone={privateBookingPaymentTone('deposit_to_be_confirmed')}>Deposit to be confirmed</Badge>
                          </div>
                        ) : booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                          <div className="mt-1">
                            <Badge tone={privateBookingPaymentTone(booking.deposit_status === 'Paid' ? 'deposit_paid' : 'deposit_due')}>
                              Deposit {booking.deposit_status}
                              {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                            </Badge>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="text-ui text-text-strong">
                          {formatCurrency(toNumber(booking.gross_total ?? booking.calculated_total ?? booking.total_amount))}
                        </div>
                        {booking.final_payment_date ? (
                          <div className={`text-meta font-medium ${privateBookingPaymentTextClass('paid_in_full')}`}>Fully paid</div>
                        ) : booking.balance_remaining != null && booking.balance_remaining > 0 ? (
                          <div className={`text-meta font-medium ${privateBookingPaymentTextClass('balance_due')}`}>
                            Balance: {formatCurrency(booking.balance_remaining)}
                          </div>
                        ) : null}
                        {booking.deposit_paid_date && (
                          <div className="text-meta text-text-muted">Deposit paid {formatDateFull(booking.deposit_paid_date)}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <Link
                            href={`/private-bookings/${booking.id}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            View
                          </Link>

                          {booking.status === 'draft' && permissions.hasEditPermission && (
                            <>
                              {renderExtendHoldSelect(booking.id)}
                              {extendingHoldId === booking.id && <Spinner size="sm" />}
                            </>
                          )}

                          {booking.status === 'confirmed' && (
                            <Button variant="danger" size="sm" onClick={() => handleCancelRequest(booking.id)}>
                              Cancel Booking
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
                        <div className="text-xs text-text-soft mt-1">
                          {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                        </div>
                      )}
                      {booking.status === 'draft' && (
                        <div className="text-xs text-text-muted mt-1">
                          {getHoldExpiryCountdown(booking.hold_expiry) ?? 'Hold expiry not set'}
                        </div>
                      )}
                    </div>
                    <Badge tone={privateBookingStatusTone(booking.status)} dot>{privateBookingStatusLabel(booking.status)}</Badge>
                  </div>

                  {booking.contact_phone && (
                    <div className="text-sm text-text-muted mb-2 flex items-center gap-1">
                      <Icon name="phone" size={12} />
                      {booking.contact_phone}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div className="text-text-muted">
                      <div className="flex items-center gap-1">
                        <Icon name="users" size={16} />
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
                        <div className={`text-xs font-medium ${privateBookingPaymentTextClass('paid_in_full')}`}>Fully paid</div>
                      ) : booking.balance_remaining != null && booking.balance_remaining > 0 ? (
                        <div className={`text-xs font-medium ${privateBookingPaymentTextClass('balance_due')}`}>
                          Balance: {formatCurrency(booking.balance_remaining)}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {booking.deposit_awaiting_confirmation ? (
                    <div className="mb-3">
                      <Badge tone={privateBookingPaymentTone('deposit_to_be_confirmed')}>Deposit to be confirmed</Badge>
                    </div>
                  ) : booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                    <div className="mb-3">
                      <Badge tone={privateBookingPaymentTone(booking.deposit_status === 'Paid' ? 'deposit_paid' : 'deposit_due')}>
                        Deposit {booking.deposit_status}
                        {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                      </Badge>
                    </div>
                  )}

                  <div className="flex justify-end items-center gap-2 pt-2 border-t border-border flex-wrap" onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={`/private-bookings/${booking.id}`}
                      className="inline-flex min-h-touch md:min-h-0 items-center text-sm font-medium text-primary hover:underline px-3 py-1"
                    >
                      View Details
                    </Link>
                    {booking.status === 'draft' && permissions.hasEditPermission && (
                      <div className="flex items-center gap-1">
                        {renderExtendHoldSelect(booking.id)}
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
      )}

    </PageLayout>
  )
}
