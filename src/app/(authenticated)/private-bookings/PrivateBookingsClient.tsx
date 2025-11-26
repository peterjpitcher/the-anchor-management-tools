'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  UserGroupIcon,
  PhoneIcon,
  MapPinIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  PlusIcon
} from '@heroicons/react/24/outline'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { deletePrivateBooking, cancelPrivateBooking } from '@/app/actions/privateBookingActions'
import DeleteBookingButton from '@/components/private-bookings/DeleteBookingButton'
import {
  fetchPrivateBookings,
  type PrivateBookingDashboardItem
} from '@/app/actions/private-bookings-dashboard'
import type { BookingStatus } from '@/types/private-bookings'

const DEFAULT_PAGE_SIZE = 20
const CACHE_TTL_MS = 30_000

type CacheEntry = {
  data: PrivateBookingDashboardItem[]
  totalCount: number
  timestamp: number
}

const statusConfig: Record<
  BookingStatus,
  { label: string; variant: 'success' | 'info' | 'warning' | 'error' | 'default' }
> = {
  draft: { label: 'Draft', variant: 'default' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  completed: { label: 'Completed', variant: 'info' },
  cancelled: { label: 'Cancelled', variant: 'error' }
}

interface PrivateBookingsClientProps {
  permissions: {
    hasCreatePermission: boolean
    hasDeletePermission: boolean
  }
  initialBookings: PrivateBookingDashboardItem[]
  initialTotalCount: number
  pageSize: number
}

type FetchParams = {
  status: BookingStatus | 'all'
  dateFilter: 'all' | 'upcoming' | 'past'
  search: string
  page: number
}

const buildCacheKey = (params: FetchParams, pageSize: number) =>
  JSON.stringify({
    status: params.status,
    dateFilter: params.dateFilter,
    search: params.search,
    page: params.page,
    pageSize
  })

const toNumber = (value: number | string | null | undefined) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

export default function PrivateBookingsClient({
  permissions,
  initialBookings,
  initialTotalCount,
  pageSize
}: PrivateBookingsClientProps) {
  const router = useRouter()
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const [bookings, setBookings] = useState<PrivateBookingDashboardItem[]>(initialBookings)
  const [totalCount, setTotalCount] = useState(initialTotalCount)
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isPending, startTransition] = useTransition()

  const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize))

  const debouncedSearch = useDebouncedValue(searchDraft, 300)

  useEffect(() => {
    const initialParams: FetchParams = {
      status: 'all',
      dateFilter: 'upcoming',
      search: '',
      page: 1
    }

    cacheRef.current.set(buildCacheKey(initialParams, effectivePageSize), {
      data: initialBookings,
      totalCount: initialTotalCount,
      timestamp: Date.now()
    })
  }, [initialBookings, initialTotalCount, effectivePageSize])

  const invalidateCache = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  const runFetch = useCallback(
    (params: FetchParams) => {
      setSearchTerm(params.search)
      setCurrentPage(params.page)

      const cacheKey = buildCacheKey(params, effectivePageSize)
      const cached = cacheRef.current.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setBookings(cached.data)
        setTotalCount(cached.totalCount)
        return
      }

      startTransition(async () => {
        const result = await fetchPrivateBookings({
          status: params.status,
          dateFilter: params.dateFilter,
          search: params.search,
          page: params.page,
          pageSize: effectivePageSize
        })

        if ('error' in result) {
          toast.error(result.error ?? 'Failed to load private bookings.')
          return
        }

        cacheRef.current.set(cacheKey, {
          data: result.data,
          totalCount: result.totalCount,
          timestamp: Date.now()
        })
        setBookings(result.data)
        setTotalCount(result.totalCount)
      })
    },
    [effectivePageSize]
  )

  const fetchWithState = useCallback(
    (overrides: Partial<FetchParams> = {}) => {
      const params: FetchParams = {
        status: overrides.status ?? statusFilter,
        dateFilter: overrides.dateFilter ?? dateFilter,
        search: overrides.search ?? searchTerm,
        page: overrides.page ?? currentPage
      }
      runFetch(params)
    },
    [statusFilter, dateFilter, searchTerm, currentPage, runFetch]
  )

  const handleStatusChange = (value: BookingStatus | 'all') => {
    setStatusFilter(value)
    fetchWithState({
      status: value,
      page: 1
    })
  }

  const handleDateFilterChange = (value: 'all' | 'upcoming' | 'past') => {
    setDateFilter(value)
    fetchWithState({
      dateFilter: value,
      page: 1
    })
  }

  const handleSearchChange = (value: string) => {
    setSearchDraft(value)
  }

  const handleClearFilters = () => {
    setStatusFilter('all')
    setDateFilter('upcoming')
    setSearchDraft('')
    fetchWithState({
      status: 'all',
      dateFilter: 'upcoming',
      search: '',
      page: 1
    })
  }

  const handlePageChange = (page: number) => {
    fetchWithState({ page })
  }

  const handleDeleteBooking = async (bookingId: string) => {
    const result = await deletePrivateBooking(bookingId)

    if (result.error) {
      toast.error(result.error ?? 'Failed to delete booking.')
      return
    }

    toast.success('Booking deleted successfully')
    invalidateCache()
    const nextPage = bookings.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage
    fetchWithState({ page: nextPage })
  }

  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Cancel this booking? An SMS will be sent to inform the customer.')) return

    const result = await cancelPrivateBooking(bookingId, 'Cancelled from list view')
    if ('error' in result && result.error) {
      toast.error(result.error ?? 'Failed to cancel booking.')
      return
    }

    toast.success('Booking cancelled and customer notified')
    invalidateCache()
    fetchWithState({ page: currentPage })
  }

  const loading = isPending
  const navActions = (
    <NavGroup>
      <NavLink href="/private-bookings/sms-queue">
        SMS Queue
      </NavLink>
      <NavLink href="/private-bookings/calendar">
        Calendar View
      </NavLink>
    </NavGroup>
  )

  const headerActions = permissions.hasCreatePermission ? (
    <LinkButton
      href="/private-bookings/new"
      variant="primary"
      leftIcon={<PlusIcon className="h-5 w-5" />}
    >
      New Booking
    </LinkButton>
  ) : null

  useEffect(() => {
    const trimmed = debouncedSearch.trim()
    if (trimmed === searchTerm) {
      return
    }

    fetchWithState({ search: trimmed, page: 1 })
  }, [debouncedSearch, searchTerm, fetchWithState])

  return (
    <PageLayout
      title="Private Bookings"
      subtitle="Manage private venue bookings and events"
      navActions={navActions}
      headerActions={headerActions}
    >
      <div className="space-y-6">
        <Card className="hidden sm:block">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <FormGroup label="Search">
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search customer name..."
                  value={searchDraft}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  className="pl-10"
                />
                <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              </div>
            </FormGroup>

            <FormGroup label="Status">
              <Select
                value={statusFilter}
                onChange={(event) => handleStatusChange(event.target.value as BookingStatus | 'all')}
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </FormGroup>

            <FormGroup label="Date">
              <Select
                value={dateFilter}
                onChange={(event) => handleDateFilterChange(event.target.value as 'all' | 'upcoming' | 'past')}
              >
                <option value="all">All Dates</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </Select>
            </FormGroup>

            <div className="flex items-end">
              <Button
                onClick={handleClearFilters}
                variant="secondary"
                className="w-full"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </Card>

        <Section
          title={`Bookings (${totalCount})`}
          actions={loading && <Spinner size="sm" />}
        >
          <Card>
            <DataTable<PrivateBookingDashboardItem>
              data={bookings}
              getRowKey={(booking) => booking.id}
              loading={loading}
              emptyMessage="No bookings found"
              clickableRows
              onRowClick={(booking) => router.push(`/private-bookings/${booking.id}`)}
              columns={[
                {
                  key: 'datetime',
                  header: 'Date & Time',
                  cell: (booking) => (
                    <div>
                      {booking.is_date_tbd ? (
                        <div className="text-sm font-medium text-amber-600">To be confirmed</div>
                      ) : (
                        <>
                          <div className="text-sm text-gray-900">{formatDateFull(booking.event_date)}</div>
                          <div className="text-sm text-gray-500">{formatTime12Hour(booking.start_time)}</div>
                        </>
                      )}
                      {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event !== null && booking.days_until_event >= 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  cell: (booking) => (
                    <div>
                      <div className="text-sm font-medium text-gray-900">{booking.customer_name}</div>
                      {booking.contact_phone && (
                        <div className="text-sm text-gray-500 flex items-center gap-1">
                          <PhoneIcon className="h-3 w-3" />
                          {booking.contact_phone}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'details',
                  header: 'Details',
                  cell: (booking) => (
                    <div>
                      <div className="text-sm text-gray-900 flex items-center gap-1">
                        <UserGroupIcon className="h-4 w-4 text-gray-400" />
                        {booking.guest_count ?? 0} guests
                      </div>
                      {booking.event_type && (
                        <div className="text-xs text-gray-500 mt-1">
                          {booking.event_type}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (booking) => (
                    <div>
                      <Badge variant={statusConfig[booking.status].variant} size="sm">
                        {statusConfig[booking.status].label}
                      </Badge>
                      {booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                        <div className="mt-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                              booking.deposit_status === 'Paid'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            Deposit {booking.deposit_status}
                            {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'financials',
                  header: 'Financials',
                  cell: (booking) => (
                    <div className="text-sm text-gray-900">
                      <div>Total: {formatCurrency(toNumber(booking.calculated_total ?? booking.total_amount))}</div>
                      {booking.deposit_paid_date && (
                        <div className="text-xs text-gray-500">
                          Deposit paid {formatDateFull(booking.deposit_paid_date)}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  cell: (booking) => (
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/private-bookings/${booking.id}`}
                        className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                      >
                        View
                      </Link>
                      {booking.status === 'confirmed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelBooking(booking.id)}
                        >
                          Cancel
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
                  )
                }
              ]}
              renderMobileCard={(booking) => (
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="font-medium text-gray-900 truncate">{booking.customer_name}</div>
                      {booking.is_date_tbd ? (
                        <div className="text-sm text-amber-600">Date to be confirmed</div>
                      ) : (
                        <>
                          <div className="text-sm text-gray-500">{formatDateFull(booking.event_date)}</div>
                          <div className="text-sm text-gray-500">{formatTime12Hour(booking.start_time)}</div>
                        </>
                      )}
                      {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event !== null && booking.days_until_event >= 0 && (
                        <div className="text-xs text-gray-400 mt-1">
                          {booking.days_until_event === 0 ? 'Today' : `${booking.days_until_event} days`}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <Badge variant={statusConfig[booking.status].variant} size="sm">
                        {statusConfig[booking.status].label}
                      </Badge>
                    </div>
                  </div>

                  {booking.contact_phone && (
                    <div className="text-sm text-gray-500 mb-2 flex items-center gap-1">
                      <PhoneIcon className="h-3 w-3" />
                      {booking.contact_phone}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div className="text-gray-500">
                      <div className="flex items-center gap-1">
                        <UserGroupIcon className="h-4 w-4" />
                        <span>{booking.guest_count ?? 0} guests</span>
                      </div>
                      {booking.event_type && (
                        <div className="text-xs text-gray-500 mt-1">
                          {booking.event_type}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-medium">
                        {formatCurrency(toNumber(booking.calculated_total ?? booking.total_amount))}
                      </span>
                    </div>
                  </div>

                  {booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                    <div className="mb-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                          booking.deposit_status === 'Paid'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        Deposit {booking.deposit_status}
                        {booking.deposit_amount != null && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-end items-center gap-2 pt-2 border-t">
                    <Link
                      href={`/private-bookings/${booking.id}`}
                      className="text-blue-600 hover:text-blue-900 text-sm font-medium px-3 py-1"
                    >
                      View Details
                    </Link>
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
              )}
            />

            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={effectivePageSize}
                totalItems={totalCount}
                onPageChange={handlePageChange}
              />
            )}
          </Card>
        </Section>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
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
    </PageLayout>
  )
}
