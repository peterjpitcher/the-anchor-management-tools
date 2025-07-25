'use client'

import { useState, useMemo } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDate } from '@/lib/dateUtils'
import { usePagination } from '@/hooks/usePagination'
import { Pagination } from '@/components/Pagination'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Form } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { useRouter } from 'next/navigation';
interface AuditLog {
  id: string
  created_at: string
  user_email: string | null
  operation_type: string
  resource_type: string
  resource_id: string | null
  operation_status: 'success' | 'failure'
  ip_address: string | null
  error_message: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  additional_info: Record<string, unknown> | null
}

export default function AuditLogsPage() {
  const router = useRouter();
const supabase = useSupabase()
  const [filterState, setFilterState] = useState({
    operationType: '',
    resourceType: '',
    status: '',
    dateFrom: '',
    dateTo: ''
  })
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  // Build filters for pagination
  const paginationFilters = useMemo(() => {
    const filters: Array<{ column: string; operator: string; value: unknown }> = []
    
    if (filterState.operationType) {
      filters.push({ column: 'operation_type', operator: 'eq', value: filterState.operationType })
    }
    if (filterState.resourceType) {
      filters.push({ column: 'resource_type', operator: 'eq', value: filterState.resourceType })
    }
    if (filterState.status) {
      filters.push({ column: 'operation_status', operator: 'eq', value: filterState.status })
    }
    if (filterState.dateFrom) {
      filters.push({ column: 'created_at', operator: 'gte', value: filterState.dateFrom })
    }
    if (filterState.dateTo) {
      filters.push({ column: 'created_at', operator: 'lte', value: filterState.dateTo + 'T23:59:59' })
    }
    
    return filters
  }, [filterState])

  // Use pagination hook
  const {
    data: logs,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading: loading,
    setPage,
    refresh: __
  } = usePagination<AuditLog>(
    supabase,
    'audit_logs',
    {
      select: '*',
      orderBy: { column: 'created_at', ascending: false },
      filters: paginationFilters
    },
    { pageSize: 50 }
  )

  const getOperationIcon = (type: string) => {
    switch (type) {
      case 'create': return '➕'
      case 'update': return '✏️'
      case 'delete': return '🗑️'
      case 'view': return '👁️'
      case 'login': return '🔐'
      case 'logout': return '🚪'
      case 'export': return '📤'
      case 'upload': return '📎'
      case 'download': return '📥'
      default: return '📝'
    }
  }

  const getStatusVariant = (status: string): 'success' | 'error' => {
    return status === 'success' ? 'success' : 'error'
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Audit Logs"
          subtitle="View system activity and security events"
          backButton={{
            label: "Back to Settings",
            href: "/settings"
          }}
        />
        <Card>
          <div className="flex justify-center p-8">
            <Spinner size="lg" />
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="View system activity and security events"
        backButton={{
          label: "Back to Settings",
          href: "/settings"
        }}
      />
      
      {/* Filters */}
      <Section title="Filters">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <FormGroup>
              <Select
                value={filterState.operationType}
                onChange={(e) => setFilterState({ ...filterState, operationType: e.target.value })}
              >
                <option value="">All Operations</option>
                <option value="create">Create</option>
                <option value="update">Update</option>
                <option value="delete">Delete</option>
                <option value="view">View</option>
                <option value="login">Login</option>
                <option value="logout">Logout</option>
                <option value="export">Export</option>
                <option value="upload">Upload</option>
                <option value="download">Download</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Select
                value={filterState.resourceType}
                onChange={(e) => setFilterState({ ...filterState, resourceType: e.target.value })}
              >
                <option value="">All Resources</option>
                <option value="employee">Employee</option>
                <option value="customer">Customer</option>
                <option value="booking">Booking</option>
                <option value="event">Event</option>
                <option value="financial_details">Financial Details</option>
                <option value="attachment">Attachment</option>
                <option value="message">Message</option>
                <option value="auth">Authentication</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Select
                value={filterState.status}
                onChange={(e) => setFilterState({ ...filterState, status: e.target.value })}
              >
                <option value="">All Statuses</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Input
                type="date"
                value={filterState.dateFrom}
                onChange={(e) => setFilterState({ ...filterState, dateFrom: e.target.value })}
                placeholder="From date"
              />
            </FormGroup>

            <FormGroup>
              <Input
                type="date"
                value={filterState.dateTo}
                onChange={(e) => setFilterState({ ...filterState, dateTo: e.target.value })}
                placeholder="To date"
              />
            </FormGroup>
          </div>
        </Card>
      </Section>

      {/* Logs Table */}
      <Section title="Audit Log Entries">
        <Card>
          {logs.length === 0 ? (
            <EmptyState
              title="No audit logs found"
              description="No audit logs found matching your filters"
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
                  )
                },
                {
                  key: 'user_email',
                  header: 'User',
                  cell: (log: AuditLog) => log.user_email || 'System'
                },
                {
                  key: 'operation_type',
                  header: 'Operation',
                  cell: (log: AuditLog) => (
                    <span>
                      <span className="mr-2">{getOperationIcon(log.operation_type)}</span>
                      {log.operation_type}
                    </span>
                  )
                },
                {
                  key: 'resource_type',
                  header: 'Resource',
                  cell: (log: AuditLog) => (
                    <div>
                      <div className="text-sm">{log.resource_type}</div>
                      {log.resource_id && (
                        <div className="text-xs text-gray-500">
                          ID: {log.resource_id.slice(0, 8)}...
                        </div>
                      )}
                    </div>
                  )
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
                        <div className="text-xs text-red-600 mt-1">
                          {log.error_message}
                        </div>
                      )}
                    </div>
                  )
                },
                {
                  key: 'ip_address',
                  header: 'IP Address',
                  cell: (log: AuditLog) => log.ip_address || '-'
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
                  )
                }
              ]}
            />
          )}
        </Card>
      </Section>

      {/* Expanded Details */}
      {expandedLog && (() => {
        const log = logs.find(l => l.id === expandedLog)
        if (!log) return null
        
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
                      <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                        {JSON.stringify(log.old_values, null, 2)}
                      </pre>
                    </dd>
                  </div>
                )}
                {log.new_values && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">New Values</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                        {JSON.stringify(log.new_values, null, 2)}
                      </pre>
                    </dd>
                  </div>
                )}
                {log.additional_info && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">Additional Info</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
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
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            itemsPerPage={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  )
}