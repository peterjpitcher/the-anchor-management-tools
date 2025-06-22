'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { TagIcon, ArrowTrendingUpIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { EventCategory } from '@/types/event-categories'
import Link from 'next/link'

interface CategoryStats {
  category: EventCategory
  totalEvents: number
  totalAttendees: number
  averageAttendance: number
  uniqueCustomers: number
  lastEvent?: {
    name: string
    date: string
    attendance: number
  }
}

export function CategoryAnalyticsWidget() {
  const supabase = useSupabase()
  const [stats, setStats] = useState<CategoryStats[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadCategoryStats = useCallback(async () => {
    try {
      // Get all active categories
      const { data: categories, error: catError } = await supabase
        .from('event_categories')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (catError) throw catError

      // Get events by category with booking counts
      const { data: eventStats, error: eventError } = await supabase
        .from('events')
        .select(`
          id,
          name,
          date,
          category_id,
          bookings!inner(
            customer_id,
            seats
          )
        `)
        .not('category_id', 'is', null)
        .order('date', { ascending: false })

      if (eventError) throw eventError

      // Process stats for each category
      const categoryStats: CategoryStats[] = []
      
      for (const category of categories || []) {
        const categoryEvents = eventStats?.filter(e => e.category_id === category.id) || []
        
        // Calculate unique customers and total attendance
        const customerSet = new Set<string>()
        let totalSeats = 0
        let totalEvents = 0
        const eventsSet = new Set<string>()

        categoryEvents.forEach(event => {
          eventsSet.add(event.id)
          event.bookings?.forEach((booking: { customer_id?: string; seats?: number }) => {
            if (booking.customer_id) customerSet.add(booking.customer_id)
            if (booking.seats) totalSeats += booking.seats
          })
        })

        totalEvents = eventsSet.size

        // Get last event info
        const lastEvent = categoryEvents[0]
        let lastEventInfo = undefined
        if (lastEvent) {
          const lastEventAttendance = lastEvent.bookings?.reduce((sum: number, b: any) => sum + (b.seats || 0), 0) || 0
          lastEventInfo = {
            name: lastEvent.name,
            date: lastEvent.date,
            attendance: lastEventAttendance
          }
        }

        categoryStats.push({
          category,
          totalEvents,
          totalAttendees: totalSeats,
          averageAttendance: totalEvents > 0 ? Math.round(totalSeats / totalEvents) : 0,
          uniqueCustomers: customerSet.size,
          lastEvent: lastEventInfo
        })
      }

      // Sort by total attendees descending
      categoryStats.sort((a, b) => b.totalAttendees - a.totalAttendees)

      setStats(categoryStats)
    } catch (error) {
      console.error('Error loading category stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadCategoryStats()
  }, [loadCategoryStats])

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-12 bg-gray-100 rounded"></div>
            <div className="h-12 bg-gray-100 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  const totalAttendees = stats.reduce((sum, stat) => sum + stat.totalAttendees, 0)
  const topCategory = stats[0]

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <TagIcon className="h-5 w-5 mr-2 text-purple-600" />
            Category Analytics
          </h3>
          <span className="text-sm text-gray-500">
            {totalAttendees.toLocaleString()} total attendees
          </span>
        </div>

        {stats.length === 0 ? (
          <p className="text-gray-500 text-sm">No category data available yet.</p>
        ) : (
          <div className="space-y-4">
            {/* Top Category Highlight */}
            {topCategory && topCategory.totalEvents > 0 && (
              <div 
                className="p-4 rounded-lg border-2"
                style={{ 
                  borderColor: topCategory.category.color,
                  backgroundColor: topCategory.category.color + '10'
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span 
                    className="text-sm font-medium flex items-center"
                    style={{ color: topCategory.category.color }}
                  >
                    <ArrowTrendingUpIcon className="h-4 w-4 mr-1" />
                    Most Popular Category
                  </span>
                  <span 
                    className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{ 
                      backgroundColor: topCategory.category.color + '20',
                      color: topCategory.category.color
                    }}
                  >
                    {topCategory.category.name}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">Events</span>
                    <p className="font-semibold">{topCategory.totalEvents}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Avg Attendance</span>
                    <p className="font-semibold">{topCategory.averageAttendance}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Unique Customers</span>
                    <p className="font-semibold">{topCategory.uniqueCustomers}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Category List */}
            <div className="space-y-3">
              {stats.map((stat) => {
                const percentage = totalAttendees > 0 
                  ? Math.round((stat.totalAttendees / totalAttendees) * 100)
                  : 0

                return (
                  <div key={stat.category.id} className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: stat.category.color + '20',
                            color: stat.category.color
                          }}
                        >
                          {stat.category.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {stat.totalEvents} events
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 text-xs text-gray-600">
                        <span className="flex items-center">
                          <UserGroupIcon className="h-3 w-3 mr-1" />
                          {stat.uniqueCustomers}
                        </span>
                        <span className="font-medium">
                          {stat.totalAttendees} ({percentage}%)
                        </span>
                      </div>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: stat.category.color
                        }}
                      />
                    </div>

                    {/* Last event info */}
                    {stat.lastEvent && (
                      <p className="mt-1 text-xs text-gray-500">
                        Last: {stat.lastEvent.name} ({new Date(stat.lastEvent.date).toLocaleDateString()}) - {stat.lastEvent.attendance} attendees
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* View More Link */}
            <div className="pt-2 border-t">
              <Link
                href="/settings/event-categories"
                className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
              >
                Manage Categories →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}