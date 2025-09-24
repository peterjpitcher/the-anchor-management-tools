'use server'

import { getSupabaseAdminClient } from '@/lib/supabase-singleton'
import { unstable_cache } from 'next/cache'
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'

// Cache dashboard data for 1 minute
export const getDashboardData = unstable_cache(
  async () => {
    const supabase = getSupabaseAdminClient()
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Execute all queries in parallel
    const [
      eventsResult,
      bookingsResult,
      customersResult,
      recentCustomersResult,
      messagesResult,
      employeesResult,
      templatesResult
    ] = await Promise.all([
      // Total events
      supabase
        .from('events')
        .select('id', { count: 'exact', head: true }),
      
      // Recent bookings count
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString()),
      
      // Total customers
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true }),
      
      // Recent customers
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo.toISOString()),
      
      // Unread messages
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'inbound')
        .is('read_at', null),
      
      // Active employees
      supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      
      // Active templates
      supabase
        .from('message_templates')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
    ])

    // Get upcoming events (next 7 days) with booking counts
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const { data: upcomingEvents } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time,
        capacity,
        bookings (id, seats)
      `)
      .gte('date', getTodayIsoDate())
      .lte('date', getLocalIsoDateDaysAhead(7))
      .order('date', { ascending: true })
      .limit(5)

    // Process upcoming events
    const upcomingEventsWithCounts = upcomingEvents?.map(event => ({
      ...event,
      bookingCount: event.bookings?.reduce((sum, booking) => sum + (booking.seats || 0), 0) || 0,
      max_attendees: event.capacity, // Map capacity to max_attendees for compatibility
      event_date: `${event.date}T${event.time}`, // Combine date and time for display
      bookings: undefined // Remove raw bookings data
    })) || []

    return {
      stats: {
        totalEvents: eventsResult.count || 0,
        recentBookings: bookingsResult.count || 0,
        totalCustomers: customersResult.count || 0,
        newCustomers: recentCustomersResult.count || 0,
        unreadMessages: messagesResult.count || 0,
        activeEmployees: employeesResult.count || 0,
        activeTemplates: templatesResult.count || 0
      },
      upcomingEvents: upcomingEventsWithCounts,
      timestamp: now.toISOString()
    }
  },
  ['dashboard-data'],
  {
    revalidate: 60, // Cache for 1 minute
    tags: ['dashboard']
  }
)

// Get activity feed data with caching
export const getActivityFeedData = unstable_cache(
  async (limit: number = 10) => {
    const supabase = getSupabaseAdminClient()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Fetch recent activities in parallel
    const [
      bookingsResult,
      messagesResult,
      customersResult
    ] = await Promise.all([
      // Recent bookings
      supabase
        .from('bookings')
        .select(`
          id,
          created_at,
          event:events(name),
          customer:customers(first_name, last_name)
        `)
        .gte('created_at', oneDayAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit),
      
      // Recent messages
      supabase
        .from('messages')
        .select(`
          id,
          created_at,
          direction,
          customer:customers(first_name, last_name)
        `)
        .gte('created_at', oneDayAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit),
      
      // New customers
      supabase
        .from('customers')
        .select('id, first_name, last_name, created_at')
        .gte('created_at', oneDayAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit)
    ])

    // Combine and sort activities
    const activities = [
      ...(bookingsResult.data || []).map((b: any) => ({
        type: 'booking' as const,
        id: b.id,
        timestamp: b.created_at,
        description: `New booking for ${b.event?.name || 'Unknown Event'}`,
        customer: b.customer
      })),
      ...(messagesResult.data || []).map((m: any) => ({
        type: 'message' as const,
        id: m.id,
        timestamp: m.created_at,
        description: m.direction === 'inbound' ? 'New message received' : 'Message sent',
        customer: m.customer
      })),
      ...(customersResult.data || []).map((c: any) => ({
        type: 'customer' as const,
        id: c.id,
        timestamp: c.created_at,
        description: 'New customer registered',
        customer: { first_name: c.first_name, last_name: c.last_name }
      }))
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)

    return activities
  },
  ['activity-feed'],
  {
    revalidate: 30, // Cache for 30 seconds
    tags: ['activity']
  }
)
