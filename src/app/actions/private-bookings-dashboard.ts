'use server'

import { createClient } from '@/lib/supabase/server'
import type { PrivateBookingWithDetails, BookingStatus } from '@/types/private-bookings'
import { PrivateBookingService } from '@/services/private-bookings'
import { PermissionService } from '@/services/permission'

interface FetchOptions {
  status?: BookingStatus | 'all'
  dateFilter?: 'all' | 'upcoming' | 'past'
  search?: string
  page?: number
  pageSize?: number
  includeCancelled?: boolean
}

export type PrivateBookingDashboardItem = PrivateBookingWithDetails & {
  is_date_tbd?: boolean
  internal_notes?: string
}

type CalendarBooking = {
  id: string
  customer_name: string
  event_date: string
  start_time: string
  end_time: string | null
  end_time_next_day: boolean | null
  status: BookingStatus
  event_type: string | null
  guest_count: number | null
}

export async function fetchPrivateBookings(options: FetchOptions) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Authentication required' }
  }

  const canView = await PermissionService.checkUserPermission('private_bookings', 'view', user.id)
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const { data, totalCount } = await PrivateBookingService.fetchPrivateBookings(options);
    return {
      success: true as const,
      data: data,
      totalCount: totalCount,
    };
  } catch (error: any) {
    console.error('Unexpected error fetching private bookings', error)
    return { error: error.message || 'Failed to load bookings' }
  }
}

export async function fetchPrivateBookingsForCalendar() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Authentication required' }
  }

  const canView = await PermissionService.checkUserPermission('private_bookings', 'view', user.id)
  if (!canView) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const { data } = await PrivateBookingService.fetchPrivateBookingsForCalendar();
    const calendarData: CalendarBooking[] = (data || []).map((booking) => ({
      id: booking.id,
      customer_name: booking.customer_name || booking.customer_first_name || 'Unknown',
      event_date: booking.event_date,
      start_time: booking.start_time || '00:00',
      end_time: booking.end_time ?? null,
      end_time_next_day: booking.end_time_next_day ?? null,
      status: booking.status,
      event_type: booking.event_type ?? null,
      guest_count: booking.guest_count ?? null
    }))
    return {
      success: true as const,
      data: calendarData
    }
  } catch (error: any) {
    console.error('Error fetching bookings for calendar', error)
    return { error: error.message || 'Failed to load bookings' }
  }
}
