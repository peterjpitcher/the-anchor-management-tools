'use client'

import { Suspense, use } from 'react'
import { getDashboardData, getActivityFeedData } from '@/app/actions/dashboard-optimized'
import { formatDate } from '@/lib/dateUtils'
import Link from 'next/link'
import { 
  CalendarIcon, 
  UserGroupIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline'

// Import components
import { StatsCard } from '@/components/dashboard/StatsCard'
import { MessageTemplatesWidget } from '@/components/dashboard/MessageTemplatesWidget'
import { SmsHealthWidget } from '@/components/dashboard/SmsHealthWidget'
import { EmployeeActivityWidget } from '@/components/dashboard/EmployeeActivityWidget'
import { AuditTrailWidget } from '@/components/dashboard/AuditTrailWidget'
import { CategoryAnalyticsWidget } from '@/components/dashboard/CategoryAnalyticsWidget'

// Loading components
function StatsLoading() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-gray-200 h-32 rounded-lg"></div>
      ))}
    </div>
  )
}

function UpcomingEventsLoading() {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-gray-100 rounded"></div>
        ))}
      </div>
    </div>
  )
}

// Components that use server data
function DashboardStats({ dataPromise }: { dataPromise: Promise<any> }) {
  const data = use(dataPromise)
  const { stats } = data

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatsCard
        title="Total Customers"
        value={stats.totalCustomers}
        icon={UsersIcon}
        subtitle={`+${stats.newCustomers} this week`}
      />
      <StatsCard
        title="Upcoming Events"
        value={stats.totalEvents}
        icon={CalendarIcon}
        subtitle="Next 7 days"
      />
      <StatsCard
        title="Recent Bookings"
        value={stats.recentBookings}
        icon={UserGroupIcon}
        subtitle="Last 30 days"
      />
      <StatsCard
        title="Unread Messages"
        value={stats.unreadMessages}
        icon={ChatBubbleLeftRightIcon}
        link={{ href: "/messages", label: "View messages" }}
      />
    </div>
  )
}

function UpcomingEvents({ dataPromise }: { dataPromise: Promise<any> }) {
  const data = use(dataPromise)
  const { upcomingEvents } = data

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Upcoming Events
          </h3>
          <Link
            href="/events"
            className="text-sm text-blue-600 hover:text-blue-500"
          >
            View all
          </Link>
        </div>
        
        {upcomingEvents.length === 0 ? (
          <p className="text-gray-500 text-sm">No upcoming events in the next 7 days.</p>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.map((event: any) => {
              const eventDate = new Date(event.event_date)
              const occupancyRate = event.max_attendees 
                ? Math.round((event.bookingCount / event.max_attendees) * 100)
                : 0
              
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="block hover:bg-gray-50 -mx-4 px-4 py-3 transition duration-150 ease-in-out"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {event.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {formatDate(eventDate)} at {eventDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          {event.bookingCount}/{event.max_attendees || '∞'}
                        </p>
                        {event.max_attendees && (
                          <div className="mt-1 relative w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`absolute inset-y-0 left-0 ${
                                occupancyRate >= 90 ? 'bg-red-500' :
                                occupancyRate >= 70 ? 'bg-yellow-500' :
                                'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(occupancyRate, 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityFeed({ activitiesPromise }: { activitiesPromise: Promise<any> }) {
  const activities = use(activitiesPromise)
  
  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
          Recent Activity
        </h3>
        <div className="space-y-3">
          {activities.map((activity: any) => (
            <div key={`${activity.type}-${activity.id}`} className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                {activity.type === 'booking' && (
                  <CalendarIcon className="h-5 w-5 text-blue-500" />
                )}
                {activity.type === 'message' && (
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-green-500" />
                )}
                {activity.type === 'customer' && (
                  <UsersIcon className="h-5 w-5 text-purple-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">{activity.description}</p>
                {activity.customer && (
                  <p className="text-sm text-gray-500">
                    {Array.isArray(activity.customer) 
                      ? `${activity.customer[0]?.first_name || ''} ${activity.customer[0]?.last_name || ''}`
                      : `${activity.customer.first_name || ''} ${activity.customer.last_name || ''}`
                    }
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function OptimizedDashboardPage() {
  // Create promises for data fetching
  const dataPromise = getDashboardData()
  const activitiesPromise = getActivityFeedData(10)
  
  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome back! Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>

        {/* Stats Grid - Load immediately */}
        <Suspense fallback={<StatsLoading />}>
          <DashboardStats dataPromise={dataPromise} />
        </Suspense>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Events */}
          <Suspense fallback={<UpcomingEventsLoading />}>
            <UpcomingEvents dataPromise={dataPromise} />
          </Suspense>

          {/* Activity Feed */}
          <Suspense fallback={<UpcomingEventsLoading />}>
            <ActivityFeed activitiesPromise={activitiesPromise} />
          </Suspense>
        </div>

        {/* Additional Widgets - Lazy loaded */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <Suspense fallback={<div className="bg-white shadow rounded-lg h-64 animate-pulse" />}>
            <SmsHealthWidget />
          </Suspense>
          
          <Suspense fallback={<div className="bg-white shadow rounded-lg h-64 animate-pulse" />}>
            <MessageTemplatesWidget />
          </Suspense>
          
          <Suspense fallback={<div className="bg-white shadow rounded-lg h-64 animate-pulse" />}>
            <EmployeeActivityWidget />
          </Suspense>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Suspense fallback={<div className="bg-white shadow rounded-lg h-64 animate-pulse" />}>
            <CategoryAnalyticsWidget />
          </Suspense>
          
          <Suspense fallback={<div className="bg-white shadow rounded-lg h-64 animate-pulse" />}>
            <AuditTrailWidget />
          </Suspense>
        </div>
      </div>
  )
}