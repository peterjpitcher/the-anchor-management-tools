'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  UserGroupIcon,
  PhoneIcon,
  MapPinIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { deletePrivateBooking, cancelPrivateBooking } from '@/app/actions/privateBookingActions'
import DeleteBookingButton from '@/components/private-bookings/DeleteBookingButton'
import type { PrivateBookingWithDetails, BookingStatus } from '@/types/private-bookings'
import { formatDateFull, formatTime12Hour, getTodayIsoDate } from '@/lib/dateUtils'
import { useSupabase } from '@/components/providers/SupabaseProvider'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { formatCurrency } from '@/components/ui-v2/utils/format'

type BookingListItem = PrivateBookingWithDetails & {
  is_date_tbd?: boolean
  internal_notes?: string
}

const ITEMS_PER_PAGE = 20

const DATE_TBD_NOTE = 'Event date/time to be confirmed'

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value === null || value === undefined) {
    return 0
  }
  return 0
}

// Status configuration
const statusConfig: Record<BookingStatus, { 
  label: string
  variant: 'success' | 'info' | 'warning' | 'error' | 'default'
}> = {
  draft: { 
    label: 'Draft', 
    variant: 'default'
  },
  confirmed: { 
    label: 'Confirmed', 
    variant: 'success'
  },
  completed: { 
    label: 'Completed', 
    variant: 'info'
  },
  cancelled: { 
    label: 'Cancelled', 
    variant: 'error'
  }
}

interface Props {
  permissions: {
    hasCreatePermission: boolean
    hasDeletePermission: boolean
  }
}

export default function PrivateBookingsClient({ permissions }: Props) {
  const router = useRouter()
  const supabase = useSupabase()
  const [bookings, setBookings] = useState<BookingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming')

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      const from = (currentPage - 1) * ITEMS_PER_PAGE
      const to = from + ITEMS_PER_PAGE - 1

      // Build query - only fetch essential data for list view
      let query = supabase
        .from('private_bookings')
        .select(`
          id,
          event_date,
          start_time,
          customer_name,
          contact_phone,
          status,
          guest_count,
          total_amount,
          deposit_amount,
          deposit_paid_date,
          internal_notes,
          contract_version,
          created_at,
          updated_at,
          customer:customers(
            id,
            first_name,
            last_name,
            mobile_number
          )
        `, { count: 'exact' })
        .range(from, to)
        .order('event_date', { ascending: false })

      // Apply filters
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (searchTerm) {
        query = query.ilike('customer_name', `%${searchTerm}%`)
      }

      const today = getTodayIsoDate()
      if (dateFilter === 'upcoming') {
        query = query.gte('event_date', today)
      } else if (dateFilter === 'past') {
        query = query.lt('event_date', today)
      }

      const { data, count, error } = await query

      if (error) {
        console.error('Error fetching bookings:', error)
        toast.error('Failed to load bookings')
        return
      }

      // Calculate days until event
      type CustomerRow = { id: string; first_name: string; last_name: string; mobile_number: string | null }
      type BookingRow = {
        event_date: string
        status: string
        deposit_paid_date: string | null
        internal_notes?: string | null
        customer?: CustomerRow[] | CustomerRow
        [key: string]: unknown
      }

      const enrichedBookings = (data || []).map((booking: BookingRow) => {
        // Extract customer from array (Supabase returns it as an array)
        const customerData = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
        
        const totalAmount = toNumber(booking.total_amount)
        const depositAmount = booking.deposit_amount === null || booking.deposit_amount === undefined
          ? undefined
          : toNumber(booking.deposit_amount)
        const guestCount = booking.guest_count === null || booking.guest_count === undefined
          ? undefined
          : toNumber(booking.guest_count)
        const internalNotes = typeof booking.internal_notes === 'string' ? booking.internal_notes : undefined
        const isDateTbd = internalNotes?.includes(DATE_TBD_NOTE) ?? false

        return {
          ...booking,
          days_until_event: Math.ceil((new Date(booking.event_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
          deposit_status: booking.deposit_paid_date 
            ? 'Paid' as const
            : booking.status === 'confirmed' 
              ? 'Required' as const
              : 'Not Required' as const,
          total_amount: totalAmount,
          deposit_amount: depositAmount,
          guest_count: guestCount,
          internal_notes: internalNotes,
          is_date_tbd: isDateTbd,
          customer: customerData ? {
            id: customerData.id,
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            phone: customerData.mobile_number || undefined
          } : undefined
        }
      })

      setBookings(enrichedBookings as BookingListItem[])
      setTotalCount(count || 0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, statusFilter, searchTerm, dateFilter, supabase])

  useEffect(() => {
    fetchBookings()
  }, [fetchBookings])

  const handleDeleteBooking = async (bookingId: string) => {
    const result = await deletePrivateBooking(bookingId)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Booking deleted successfully')
      fetchBookings()
    }
  }

  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Cancel this booking? An SMS will be sent to inform the customer.')) return
    const result = await cancelPrivateBooking(bookingId, 'Cancelled from list view')
    if ('error' in result && result.error) {
      toast.error(result.error)
    } else {
      toast.success('Booking cancelled and customer notified')
      fetchBookings()
    }
  }

  const formatDate = (date: string) => formatDateFull(date)
  const formatTime = (time: string) => formatTime12Hour(time)

  return (
    <PageWrapper>
      <PageHeader
        title="Private Bookings"
        subtitle="Manage private venue bookings and events"
        backButton={{
          label: "Back to Dashboard",
          href: "/"
        }}
        actions={
          <NavGroup>
            <NavLink href="/private-bookings/sms-queue">
              SMS Queue
            </NavLink>
            <NavLink href="/private-bookings/calendar">
              Calendar View
            </NavLink>
            {permissions.hasCreatePermission && (
              <NavLink href="/private-bookings/new">
                Add Booking
              </NavLink>
            )}
          </NavGroup>
        }
      />
      
      <PageContent>
        {/* Filters - Hidden on mobile */}
        <Card className="hidden sm:block">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <FormGroup label="Search">
            <div className="relative">
              <Input
                type="text"
                placeholder="Search customer name..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
                className="pl-10"
              />
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
            </div>
          </FormGroup>
          
          <FormGroup label="Status">
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as BookingStatus | 'all')
                setCurrentPage(1)
              }}
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
              onChange={(e) => {
                setDateFilter(e.target.value as 'all' | 'upcoming' | 'past')
                setCurrentPage(1)
              }}
            >
              <option value="all">All Dates</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
            </Select>
          </FormGroup>

          <div className="flex items-end">
            <Button
              onClick={() => {
                setSearchTerm('')
                setStatusFilter('all')
                setDateFilter('all')
                setCurrentPage(1)
              }}
              variant="secondary"
              className="w-full"
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Bookings Table */}
      <Section 
        title={`Bookings (${totalCount})`}
        actions={
          loading && <Spinner size="sm" />
        }
      >
        <Card>
          
          {/* Unified DataTable replacing custom table and mobile cards */}
          <DataTable
            data={bookings}
            getRowKey={(b) => b.id}
            loading={loading}
            emptyMessage="No bookings found"
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
                        <div className="text-sm text-gray-900">{formatDate(booking.event_date)}</div>
                        <div className="text-sm text-gray-500">{formatTime(booking.start_time)}</div>
                      </>
                    )}
                    {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event >= 0 && (
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
                  <div className="text-sm text-gray-900 flex items-center gap-1">
                    <UserGroupIcon className="h-4 w-4 text-gray-400" />
                    {booking.guest_count} guests
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
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                          booking.deposit_status === 'Paid' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          Deposit {booking.deposit_status}
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
              <div>
                <div className="text-sm text-gray-900">{formatCurrency(toNumber(booking.total_amount))}</div>
                {booking.deposit_amount && (
                  <div className="text-xs text-gray-500">
                    Deposit: {formatCurrency(toNumber(booking.deposit_amount))}
                  </div>
                )}
              </div>
            )
          },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (booking) => (
                  <div className="flex items-center gap-2 justify-end">
                    <Link href={`/private-bookings/${booking.id}`} className="text-blue-600 hover:text-blue-900">
                      View
                    </Link>
                    {(booking.status === 'draft' || booking.status === 'confirmed') && (
                      <button onClick={() => handleCancelBooking(booking.id)} className="text-yellow-600 hover:text-yellow-800">
                        Cancel
                      </button>
                    )}
                    {permissions.hasDeletePermission && (booking.status === 'draft' || booking.status === 'cancelled') && (
                      <DeleteBookingButton
                        bookingId={booking.id}
                        bookingName={booking.customer_name}
                        status={booking.status}
                        eventDate={booking.event_date}
                        deleteAction={async (formData: FormData) => {
                          const bookingId = formData.get('bookingId') as string;
                          await handleDeleteBooking(bookingId);
                        }}
                      />
                    )}
                  </div>
                )
              },
            ]}
            clickableRows
            onRowClick={(booking) => router.push(`/private-bookings/${booking.id}`)}
            renderMobileCard={(booking) => (
              <div>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="font-medium text-gray-900 truncate">{booking.customer_name}</div>
                    {booking.is_date_tbd ? (
                      <div className="text-sm text-amber-600">Date to be confirmed</div>
                    ) : (
                      <>
                        <div className="text-sm text-gray-500">{formatDate(booking.event_date)}</div>
                        <div className="text-sm text-gray-500">{formatTime(booking.start_time)}</div>
                      </>
                    )}
                    {!booking.is_date_tbd && booking.days_until_event !== undefined && booking.days_until_event >= 0 && (
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
                  <div className="flex items-center gap-1 text-gray-500">
                    <UserGroupIcon className="h-4 w-4" />
                    <span>{booking.guest_count} guests</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">{formatCurrency(toNumber(booking.total_amount))}</span>
                  </div>
                </div>
                {booking.deposit_status && booking.deposit_status !== 'Not Required' && (
                  <div className="mb-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                      booking.deposit_status === 'Paid' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      Deposit {booking.deposit_status}
                      {booking.deposit_amount && ` (${formatCurrency(toNumber(booking.deposit_amount))})`}
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
                      deleteAction={async (formData: FormData) => {
                        const bookingId = formData.get('bookingId') as string;
                        await handleDeleteBooking(bookingId);
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              itemsPerPage={ITEMS_PER_PAGE}
              totalItems={totalCount}
              onPageChange={setCurrentPage}
            />
          )}
        </Card>
      </Section>

      {/* Settings Section */}
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
      </PageContent>
    </PageWrapper>
  )
}
