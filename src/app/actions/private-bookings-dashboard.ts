'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { PrivateBookingWithDetails, BookingStatus } from '@/types/private-bookings'

interface FetchOptions {
  status?: BookingStatus | 'all'
  dateFilter?: 'all' | 'upcoming' | 'past'
  search?: string
  page?: number
  pageSize?: number
}

const ITEMS_PER_PAGE_DEFAULT = 20
const VIEW_NAME = 'private_bookings_with_details'
const DATE_TBD_NOTE = 'Event date/time to be confirmed'

const SELECT_FIELDS = `
  id,
  customer_id,
  customer_name,
  customer_first_name,
  customer_last_name,
  customer_full_name,
  customer_mobile,
  contact_phone,
  event_type,
  event_date,
  start_time,
  end_time,
  end_time_next_day,
  status,
  guest_count,
  total_amount,
  calculated_total,
  deposit_amount,
  deposit_paid_date,
  deposit_status,
  days_until_event,
  internal_notes,
  contract_version,
  created_at,
  updated_at
`

type BookingRow = {
  id: string
  event_date: string | null
  start_time?: string | null
  end_time?: string | null
  end_time_next_day?: boolean | null
  status: string
  deposit_paid_date: string | null
  deposit_status?: string | null
  internal_notes?: string | null
  customer_id?: string | null
  customer_name?: string | null
  customer_first_name?: string | null
  customer_last_name?: string | null
  customer_full_name?: string | null
  customer_mobile?: string | null
  contact_phone?: string | null
  event_type?: string | null
  guest_count?: number | string | null
  total_amount?: number | string | null
  calculated_total?: number | string | null
  deposit_amount?: number | string | null
  days_until_event?: number | string | null
  created_at?: string | null
  updated_at?: string | null
  [key: string]: unknown
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function escapeLikeValue(value: string) {
  return value.replace(/[%_\\]/g, '\\$&')
}

export async function fetchPrivateBookings(options: FetchOptions) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Authentication required' }
  }

  const canView = await checkUserPermission('private_bookings', 'view', user.id)
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  const {
    status = 'all',
    dateFilter = 'upcoming',
    search = '',
    page = 1,
    pageSize = ITEMS_PER_PAGE_DEFAULT,
  } = options

  const limit = pageSize > 0 ? pageSize : ITEMS_PER_PAGE_DEFAULT
  const from = Math.max(page - 1, 0) * limit
  const to = from + limit - 1
  const today = getTodayIsoDate()
  const trimmedSearch = search.trim()
  const escapedSearch = trimmedSearch ? escapeLikeValue(trimmedSearch) : ''

  const excludeCancelledForUpcoming = status === 'all' && dateFilter === 'upcoming'

  const buildSelectQuery = (withCount = false) => {
    let builder = supabase
      .from(VIEW_NAME)
      .select(SELECT_FIELDS, withCount ? { count: 'exact' } : undefined)

    if (status !== 'all') {
      builder = builder.eq('status', status)
    } else if (excludeCancelledForUpcoming) {
      builder = builder.neq('status', 'cancelled')
    }

    if (trimmedSearch) {
      builder = builder.ilike('customer_name', `%${escapedSearch}%`)
    }

    return builder
  }

  const buildCountQuery = () => {
    let builder = supabase.from(VIEW_NAME).select('id', { count: 'exact', head: true })

    if (status !== 'all') {
      builder = builder.eq('status', status)
    } else if (excludeCancelledForUpcoming) {
      builder = builder.neq('status', 'cancelled')
    }

    if (trimmedSearch) {
      builder = builder.ilike('customer_name', `%${escapedSearch}%`)
    }

    return builder
  }

  const includeUndatedDrafts = dateFilter === 'upcoming' && (status === 'all' || status === 'draft')
  const tbdNoteEscaped = DATE_TBD_NOTE.replace(/%/g, '\\%')

  let rawBookings: BookingRow[] = []
  let totalCountValue = 0

  try {
    if (dateFilter === 'upcoming') {
      const futureCountResult = await buildCountQuery().gte('event_date', today)
      if (futureCountResult.error) {
        console.error('Error counting future bookings', futureCountResult.error)
        return { error: 'Failed to load bookings' }
      }

      const futureCount = futureCountResult.count ?? 0
      let undatedCount = 0

      if (includeUndatedDrafts) {
        const undatedCountResult = await buildCountQuery()
          .or(`event_date.is.null,and(event_date.lt.${today},internal_notes.ilike.%${tbdNoteEscaped}%)`)
          .eq('status', 'draft')

        if (undatedCountResult.error) {
          console.error('Error counting undated drafts', undatedCountResult.error)
          return { error: 'Failed to load bookings' }
        }

        undatedCount = undatedCountResult.count ?? 0
      }

      totalCountValue = futureCount + undatedCount
      const upcomingRows: BookingRow[] = []

      if (includeUndatedDrafts && undatedCount > 0 && from <= undatedCount - 1) {
        const undatedFrom = from
        const undatedTo = Math.min(to, undatedCount - 1)

        const undatedResult = await buildSelectQuery()
          .or(`event_date.is.null,and(event_date.lt.${today},internal_notes.ilike.%${tbdNoteEscaped}%)`)
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
          .range(undatedFrom, undatedTo)

        if (undatedResult.error) {
          console.error('Error fetching undated drafts', undatedResult.error)
          return { error: 'Failed to load bookings' }
        }

        upcomingRows.push(...((undatedResult.data as BookingRow[]) || []))
      }

      if (futureCount > 0 && to >= undatedCount) {
        const futureFrom = Math.max(from - undatedCount, 0)
        const futureTo = Math.min(to - undatedCount, futureCount - 1)

        if (futureFrom <= futureTo) {
          const futureResult = await buildSelectQuery()
            .gte('event_date', today)
            .order('event_date', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false })
            .range(futureFrom, futureTo)

          if (futureResult.error) {
            console.error('Error fetching upcoming bookings', futureResult.error)
            return { error: 'Failed to load bookings' }
          }

          upcomingRows.push(...((futureResult.data as BookingRow[]) || []))
        }
      }

      rawBookings = upcomingRows
    } else {
      let query = buildSelectQuery(true)

      if (dateFilter === 'past') {
        query = query.lt('event_date', today)
      }

      query = query
        .order('event_date', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })
        .range(from, to)

      const { data, count, error } = await query

      if (error) {
        console.error('Error fetching bookings', error)
        return { error: 'Failed to load bookings' }
      }

      rawBookings = (data as BookingRow[]) || []
      totalCountValue = count || 0
    }

    const enriched = rawBookings.map((booking) => {
      const calculatedTotal = booking.calculated_total == null ? undefined : toNumber(booking.calculated_total)
      const totalAmount = calculatedTotal ?? toNumber(booking.total_amount)
      const depositAmount = booking.deposit_amount == null ? undefined : toNumber(booking.deposit_amount)
      const guestCount = booking.guest_count == null ? undefined : toNumber(booking.guest_count)
      const internalNotes = typeof booking.internal_notes === 'string' ? booking.internal_notes : undefined
      const isDateTbd = !booking.event_date || (internalNotes?.includes(DATE_TBD_NOTE) ?? false)

      const eventDateValue = booking.event_date ? new Date(booking.event_date) : null
      const daysUntilEvent =
        booking.days_until_event == null
          ? eventDateValue
            ? Math.ceil((eventDateValue.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
            : null
          : toNumber(booking.days_until_event)

      const customerName =
        booking.customer_full_name ||
        booking.customer_name ||
        [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ') ||
        'Unnamed booking'

      const phone = booking.contact_phone || booking.customer_mobile || undefined
      const normalizedDepositStatus =
        typeof booking.deposit_status === 'string'
          ? booking.deposit_status
          : booking.deposit_paid_date
            ? 'Paid'
            : booking.status === 'confirmed'
              ? 'Required'
              : 'Not Required'

      return {
        ...booking,
        customer_name: customerName,
        contact_phone: phone,
        status: booking.status as BookingStatus,
        days_until_event: daysUntilEvent,
        deposit_status: normalizedDepositStatus,
        total_amount: totalAmount,
        calculated_total: calculatedTotal,
        deposit_amount: depositAmount,
        guest_count: guestCount,
        internal_notes: internalNotes,
        is_date_tbd: isDateTbd,
        customer: booking.customer_id
          ? {
              id: booking.customer_id,
              first_name: booking.customer_first_name || customerName,
              last_name: booking.customer_last_name || '',
              phone: booking.customer_mobile || undefined,
            }
          : undefined,
      } as PrivateBookingDashboardItem
    })

    return {
      success: true as const,
      data: enriched,
      totalCount: totalCountValue,
    }
  } catch (error) {
    console.error('Unexpected error fetching private bookings', error)
    return { error: 'Failed to load bookings' }
  }
}

export type PrivateBookingDashboardItem = PrivateBookingWithDetails & {
  is_date_tbd?: boolean
  internal_notes?: string
}

export async function fetchPrivateBookingsForCalendar() {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Authentication required' }
  }

  const canView = await checkUserPermission('private_bookings', 'view', user.id)
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  const { data, error } = await supabase
    .from('private_bookings')
    .select('id, customer_name, event_date, start_time, end_time, end_time_next_day, status, event_type, guest_count')
    .order('event_date', { ascending: true })

  if (error) {
    console.error('Error fetching bookings for calendar', error)
    return { error: 'Failed to load bookings' }
  }

  return {
    success: true as const,
    data: data ?? []
  }
}
