'use client'

import { useState, useTransition } from 'react'
import { ArrowLeftIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { getDeliveryFailureReport, getSmsDeliveryStats } from '@/app/actions/customerSmsActions'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Button } from '@/components/ui-v2/forms/Button'

type ErrorResult = { error: string }

export type SmsStats = {
  messages: {
    total: number
    byStatus: Record<string, number>
    totalCost: string
    deliveryRate: string
  }
  customers: {
    active: number
    inactive: number
    total: number
  }
}

export type FailedCustomer = {
  id: string
  first_name: string
  last_name: string
  mobile_number: string
  sms_delivery_failures: number
  last_sms_failure_reason: string | null
  sms_deactivation_reason: string | null
  sms_opt_in: boolean
  recent_messages?: Array<{
    twilio_status: string | null
    error_code: string | null
    error_message: string | null
    created_at: string
  }>
}

type SmsDeliveryClientProps = {
  initialStats: SmsStats | null
  initialFailedCustomers: FailedCustomer[]
  initialError: string | null
}

const STATUS_BADGE_VARIANTS: Record<string, 'success' | 'info' | 'error' | 'warning'> = {
  delivered: 'success',
  sent: 'info',
  failed: 'error',
  undelivered: 'error',
  queued: 'warning',
  sending: 'warning',
}

function isErrorResult(result: unknown): result is ErrorResult {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error: unknown }).error === 'string',
  )
}

export default function SmsDeliveryClient({
  initialStats,
  initialFailedCustomers,
  initialError,
}: SmsDeliveryClientProps) {
  const [stats, setStats] = useState<SmsStats | null>(initialStats)
  const [failedCustomers, setFailedCustomers] = useState<FailedCustomer[]>(initialFailedCustomers)
  const [error, setError] = useState<string | null>(initialError)
  const [isRefreshing, startRefresh] = useTransition()

  const handleRefresh = () => {
    startRefresh(async () => {
      setError(null)

      const [statsResult, failureResult] = await Promise.all([
        getSmsDeliveryStats(),
        getDeliveryFailureReport(),
      ])

      if (isErrorResult(statsResult)) {
        setStats(null)
        setFailedCustomers([])
        setError(statsResult.error || 'Failed to load SMS delivery statistics.')
        return
      }

      if (isErrorResult(failureResult)) {
        setStats(statsResult as SmsStats)
        setFailedCustomers([])
        setError(failureResult.error || 'Failed to load SMS delivery statistics.')
        return
      }

      setStats(statsResult as SmsStats)
      setFailedCustomers(failureResult.customers || [])
    })
  }

  return (
    <Page
      title="SMS Delivery Statistics"
      description="Monitor SMS delivery performance and manage customer messaging preferences."
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <LinkButton href="/settings" variant="secondary" size="sm">
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            Back to Settings
          </LinkButton>
        </div>
      }
    >
      {error && (
        <Alert
          variant="error"
          title="Error loading statistics"
          description={error}
          className="mb-4"
        />
      )}

      <Card className="mb-6">
        {isRefreshing && (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        )}

        {!isRefreshing && stats && (
          <StatGroup>
            <Stat label="Total Messages (30d)" value={stats.messages.total} />
            <Stat label="Delivery Rate" value={`${stats.messages.deliveryRate || 0}%`} />
            <Stat label="Total Cost (30d)" value={`$${stats.messages.totalCost || '0.00'}`} />
            <Stat
              label="Active Customers"
              value={`${stats.customers.active || 0} / ${stats.customers.total || 0}`}
            />
          </StatGroup>
        )}

        {!isRefreshing && !stats && !error && (
          <EmptyState
            title="No SMS activity"
            description="We couldn’t find delivery data for the past 30 days."
          />
        )}
      </Card>

      {stats?.messages.byStatus && Object.keys(stats.messages.byStatus).length > 0 && (
        <Section title="Message Status Breakdown (Last 30 Days)">
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(stats.messages.byStatus).map(([status, count]) => (
                <div key={status} className="text-center">
                  <Badge variant={STATUS_BADGE_VARIANTS[status] || 'info'} size="sm">
                    {status}
                  </Badge>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{count}</p>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      <Section title="Customers with Delivery Issues">
        <Card>
          {failedCustomers.length === 0 ? (
            <EmptyState
              title="No delivery issues detected"
              description="Customers are currently receiving SMS messages without reported problems."
            />
          ) : (
            <DataTable
              data={failedCustomers}
              getRowKey={(customer) => customer.id}
              columns={[
                {
                  key: 'name',
                  header: 'Customer',
                  cell: (customer: FailedCustomer) => (
                    <span className="font-medium text-gray-900">
                      {customer.first_name} {customer.last_name}
                    </span>
                  ),
                },
                {
                  key: 'mobile_number',
                  header: 'Mobile Number',
                  cell: (customer: FailedCustomer) => customer.mobile_number,
                },
                {
                  key: 'failures',
                  header: 'Delivery Failures',
                  cell: (customer: FailedCustomer) => customer.sms_delivery_failures,
                },
                {
                  key: 'last_reason',
                  header: 'Last Failure Reason',
                  cell: (customer: FailedCustomer) =>
                    customer.last_sms_failure_reason || 'Not recorded',
                },
                {
                  key: 'status',
                  header: 'SMS Status',
                  cell: (customer: FailedCustomer) =>
                    customer.sms_opt_in ? (
                      <Badge variant="success" size="sm">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Disabled
                      </Badge>
                    ),
                },
              ]}
            />
          )}
        </Card>
      </Section>
    </Page>
  )
}
