'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Event } from '@/types/database'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { 
  CalendarIcon, 
  UserGroupIcon,
  ChartBarIcon,
  ExclamationCircleIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  BellAlertIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline'

interface EventWithBookings extends Event {
  total_seats: number
  total_bookings: number
}

interface DashboardStats {
  // Core Stats
  totalCustomers: number
  totalUpcomingEvents: number
  totalBookings: number
  averageSeatsPerEvent: number
  eventsAtCapacity: number
  eventsNearCapacity: number
  
  // Employee Stats
  totalEmployees: number
  activeEmployees: number
  
  // SMS Stats
  totalMessagesSent: number
  smsDeliveryRate: number
  activeCustomersForSms: number
  
  // System Health
  templateCount: number
  scheduledReminders: number
}

interface RecentActivity {
  id: string
  type: 'booking' | 'message' | 'employee' | 'template'
  message: string
  timestamp: string
  status?: 'success' | 'warning' | 'error'
}

export default function DashboardPage() {
  const supabase = useSupabase()
  const [events, setEvents] = useState<EventWithBookings[]>([])
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    totalUpcomingEvents: 0,
    totalBookings: 0,
    averageSeatsPerEvent: 0,
    eventsAtCapacity: 0,
    eventsNearCapacity: 0,
    totalEmployees: 0,
    activeEmployees: 0,
    totalMessagesSent: 0,
    smsDeliveryRate: 0,
    activeCustomersForSms: 0,
    templateCount: 0,
    scheduledReminders: 0
  })
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setIsLoading(true)
        
        // Get events for the next 30 days
        const thirtyDaysFromNow = new Date()
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
        const today = new Date().toISOString().split('T')[0]
        
        // Get events
        const { data: eventsData, error: eventsError } = await supabase
          .from('events')
          .select('*')
          .gte('date', today)
          .lte('date', thirtyDaysFromNow.toISOString().split('T')[0])
          .order('date', { ascending: true })

        if (eventsError) throw eventsError

        // Get bookings for these events
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('event_id, seats, created_at')
          .in('event_id', eventsData?.map(e => e.id) || [])

        if (bookingsError) throw bookingsError

        // Get customer statistics
        const { data: customerData, error: customerError } = await supabase
          .from('customers')
          .select('id, sms_opt_in, created_at')

        if (customerError) throw customerError

        // Get employee statistics
        const { data: employeeData, error: employeeError } = await supabase
          .from('employees')
          .select('employee_id, status')

        if (employeeError) throw employeeError

        // Get message statistics (last 30 days)
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        
        const { data: messageData, error: messageError } = await supabase
          .from('messages')
          .select('twilio_status, created_at')
          .eq('direction', 'outbound')
          .gte('created_at', thirtyDaysAgo.toISOString())

        if (messageError) throw messageError

        // Get template count
        const { count: templateCount, error: templateError } = await supabase
          .from('message_templates')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)

        if (templateError) throw templateError

        // Calculate event statistics
        const eventsWithBookings = eventsData?.map(event => {
          const eventBookings = bookingsData?.filter(b => b.event_id === event.id) || []
          const total_seats = eventBookings.reduce((sum, booking) => sum + (booking.seats || 0), 0)
          const total_bookings = eventBookings.filter(b => b.seats && b.seats > 0).length
          return { ...event, total_seats, total_bookings }
        }) || []

        // Calculate dashboard statistics
        const totalBookings = bookingsData?.filter(b => b.seats && b.seats > 0).length || 0
        const totalSeats = bookingsData?.reduce((sum, booking) => sum + (booking.seats || 0), 0) || 0
        const eventsAtCapacity = eventsWithBookings.filter(event => 
          event.capacity && event.total_seats >= event.capacity
        ).length
        const eventsNearCapacity = eventsWithBookings.filter(event => 
          event.capacity && 
          event.total_seats >= event.capacity * 0.8 && 
          event.total_seats < event.capacity
        ).length

        // Calculate SMS statistics
        const deliveredMessages = messageData?.filter(m => m.twilio_status === 'delivered').length || 0
        const totalMessages = messageData?.length || 0
        const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0

        // Calculate scheduled reminders (upcoming events with bookings)
        const scheduledReminders = eventsWithBookings.filter(e => e.total_bookings > 0).length * 2 // 7-day and 24-hour reminders

        // Build recent activity
        const activities: RecentActivity[] = []
        
        // Recent bookings
        const recentBookings = bookingsData?.filter(b => b.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 3) || []
        
        recentBookings.forEach(booking => {
          activities.push({
            id: `booking-${booking.event_id}`,
            type: 'booking',
            message: `New booking: ${booking.seats} seats`,
            timestamp: booking.created_at,
            status: 'success'
          })
        })

        // Recent messages
        const recentMessages = messageData?.filter(m => m.created_at)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 2) || []
        
        recentMessages.forEach(message => {
          activities.push({
            id: `message-${message.created_at}`,
            type: 'message',
            message: `SMS ${message.twilio_status === 'delivered' ? 'delivered' : 'sent'}`,
            timestamp: message.created_at,
            status: message.twilio_status === 'delivered' ? 'success' : 'warning'
          })
        })

        // Sort activities by timestamp
        activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

        setEvents(eventsWithBookings)
        setStats({
          totalCustomers: customerData?.length || 0,
          totalUpcomingEvents: eventsData?.length || 0,
          totalBookings,
          averageSeatsPerEvent: eventsData?.length ? Math.round(totalSeats / eventsData.length) : 0,
          eventsAtCapacity,
          eventsNearCapacity,
          totalEmployees: employeeData?.length || 0,
          activeEmployees: employeeData?.filter(e => e.status === 'Active').length || 0,
          totalMessagesSent: totalMessages,
          smsDeliveryRate: Math.round(deliveryRate),
          activeCustomersForSms: customerData?.filter(c => c.sms_opt_in !== false).length || 0,
          templateCount: templateCount || 0,
          scheduledReminders
        })
        setRecentActivity(activities.slice(0, 5))
      } catch (error) {
        console.error('Error loading dashboard data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboardData()
  }, [supabase])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome to The Anchor Management Tools
        </p>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Customers */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UserGroupIcon className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Customers</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.totalCustomers}</div>
                    <Link href="/customers" className="ml-2 text-sm text-indigo-600 hover:text-indigo-500">
                      View all
                    </Link>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* Events */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CalendarIcon className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Upcoming Events</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.totalUpcomingEvents}</div>
                    <Link href="/events" className="ml-2 text-sm text-indigo-600 hover:text-indigo-500">
                      Manage
                    </Link>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* Employees */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UsersIcon className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Active Employees</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">
                      {stats.activeEmployees}
                      <span className="text-sm text-gray-500 font-normal">/{stats.totalEmployees}</span>
                    </div>
                    <Link href="/employees" className="ml-2 text-sm text-indigo-600 hover:text-indigo-500">
                      Manage
                    </Link>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* SMS Health */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ChatBubbleLeftRightIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">SMS Delivery Rate</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">{stats.smsDeliveryRate}%</div>
                    <Link href="/settings/sms-health" className="ml-2 text-sm text-indigo-600 hover:text-indigo-500">
                      Details
                    </Link>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Events & Capacity - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Capacity Alerts */}
          {(stats.eventsAtCapacity > 0 || stats.eventsNearCapacity > 0) && (
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 flex items-center">
                  <ExclamationCircleIcon className="h-5 w-5 text-yellow-400 mr-2" />
                  Capacity Alerts
                </h3>
                <div className="mt-4 space-y-3">
                  {stats.eventsAtCapacity > 0 && (
                    <div className="flex items-center text-sm">
                      <XCircleIcon className="h-4 w-4 text-red-500 mr-2" />
                      <span className="text-red-700">
                        {stats.eventsAtCapacity} event{stats.eventsAtCapacity > 1 ? 's' : ''} at full capacity
                      </span>
                    </div>
                  )}
                  {stats.eventsNearCapacity > 0 && (
                    <div className="flex items-center text-sm">
                      <ClockIcon className="h-4 w-4 text-yellow-500 mr-2" />
                      <span className="text-yellow-700">
                        {stats.eventsNearCapacity} event{stats.eventsNearCapacity > 1 ? 's' : ''} near capacity (≥80%)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Upcoming Events */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Upcoming Events
                </h3>
                <Link 
                  href="/events"
                  className="text-sm text-indigo-600 hover:text-indigo-500"
                >
                  Create Event
                </Link>
              </div>
              
              <div className="space-y-4">
                {events.slice(0, 5).map(event => {
                  const capacityPercentage = event.capacity 
                    ? Math.round((event.total_seats / event.capacity) * 100) 
                    : 0
                  const isAtCapacity = event.capacity && event.total_seats >= event.capacity
                  const isNearCapacity = event.capacity && event.total_seats >= event.capacity * 0.8

                  return (
                    <div key={event.id} className="border rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <Link 
                            href={`/events/${event.id}`}
                            className="text-base font-medium text-gray-900 hover:text-indigo-600"
                          >
                            {event.name}
                          </Link>
                          <p className="text-sm text-gray-500 mt-1">
                            {formatDate(event.date)} at {event.time}
                          </p>
                          <div className="flex items-center mt-2 space-x-4 text-sm">
                            <span className="text-gray-600">
                              {event.total_bookings} booking{event.total_bookings !== 1 ? 's' : ''}
                            </span>
                            <span className="text-gray-600">
                              {event.total_seats} seat{event.total_seats !== 1 ? 's' : ''} booked
                            </span>
                          </div>
                        </div>
                        
                        {event.capacity && (
                          <div className="ml-4 text-right">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              isAtCapacity 
                                ? 'bg-red-100 text-red-800' 
                                : isNearCapacity 
                                  ? 'bg-yellow-100 text-yellow-800' 
                                  : 'bg-green-100 text-green-800'
                            }`}>
                              {capacityPercentage}% Full
                            </span>
                            {event.capacity && (
                              <p className="text-xs text-gray-500 mt-1">
                                {event.total_seats}/{event.capacity} capacity
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {events.length === 0 && (
                  <div className="text-center py-6">
                    <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-500">No upcoming events</p>
                    <Link
                      href="/events"
                      className="mt-3 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      Create your first event
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - System Status & Activity */}
        <div className="space-y-6">
          {/* System Health */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                System Health
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 flex items-center">
                    <BellAlertIcon className="h-4 w-4 mr-2 text-gray-400" />
                    Scheduled Reminders
                  </span>
                  <span className="text-sm font-medium">{stats.scheduledReminders}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 flex items-center">
                    <DocumentTextIcon className="h-4 w-4 mr-2 text-gray-400" />
                    Active Templates
                  </span>
                  <span className="text-sm font-medium">{stats.templateCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 flex items-center">
                    <ChatBubbleLeftRightIcon className="h-4 w-4 mr-2 text-gray-400" />
                    SMS-Enabled Customers
                  </span>
                  <span className="text-sm font-medium">
                    {stats.activeCustomersForSms}/{stats.totalCustomers}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 flex items-center">
                    <ChartBarIcon className="h-4 w-4 mr-2 text-gray-400" />
                    Messages (30 days)
                  </span>
                  <span className="text-sm font-medium">{stats.totalMessagesSent}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Recent Activity
              </h3>
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      {activity.status === 'success' && (
                        <CheckCircleIcon className="h-5 w-5 text-green-400" />
                      )}
                      {activity.status === 'warning' && (
                        <ClockIcon className="h-5 w-5 text-yellow-400" />
                      )}
                      {activity.status === 'error' && (
                        <XCircleIcon className="h-5 w-5 text-red-400" />
                      )}
                      {!activity.status && (
                        <div className="h-2 w-2 bg-gray-400 rounded-full mt-1.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{activity.message}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                
                {recentActivity.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No recent activity
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Quick Actions
              </h3>
              <div className="space-y-2">
                <Link
                  href="/events"
                  className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Create Event
                </Link>
                <Link
                  href="/customers"
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Add Customer
                </Link>
                <Link
                  href="/messages"
                  className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  View Messages
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}