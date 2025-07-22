'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Event } from '@/types/database'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { 
  CalendarIcon, 
  UserGroupIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  ClockIcon,
  PlusIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline'

// Import new components
import { StatsCard } from '@/components/dashboard/StatsCard'
import { MessageTemplatesWidget } from '@/components/dashboard/MessageTemplatesWidget'
import { SmsHealthWidget } from '@/components/dashboard/SmsHealthWidget'
import { EmployeeActivityWidget } from '@/components/dashboard/EmployeeActivityWidget'
import { AuditTrailWidget } from '@/components/dashboard/AuditTrailWidget'
import { EnhancedActivityFeed } from '@/components/dashboard/EnhancedActivityFeed'
import { CategoryAnalyticsWidget } from '@/components/dashboard/CategoryAnalyticsWidget'
import { usePermissions } from '@/contexts/PermissionContext'

interface EventWithBookings extends Event {
  total_seats: number
  total_bookings: number
}

interface DashboardStats {
  // Core Stats
  totalCustomers: number
  newCustomersThisWeek: number
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
  
  // New Stats
  bulkMessagesSent: number
  customerGrowthRate: number
  bookingGrowthRate: number
}

export default function DashboardPage() {
  const supabase = useSupabase()
  const { hasPermission } = usePermissions()
  const [events, setEvents] = useState<EventWithBookings[]>([])
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    newCustomersThisWeek: 0,
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
    scheduledReminders: 0,
    bulkMessagesSent: 0,
    customerGrowthRate: 0,
    bookingGrowthRate: 0
  })
  const [isLoading, setIsLoading] = useState(true)

  const loadDashboardData = useCallback(async () => {
    try {
      setIsLoading(true)
      
      // Get events for the next 30 days
      const thirtyDaysFromNow = new Date()
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
      const today = new Date().toISOString().split('T')[0]
      
      // Get events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, category:event_categories(*)')
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

      // Get customers from last week for growth rate
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const twoWeeksAgo = new Date()
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

      const newCustomersThisWeek = customerData?.filter(c => 
        new Date(c.created_at) >= weekAgo
      ).length || 0

      const customersLastWeek = customerData?.filter(c => 
        new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < weekAgo
      ).length || 0

      const customerGrowthRate = customersLastWeek > 0 
        ? Math.round(((newCustomersThisWeek - customersLastWeek) / customersLastWeek) * 100)
        : 0

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

      // Get bulk message count from audit logs (default to 0 if no permission)
      let bulkMessageCount = 0
      try {
        const { count } = await supabase
          .from('audit_logs')
          .select('*', { count: 'exact', head: true })
          .eq('resource_type', 'bulk_message')
          .eq('operation_type', 'create')
          .gte('created_at', weekAgo.toISOString())
        bulkMessageCount = count || 0
      } catch {
        // Skip if no permission
      }

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

      // Calculate booking growth rate
      const bookingsThisWeek = bookingsData?.filter(b => 
        new Date(b.created_at) >= weekAgo
      ).length || 0
      const bookingsLastWeek = bookingsData?.filter(b => 
        new Date(b.created_at) >= twoWeeksAgo && new Date(b.created_at) < weekAgo
      ).length || 0
      const bookingGrowthRate = bookingsLastWeek > 0
        ? Math.round(((bookingsThisWeek - bookingsLastWeek) / bookingsLastWeek) * 100)
        : 0

      // Calculate SMS statistics
      const deliveredMessages = messageData?.filter(m => m.twilio_status === 'delivered').length || 0
      const totalMessages = messageData?.length || 0
      const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0

      // Calculate scheduled reminders
      const scheduledReminders = eventsWithBookings.filter(e => e.total_bookings > 0).length * 2

      setEvents(eventsWithBookings)
      setStats({
        totalCustomers: customerData?.length || 0,
        newCustomersThisWeek,
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
        scheduledReminders,
        bulkMessagesSent: bulkMessageCount || 0,
        customerGrowthRate,
        bookingGrowthRate
      })
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Welcome to The Anchor Management Tools
        </p>
      </div>

      {/* Enhanced Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Customers"
          value={stats.totalCustomers}
          icon={UserGroupIcon}
          iconColor="text-blue-600"
          trend={stats.customerGrowthRate !== 0 ? {
            value: stats.customerGrowthRate,
            label: 'vs last week'
          } : undefined}
          subtitle={`+${stats.newCustomersThisWeek} this week`}
          link={{ href: '/customers', label: 'View all' }}
          loading={isLoading}
        />

        <StatsCard
          title="Upcoming Events"
          value={stats.totalUpcomingEvents}
          icon={CalendarIcon}
          iconColor="text-green-600"
          subtitle={`${stats.eventsAtCapacity + stats.eventsNearCapacity} need attention`}
          link={{ href: '/events', label: 'Manage' }}
          loading={isLoading}
        />

        <StatsCard
          title="Active Employees"
          value={stats.activeEmployees}
          icon={UsersIcon}
          iconColor="text-purple-600"
          subtitle={`/${stats.totalEmployees} total`}
          link={{ href: '/employees', label: 'Manage' }}
          loading={isLoading}
        />

        <StatsCard
          title="Total Bookings"
          value={stats.totalBookings}
          icon={ChartBarIcon}
          iconColor="text-blue-600"
          trend={stats.bookingGrowthRate !== 0 ? {
            value: stats.bookingGrowthRate,
            label: 'vs last week'
          } : undefined}
          link={{ href: '/events', label: 'View' }}
          loading={isLoading}
        />
      </div>

      {/* Capacity Alerts */}
      {(stats.eventsAtCapacity > 0 || stats.eventsNearCapacity > 0) && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 flex items-center">
              <ExclamationCircleIcon className="h-5 w-5 text-yellow-400 mr-2" />
              Capacity Alerts
            </h3>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {stats.eventsAtCapacity > 0 && (
                <div className="bg-red-50 rounded-lg p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ExclamationCircleIcon className="h-5 w-5 text-red-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">
                        {stats.eventsAtCapacity} event{stats.eventsAtCapacity > 1 ? 's' : ''} at full capacity
                      </h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>These events cannot accept more bookings.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {stats.eventsNearCapacity > 0 && (
                <div className="bg-yellow-50 rounded-lg p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <ClockIcon className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-yellow-800">
                        {stats.eventsNearCapacity} event{stats.eventsNearCapacity > 1 ? 's' : ''} near capacity
                      </h3>
                      <div className="mt-2 text-sm text-yellow-700">
                        <p>These events are 80% or more booked.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid - 3 columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column - Events and Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Events */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Upcoming Events
                </h3>
                <Link 
                  href="/events"
                  className="inline-flex items-center px-6 py-3 md:py-2 border border-transparent text-base md:text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                >
                  <PlusIcon className="-ml-0.5 mr-2 h-4 w-4" />
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
                    <div key={event.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <Link 
                            href={`/events/${event.id}`}
                            className="text-base font-medium text-gray-900 hover:text-blue-700"
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
                          <div className="ml-4">
                            <div className="text-right">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                isAtCapacity 
                                  ? 'bg-red-100 text-red-800' 
                                  : isNearCapacity 
                                    ? 'bg-yellow-100 text-yellow-800' 
                                    : 'bg-green-100 text-green-800'
                              }`}>
                                {capacityPercentage}% Full
                              </span>
                            </div>
                            <div className="mt-2 w-32 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  isAtCapacity 
                                    ? 'bg-red-500' 
                                    : isNearCapacity 
                                      ? 'bg-yellow-500' 
                                      : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(capacityPercentage, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1 text-right">
                              {event.total_seats}/{event.capacity} capacity
                            </p>
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
                      className="mt-3 inline-flex items-center px-6 py-3 md:py-2 border border-transparent text-base md:text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                    >
                      Create your first event
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Enhanced Activity Feed */}
          <EnhancedActivityFeed limit={15} showFilters={true} />
        </div>

        {/* Right Column - Feature Widgets */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/events"
                  className="flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                >
                  <CalendarIcon className="h-4 w-4 mr-1.5" />
                  Create Event
                </Link>
                <Link
                  href="/customers"
                  className="flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                >
                  <UserGroupIcon className="h-4 w-4 mr-1.5" />
                  Add Customer
                </Link>
                <Link
                  href="/messages/bulk"
                  className="flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                >
                  <EnvelopeIcon className="h-4 w-4 mr-1.5" />
                  Bulk SMS
                </Link>
                <Link
                  href="/messages"
                  className="flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                >
                  <ChatBubbleLeftRightIcon className="h-4 w-4 mr-1.5" />
                  Messages
                </Link>
                {hasPermission('settings', 'view') && (
                  <>
                    <Link
                      href="/settings/message-templates"
                      className="flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                    >
                      <DocumentTextIcon className="h-4 w-4 mr-1.5" />
                      Templates
                    </Link>
                    <Link
                      href="/employees"
                      className="flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 min-h-[44px]"
                    >
                      <UsersIcon className="h-4 w-4 mr-1.5" />
                      Employees
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Feature Widgets */}
          <CategoryAnalyticsWidget />
          <MessageTemplatesWidget />
          <SmsHealthWidget />
          <EmployeeActivityWidget />
          <AuditTrailWidget />
        </div>
      </div>
    </div>
  )
}