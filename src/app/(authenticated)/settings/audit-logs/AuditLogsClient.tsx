'use client'

import { useState, useTransition } from 'react'
import type { AuditLog } from '@/types/database'
import { listAuditLogs } from '@/app/actions/auditLogs'
import { formatDate } from '@/lib/dateUtils'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'

type FiltersState = {
  operationType: string
  resourceType: string
  status: string
  dateFrom: string
  dateTo: string
}

type AuditLogsClientProps = {
  initialLogs: AuditLog[]
  initialTotalCount: number
  pageSize: number
  initialPage: number
  initialFilters: FiltersState
  initialError: string | null
}

const OPERATION_OPTIONS = [
  { value: '', label: 'All Operations' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'view', label: 'View' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'export', label: 'Export' },
  { value: 'upload', label: 'Upload' },
  { value: 'download', label: 'Download' },
]

const RESOURCE_OPTIONS = [
  { value: '', label: 'All Resources' },
  { value: 'employee', label: 'Employee' },
  { value: 'customer', label: 'Customer' },
  { value: 'booking', label: 'Booking' },
  { value: 'event', label: 'Event' },
  { value: 'financial_details', label: 'Financial Details' },
  { value: 'attachment', label: 'Attachment' },
  { value: 'message', label: 'Message' },
  { value: 'auth', label: 'Authentication' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
]

function getOperationIcon(type: string) {
  switch (type) {
    case 'create':
      return '➕'
    case 'update':
      return '✏️'
    case 'delete':
      return '🗑️'
    case 'view':
      return '👁️'
    case 'login':
      return '🔐'
    case 'logout':
      return '🚪'
    case 'export':
      return '📤'
    case 'upload':
      return '📎'
    case 'download':
      return '📥'
    default:
      return '📝'
  }
}

function getStatusVariant(status: string): 'success' | 'error' {
  return status === 'success' ? 'success' : 'error'
}

export default function AuditLogsClient({
  initialLogs,
  initialTotalCount,
  pageSize,
  initialPage,
  initialFilters,
  initialError,
}: AuditLogsClientProps) {
  const [logs, setLogs] = useState<AuditLog[]>(initialLogs)
  const [totalCount, setTotalCount] = useState(initialTotalCount)
  const [page, setPage] = useState(initialPage)
  const [filters, setFilters] = useState<FiltersState>(initialFilters)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [isRefreshing, startRefreshTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const fetchLogs = (nextFilters: FiltersState, nextPage: number) => {
    startRefreshTransition(async () => {
      setError(null)
      const result = await listAuditLogs({
        operationType: nextFilters.operationType || undefined,
        resourceType: nextFilters.resourceType || undefined,
        status: nextFilters.status || undefined,
        dateFrom: nextFilters.dateFrom || undefined,
        dateTo: nextFilters.dateTo || undefined,
        page: nextPage,
        pageSize,
      })

      if (result.error) {
        setError(result.error)
        return
      }

      setLogs(result.logs ?? [])
      setTotalCount(result.totalCount ?? 0)
      setPage(result.page)
      setFilters(result.filters)
      setExpandedLog(null)
    })
  }

  const handleFilterChange = (changes: Partial<FiltersState>) => {
    const nextFilters = { ...filters, ...changes }
    setFilters(nextFilters)
    setPage(1)
    fetchLogs(nextFilters, 1)
  }

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) {
      return
    }
    fetchLogs(filters, nextPage)
  }

  const handleClearFilters = () => {
    const cleared: FiltersState = {
      operationType: '',
      resourceType: '',
      status: '',
      dateFrom: '',
      dateTo: '',
    }
    setFilters(cleared)
    setPage(1)
    fetchLogs(cleared, 1)
  }

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Audit Logs' },
  ]

  return (
    <PageLayout
      title="Audit Logs"
      subtitle="View system activity and security events"
      breadcrumbs={breadcrumbs}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        {error && <Alert variant="error" title="Error" description={error} />}

        <Section id="filters" title="Filters">
          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <FormGroup label="Operation">
                <Select
                  value={filters.operationType}
                onChange={(event) => handleFilterChange({ operationType: event.target.value })}
                disabled={isRefreshing}
              >
                {OPERATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Resource">
              <Select
                value={filters.resourceType}
                onChange={(event) => handleFilterChange({ resourceType: event.target.value })}
                disabled={isRefreshing}
              >
                {RESOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Status">
              <Select
                value={filters.status}
                onChange={(event) => handleFilterChange({ status: event.target.value })}
                disabled={isRefreshing}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="From date">
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => handleFilterChange({ dateFrom: event.target.value })}
                disabled={isRefreshing}
              />
            </FormGroup>

            <FormGroup label="To date">
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(event) => handleFilterChange({ dateTo: event.target.value })}
                disabled={isRefreshing}
              />
            </FormGroup>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={handleClearFilters} disabled={isRefreshing}>
              Clear Filters
            </Button>
            </div>
          </Card>
        </Section>

        <Section id="logs" title="Audit Log Entries">
          <Card>
            {isRefreshing ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="lg" />
              </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No audit logs found"
              description="No audit logs match your current filters."
              action={
                (filters.operationType ||
                  filters.resourceType ||
                  filters.status ||
                  filters.dateFrom ||
                  filters.dateTo) && (
                  <Button variant="secondary" onClick={handleClearFilters} disabled={isRefreshing}>
                    Clear Filters
                  </Button>
                )
              }
            />
          ) : (
            <DataTable
              data={logs}
              getRowKey={(log) => log.id}
              columns={[
                {
                  key: 'created_at',
                  header: 'Time',
                  cell: (log: AuditLog) => (
                    <div>
                      <div className="text-sm text-gray-900">{formatDate(log.created_at)}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'user_email',
                  header: 'User',
                  cell: (log: AuditLog) => log.user_email || 'System',
                },
                {
                  key: 'operation_type',
                  header: 'Operation',
                  cell: (log: AuditLog) => (
                    <span>
                      <span className="mr-2">{getOperationIcon(log.operation_type)}</span>
                      {log.operation_type}
                    </span>
                  ),
                },
                {
                  key: 'resource_type',
                  header: 'Resource',
                  cell: (log: AuditLog) => (
                    <div>
                      <div className="text-sm">{log.resource_type}</div>
                      {log.resource_id && (
                        <div className="text-xs text-gray-500">ID: {log.resource_id.slice(0, 8)}...</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'operation_status',
                  header: 'Status',
                  cell: (log: AuditLog) => (
                    <div>
                      <Badge variant={getStatusVariant(log.operation_status)} size="sm">
                        {log.operation_status}
                      </Badge>
                      {log.error_message && (
                        <div className="text-xs text-red-600 mt-1">{log.error_message}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'ip_address',
                  header: 'IP Address',
                  cell: (log: AuditLog) => log.ip_address || '-',
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (log: AuditLog) => (
                    <Button
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      variant="secondary"
                      size="sm"
                    >
                      {expandedLog === log.id ? 'Hide' : 'Details'}
                    </Button>
                  ),
                },
              ]}
            />
            )}
          </Card>
        </Section>

        {expandedLog && (() => {
          const log = logs.find((entry) => entry.id === expandedLog)
          if (!log) {
            return null
          }

          return (
            <Section title="Log Details">
              <Card>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Log ID</dt>
                    <dd className="mt-1 text-sm text-gray-900">{log.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Timestamp</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(log.created_at).toLocaleString()}
                    </dd>
                  </div>
                  {log.old_values && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Old Values</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-xs sm:text-sm max-w-full">
                          {JSON.stringify(log.old_values, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                  {log.new_values && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">New Values</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-xs sm:text-sm max-w-full">
                          {JSON.stringify(log.new_values, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                  {log.additional_info && (
                    <div className="sm:col-span-2">
                      <dt className="text-sm font-medium text-gray-500">Additional Info</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-xs sm:text-sm max-w-full">
                          {JSON.stringify(log.additional_info, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  )}
                </dl>
              </Card>
            </Section>
          )
        })()}

        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalCount}
            itemsPerPage={pageSize}
            onPageChange={handlePageChange}
            position="end"
          />
        )}
      </div>
    </PageLayout>
  )
}
