'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import toast from 'react-hot-toast'
import { formatDate } from '@/lib/dateUtils'
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

interface CustomerHealth {
  id: string
  first_name: string
  last_name: string
  mobile_number: string
  messaging_status: 'active' | 'suspended' | 'invalid_number' | 'opted_out'
  sms_opt_in: boolean
  consecutive_failures: number
  total_failures_30d: number
  last_successful_delivery: string | null
  last_failure_type: string | null
  total_messages_sent: number
  messages_delivered: number
  messages_failed: number
  delivery_rate: number
  total_cost_usd: number
  last_message_date: string | null
}

export default function SMSHealthDashboard() {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<CustomerHealth[]>([])
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended' | 'invalid_number' | 'at_risk'>('all')
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activeCustomers: 0,
    suspendedCustomers: 0,
    invalidNumbers: 0,
    totalSpent: 0,
    overallDeliveryRate: 0
  })

  const loadData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('customer_messaging_health')
        .select('*')
        .order('consecutive_failures', { ascending: false })

      if (error) throw error

      setCustomers(data || [])
      
      // Calculate stats
      const stats = {
        totalCustomers: data?.length || 0,
        activeCustomers: data?.filter(c => c.messaging_status === 'active').length || 0,
        suspendedCustomers: data?.filter(c => c.messaging_status === 'suspended').length || 0,
        invalidNumbers: data?.filter(c => c.messaging_status === 'invalid_number').length || 0,
        totalSpent: data?.reduce((sum, c) => sum + (c.total_cost_usd || 0), 0) || 0,
        overallDeliveryRate: calculateOverallDeliveryRate(data || [])
      }
      setStats(stats)
    } catch (error) {
      console.error('Error loading SMS health data:', error)
      toast.error('Failed to load SMS health data')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  function calculateOverallDeliveryRate(customers: CustomerHealth[]) {
    const totalSent = customers.reduce((sum, c) => sum + c.total_messages_sent, 0)
    const totalDelivered = customers.reduce((sum, c) => sum + c.messages_delivered, 0)
    return totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0
  }

  async function reactivateCustomer(customerId: string) {
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          messaging_status: 'active',
          consecutive_failures: 0,
          sms_opt_in: true
        })
        .eq('id', customerId)

      if (error) throw error

      toast.success('Customer messaging reactivated')
      await loadData()
    } catch (error) {
      console.error('Error reactivating customer:', error)
      toast.error('Failed to reactivate customer')
    }
  }

  async function suspendCustomer(customerId: string) {
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          messaging_status: 'suspended',
          sms_opt_in: false
        })
        .eq('id', customerId)

      if (error) throw error

      toast.success('Customer messaging suspended')
      await loadData()
    } catch (error) {
      console.error('Error suspending customer:', error)
      toast.error('Failed to suspend customer')
    }
  }

  const filteredCustomers = customers.filter(customer => {
    switch (filter) {
      case 'active':
        return customer.messaging_status === 'active'
      case 'suspended':
        return customer.messaging_status === 'suspended'
      case 'invalid_number':
        return customer.messaging_status === 'invalid_number'
      case 'at_risk':
        return customer.messaging_status === 'active' && 
               (customer.consecutive_failures >= 3 || customer.total_failures_30d >= 5)
      default:
        return true
    }
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'suspended':
        return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
      case 'invalid_number':
        return <XCircleIcon className="h-5 w-5 text-red-500" />
      default:
        return null
    }
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'suspended':
        return 'bg-yellow-100 text-yellow-800'
      case 'invalid_number':
        return 'bg-red-100 text-red-800'
      case 'opted_out':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return <div className="p-4">Loading SMS health data...</div>
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">SMS Health Dashboard</h1>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">
            Monitor SMS delivery health and customer messaging status
          </p>
        </div>
      
      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Total Customers</p>
          <p className="text-lg sm:text-2xl font-bold">{stats.totalCustomers}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Active</p>
          <p className="text-lg sm:text-2xl font-bold text-green-600">{stats.activeCustomers}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Suspended</p>
          <p className="text-lg sm:text-2xl font-bold text-yellow-600">{stats.suspendedCustomers}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Invalid Numbers</p>
          <p className="text-lg sm:text-2xl font-bold text-red-600">{stats.invalidNumbers}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Total Spent</p>
          <p className="text-lg sm:text-2xl font-bold">${stats.totalSpent.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-gray-500">Delivery Rate</p>
          <p className="text-lg sm:text-2xl font-bold">{stats.overallDeliveryRate}%</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-3 sm:p-4 mb-4 sm:mb-6">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex-shrink-0 ${
              filter === 'all' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All ({customers.length})
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex-shrink-0 ${
              filter === 'active' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Active ({stats.activeCustomers})
          </button>
          <button
            onClick={() => setFilter('at_risk')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex-shrink-0 ${
              filter === 'at_risk' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            At Risk ({customers.filter(c => c.messaging_status === 'active' && (c.consecutive_failures >= 3 || c.total_failures_30d >= 5)).length})
          </button>
          <button
            onClick={() => setFilter('suspended')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex-shrink-0 ${
              filter === 'suspended' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Suspended ({stats.suspendedCustomers})
          </button>
          <button
            onClick={() => setFilter('invalid_number')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium flex-shrink-0 ${
              filter === 'invalid_number' 
                ? 'bg-green-600 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Invalid ({stats.invalidNumbers})
          </button>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        {/* Desktop Table */}
        <div className="hidden lg:block">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Failures
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Delivery Rate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Success
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredCustomers.map((customer) => (
              <tr key={customer.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {customer.first_name} {customer.last_name}
                    </div>
                    <div className="text-sm text-gray-500">{customer.mobile_number}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {getStatusIcon(customer.messaging_status)}
                    <span className={`ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(customer.messaging_status)}`}>
                      {customer.messaging_status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div>
                    <div>Consecutive: {customer.consecutive_failures}</div>
                    <div>30 days: {customer.total_failures_30d}</div>
                    {customer.last_failure_type && (
                      <div className="text-xs text-red-600 mt-1">{customer.last_failure_type}</div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="text-sm text-gray-900">{customer.delivery_rate}%</div>
                    <div className="ml-2 text-xs text-gray-500">
                      ({customer.messages_delivered}/{customer.total_messages_sent})
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${customer.total_cost_usd.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {customer.last_successful_delivery 
                    ? formatDate(customer.last_successful_delivery)
                    : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {customer.messaging_status === 'active' ? (
                    <button
                      onClick={() => suspendCustomer(customer.id)}
                      className="text-yellow-600 hover:text-yellow-900"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => reactivateCustomer(customer.id)}
                      className="text-green-600 hover:text-green-900"
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        
        {/* Mobile Card View */}
        <div className="lg:hidden">
          <div className="divide-y divide-gray-200">
            {filteredCustomers.map((customer) => (
              <div key={customer.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {customer.first_name} {customer.last_name}
                    </div>
                    <div className="text-sm text-gray-500">{customer.mobile_number}</div>
                  </div>
                  <div className="flex items-center ml-2">
                    {getStatusIcon(customer.messaging_status)}
                    <span className={`ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(customer.messaging_status)}`}>
                      {customer.messaging_status}
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                  <div>
                    <span className="text-gray-500">Failures:</span>
                    <div className="font-medium">
                      Consec: {customer.consecutive_failures}, 30d: {customer.total_failures_30d}
                    </div>
                    {customer.last_failure_type && (
                      <div className="text-xs text-red-600 mt-1">{customer.last_failure_type}</div>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">Delivery Rate:</span>
                    <div className="font-medium">
                      {customer.delivery_rate}% ({customer.messages_delivered}/{customer.total_messages_sent})
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                  <div>
                    <span className="text-gray-500">Cost:</span>
                    <div className="font-medium">${customer.total_cost_usd.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Last Success:</span>
                    <div className="font-medium">
                      {customer.last_successful_delivery 
                        ? formatDate(customer.last_successful_delivery)
                        : 'Never'}
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end">
                  {customer.messaging_status === 'active' ? (
                    <button
                      onClick={() => suspendCustomer(customer.id)}
                      className="px-4 py-2 text-sm font-medium text-yellow-600 bg-yellow-50 rounded-lg hover:bg-yellow-100"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => reactivateCustomer(customer.id)}
                      className="px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {filteredCustomers.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No customers found matching the selected filter
          </div>
        )}
      </div>

      {/* Automatic Deactivation Rules */}
      <div className="mt-6 sm:mt-8 bg-white rounded-lg shadow p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Automatic Deactivation Rules</h2>
        <ul className="space-y-2 text-xs sm:text-sm text-gray-600">
          <li>• <strong>Invalid Number:</strong> Immediate suspension on detection</li>
          <li>• <strong>Carrier Violations:</strong> Suspended after 3 consecutive failures</li>
          <li>• <strong>General Failures:</strong> Suspended after 5 consecutive failures</li>
          <li>• <strong>High Failure Rate:</strong> Suspended after 10 failures in 30 days</li>
          <li>• <strong>Opt-Out:</strong> Customer replies with STOP, UNSUBSCRIBE, etc.</li>
        </ul>
      </div>
    </div>
  )
}