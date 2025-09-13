'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDate } from '@/lib/dateUtils'
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
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
        activeCustomers: data?.filter((c: any) => c.messaging_status === 'active').length || 0,
        suspendedCustomers: data?.filter((c: any) => c.messaging_status === 'suspended').length || 0,
        invalidNumbers: data?.filter((c: any) => c.messaging_status === 'invalid_number').length || 0,
        totalSpent: data?.reduce((sum: number, c: any) => sum + (c.total_cost_usd || 0), 0) || 0,
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
      const { error } = await (supabase
        .from('customers') as any)
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
      const { error } = await (supabase
        .from('customers') as any)
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

  const getStatusBadgeVariant = (status: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'active':
        return 'success'
      case 'suspended':
        return 'warning'
      case 'invalid_number':
        return 'error'
      case 'opted_out':
        return 'info'
      default:
        return 'info'
    }
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader
          title="SMS Health Dashboard"
          subtitle="Monitor SMS delivery health and customer messaging status"
          backButton={{
            label: "Back to Settings",
            href: "/settings"
          }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Spinner size="lg" />
              <p className="mt-4 text-gray-600">Loading SMS health data...</p>
            </div>
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHeader
        title="SMS Health Dashboard"
        subtitle="Monitor SMS delivery health and customer messaging status"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
      />
      <PageContent>
        {/* Stats Overview */}
        <Card>
        <StatGroup>
          <Stat label="Total Customers" value={stats.totalCustomers} />
          <Stat label="Active" value={stats.activeCustomers} color="success" />
          <Stat label="Suspended" value={stats.suspendedCustomers} color="warning" />
          <Stat label="Invalid Numbers" value={stats.invalidNumbers} color="error" />
          <Stat label="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} />
          <Stat label="Delivery Rate" value={`${stats.overallDeliveryRate}%`} />
        </StatGroup>
      </Card>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setFilter('all')}
            variant={filter === 'all' ? 'primary' : 'secondary'}
            size="sm"
          >
            All ({customers.length})
          </Button>
          <Button
            onClick={() => setFilter('active')}
            variant={filter === 'active' ? 'primary' : 'secondary'}
            size="sm"
          >
            Active ({stats.activeCustomers})
          </Button>
          <Button
            onClick={() => setFilter('at_risk')}
            variant={filter === 'at_risk' ? 'primary' : 'secondary'}
            size="sm"
          >
            At Risk ({customers.filter(c => c.messaging_status === 'active' && (c.consecutive_failures >= 3 || c.total_failures_30d >= 5)).length})
          </Button>
          <Button
            onClick={() => setFilter('suspended')}
            variant={filter === 'suspended' ? 'primary' : 'secondary'}
            size="sm"
          >
            Suspended ({stats.suspendedCustomers})
          </Button>
          <Button
            onClick={() => setFilter('invalid_number')}
            variant={filter === 'invalid_number' ? 'primary' : 'secondary'}
            size="sm"
          >
            Invalid ({stats.invalidNumbers})
          </Button>
        </div>
      </Card>

      {/* Customer Table */}
      <Section title="Customer Messaging Health">
        <Card>
          {filteredCustomers.length === 0 ? (
            <EmptyState title="No customers found" description="No customers found matching the selected filter" />
          ) : (
            <DataTable
              data={filteredCustomers}
              getRowKey={(c) => c.id}
              emptyMessage="No customers found"
              columns={[
                { key: 'customer', header: 'Customer', cell: (c: any) => (
                  <div>
                    <div className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</div>
                    <div className="text-sm text-gray-500">{c.mobile_number}</div>
                  </div>
                ) },
                { key: 'status', header: 'Status', cell: (c: any) => (
                  <div className="flex items-center">
                    {getStatusIcon(c.messaging_status)}
                    <Badge variant={getStatusBadgeVariant(c.messaging_status)} size="sm" className="ml-2">{c.messaging_status}</Badge>
                  </div>
                ) },
                { key: 'failures', header: 'Failures', cell: (c: any) => (
                  <div className="text-sm text-gray-500">
                    <div>Consecutive: {c.consecutive_failures}</div>
                    <div>30 days: {c.total_failures_30d}</div>
                    {c.last_failure_type && (<div className="text-xs text-red-600 mt-1">{c.last_failure_type}</div>)}
                  </div>
                ) },
                { key: 'delivery', header: 'Delivery Rate', cell: (c: any) => (
                  <div className="flex items-center">
                    <div className="text-sm text-gray-900">{c.delivery_rate}%</div>
                    <div className="ml-2 text-xs text-gray-500">({c.messages_delivered}/{c.total_messages_sent})</div>
                  </div>
                ) },
                { key: 'cost', header: 'Cost', align: 'right', cell: (c: any) => <span className="text-sm text-gray-900">${c.total_cost_usd.toFixed(2)}</span> },
                { key: 'last', header: 'Last Success', cell: (c: any) => <span className="text-sm text-gray-500">{c.last_successful_delivery ? formatDate(c.last_successful_delivery) : 'Never'}</span> },
                { key: 'actions', header: 'Actions', align: 'right', cell: (c: any) => (
                  c.messaging_status === 'active' ? (
                    <button onClick={() => suspendCustomer(c.id)} className="text-yellow-600 hover:text-yellow-900">Suspend</button>
                  ) : (
                    <button onClick={() => reactivateCustomer(c.id)} className="text-green-600 hover:text-green-900">Reactivate</button>
                  )
                ) },
              ]}
              renderMobileCard={(c: any) => (
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</div>
                      <div className="text-sm text-gray-500">{c.mobile_number}</div>
                    </div>
                    <div className="flex items-center ml-2">
                      {getStatusIcon(c.messaging_status)}
                      <Badge variant={getStatusBadgeVariant(c.messaging_status)} size="sm" className="ml-2">{c.messaging_status}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                    <div>
                      <span className="text-gray-500">Failures:</span>
                      <div className="font-medium">Consec: {c.consecutive_failures}, 30d: {c.total_failures_30d}</div>
                      {c.last_failure_type && (<div className="text-xs text-red-600 mt-1">{c.last_failure_type}</div>)}
                    </div>
                    <div>
                      <span className="text-gray-500">Delivery Rate:</span>
                      <div className="font-medium">{c.delivery_rate}% ({c.messages_delivered}/{c.total_messages_sent})</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                    <div><span className="text-gray-500">Cost:</span> <span className="font-medium">${c.total_cost_usd.toFixed(2)}</span></div>
                    <div><span className="text-gray-500">Last Success:</span> <span className="font-medium">{c.last_successful_delivery ? formatDate(c.last_successful_delivery) : 'Never'}</span></div>
                  </div>
                  <div className="flex justify-end">
                    {c.messaging_status === 'active' ? (
                      <button onClick={() => suspendCustomer(c.id)} className="px-4 py-2 text-sm font-medium text-yellow-600 bg-yellow-50 rounded-lg hover:bg-yellow-100">Suspend</button>
                    ) : (
                      <button onClick={() => reactivateCustomer(c.id)} className="px-4 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100">Reactivate</button>
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </Card>
      </Section>

      {/* Automatic Deactivation Rules */}
      <Section title="Automatic Deactivation Rules">
        <Card>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>• <strong>Invalid Number:</strong> Immediate suspension on detection</li>
            <li>• <strong>Carrier Violations:</strong> Suspended after 3 consecutive failures</li>
            <li>• <strong>General Failures:</strong> Suspended after 5 consecutive failures</li>
            <li>• <strong>High Failure Rate:</strong> Suspended after 10 failures in 30 days</li>
            <li>• <strong>Opt-Out:</strong> Customer replies with STOP, UNSUBSCRIBE, etc.</li>
          </ul>
        </Card>
      </Section>
      </PageContent>
    </PageWrapper>
  )
}
