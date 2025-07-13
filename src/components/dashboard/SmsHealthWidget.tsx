'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { 
  ChatBubbleLeftRightIcon, 
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon
} from '@heroicons/react/24/outline'
import Link from 'next/link'

interface SmsHealthStats {
  deliveryRate: number
  deliveryTrend: number // positive or negative percentage
  totalCustomers: number
  activeCustomers: number
  suspendedCustomers: number
  problemCustomers: {
    customerId: string
    name: string
    failureRate: number
    lastFailure: string
  }[]
  recentFailures: {
    customerName: string
    errorCode: string
    timestamp: string
  }[]
}

export function SmsHealthWidget() {
  const supabase = useSupabase()
  const [stats, setStats] = useState<SmsHealthStats>({
    deliveryRate: 0,
    deliveryTrend: 0,
    totalCustomers: 0,
    activeCustomers: 0,
    suspendedCustomers: 0,
    problemCustomers: [],
    recentFailures: []
  })
  const [isLoading, setIsLoading] = useState(true)

  const loadSmsHealth = useCallback(async () => {
    try {
      setIsLoading(true)

      // Get customer messaging health
      const { data: healthData, error: healthError } = await supabase
        .from('customer_messaging_health')
        .select('*')

      if (healthError) throw healthError

      // Get recent messages for trend analysis
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const sixtyDaysAgo = new Date()
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

      // Current period delivery rate
      const { data: currentMessages, error: currentError } = await supabase
        .from('messages')
        .select('twilio_status')
        .eq('direction', 'outbound')
        .gte('created_at', thirtyDaysAgo.toISOString())

      if (currentError) throw currentError

      // Previous period delivery rate for trend
      const { data: previousMessages, error: previousError } = await supabase
        .from('messages')
        .select('twilio_status')
        .eq('direction', 'outbound')
        .gte('created_at', sixtyDaysAgo.toISOString())
        .lt('created_at', thirtyDaysAgo.toISOString())

      if (previousError) throw previousError

      // Get recent delivery failures
      const { data: recentFailures, error: failuresError } = await supabase
        .from('message_delivery_status')
        .select(`
          created_at,
          error_code,
          message_id,
          messages!inner(
            customer_id,
            customers!inner(
              first_name,
              last_name
            )
          )
        `)
        .not('error_code', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)

      if (failuresError) throw failuresError

      // Calculate stats
      const currentDelivered = currentMessages?.filter(m => m.twilio_status === 'delivered').length || 0
      const currentTotal = currentMessages?.length || 0
      const currentRate = currentTotal > 0 ? (currentDelivered / currentTotal) * 100 : 0

      const previousDelivered = previousMessages?.filter(m => m.twilio_status === 'delivered').length || 0
      const previousTotal = previousMessages?.length || 0
      const previousRate = previousTotal > 0 ? (previousDelivered / previousTotal) * 100 : 0

      const deliveryTrend = currentRate - previousRate

      // Process customer health data
      const activeCustomers = healthData?.filter(h => h.sms_status === 'active').length || 0
      const suspendedCustomers = healthData?.filter(h => h.sms_status === 'suspended').length || 0
      const problemCustomers = healthData
        ?.filter(h => h.delivery_rate < 50 && h.total_messages >= 3)
        .map(h => ({
          customerId: h.customer_id,
          name: h.customer_name,
          failureRate: 100 - h.delivery_rate,
          lastFailure: h.last_message_date
        }))
        .slice(0, 3) || []

      // Format recent failures
      const formattedFailures = recentFailures?.map((failure: any) => ({
        customerName: `${failure.messages.customers.first_name} ${failure.messages.customers.last_name}`,
        errorCode: failure.error_code,
        timestamp: failure.created_at
      })) || []

      setStats({
        deliveryRate: Math.round(currentRate),
        deliveryTrend: Math.round(deliveryTrend * 10) / 10,
        totalCustomers: healthData?.length || 0,
        activeCustomers,
        suspendedCustomers,
        problemCustomers,
        recentFailures: formattedFailures
      })
    } catch (error) {
      console.error('Error loading SMS health:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadSmsHealth()
  }, [loadSmsHealth])

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex justify-between items-start sm:items-center mb-4">
          <h3 className="text-base sm:text-lg leading-6 font-medium text-gray-900 flex items-center">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0" />
            SMS Health
          </h3>
          <Link
            href="/settings/sms-health"
            className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-500 whitespace-nowrap"
          >
            View Details
          </Link>
        </div>

        {/* Delivery Rate with Trend */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl sm:text-3xl font-semibold text-gray-900">{stats.deliveryRate}%</p>
              <p className="text-xs sm:text-sm text-gray-500">Delivery Rate</p>
            </div>
            <div className="flex items-center">
              {stats.deliveryTrend > 0 ? (
                <>
                  <ArrowTrendingUpIcon className="h-5 w-5 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+{stats.deliveryTrend}%</span>
                </>
              ) : stats.deliveryTrend < 0 ? (
                <>
                  <ArrowTrendingDownIcon className="h-5 w-5 text-red-500 mr-1" />
                  <span className="text-sm text-red-600">{stats.deliveryTrend}%</span>
                </>
              ) : (
                <span className="text-sm text-gray-500">No change</span>
              )}
            </div>
          </div>
        </div>

        {/* Customer Status Summary */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <div className="bg-green-50 rounded-lg p-2">
            <CheckCircleIcon className="h-5 w-5 text-green-600 mx-auto mb-1" />
            <p className="text-base sm:text-lg font-semibold text-green-900">{stats.activeCustomers}</p>
            <p className="text-xs text-green-700">Active</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mx-auto mb-1" />
            <p className="text-base sm:text-lg font-semibold text-yellow-900">{stats.problemCustomers.length}</p>
            <p className="text-xs text-yellow-700">Issues</p>
          </div>
          <div className="bg-red-50 rounded-lg p-2">
            <XCircleIcon className="h-5 w-5 text-red-600 mx-auto mb-1" />
            <p className="text-base sm:text-lg font-semibold text-red-900">{stats.suspendedCustomers}</p>
            <p className="text-xs text-red-700">Suspended</p>
          </div>
        </div>

        {/* Problem Customers */}
        {stats.problemCustomers.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm sm:text-base font-medium text-gray-700 mb-2">Customers with Issues</h4>
            <div className="space-y-2">
              {stats.problemCustomers.map((customer, index) => (
                <div key={index} className="flex items-center justify-between text-sm bg-yellow-50 rounded p-2">
                  <Link
                    href={`/customers/${customer.customerId}`}
                    className="text-gray-900 hover:text-indigo-600"
                  >
                    {customer.name}
                  </Link>
                  <span className="text-xs text-red-600">
                    {customer.failureRate}% failure rate
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Failures */}
        {stats.recentFailures.length > 0 && (
          <div className="pt-4 border-t border-gray-200">
            <h4 className="text-sm sm:text-base font-medium text-gray-700 mb-2">Recent Failures</h4>
            <div className="space-y-1">
              {stats.recentFailures.slice(0, 3).map((failure, index) => (
                <div key={index} className="text-xs text-gray-600">
                  <span className="font-medium">{failure.customerName}</span>
                  <span className="text-red-600 ml-2">{failure.errorCode}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.totalCustomers === 0 && (
          <div className="text-center py-4">
            <ChatBubbleLeftRightIcon className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No SMS data available</p>
          </div>
        )}
      </div>
    </div>
  )
}