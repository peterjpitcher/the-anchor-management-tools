'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'
import { usePagination } from '@/hooks/usePagination'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { Select } from '@/components/ui-v2/forms/Select'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'

import type { PerformerSubmission, PerformerSubmissionStatus } from '@/types/database'

const STATUS_OPTIONS: Array<{ value: PerformerSubmissionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
  { value: 'not_a_fit', label: 'Not a fit' },
  { value: 'do_not_contact', label: 'Do not contact' },
]

function formatStatusLabel(status: PerformerSubmissionStatus): string {
  const option = STATUS_OPTIONS.find((item) => item.value === status)
  return option?.label ?? status
}

function getStatusBadgeVariant(status: PerformerSubmissionStatus): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'new':
      return 'default'
    case 'shortlisted':
      return 'warning'
    case 'contacted':
      return 'warning'
    case 'booked':
      return 'success'
    case 'not_a_fit':
      return 'error'
    case 'do_not_contact':
      return 'error'
    default:
      return 'default'
  }
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export default function PerformersPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()

  const canView = hasPermission('performers', 'view')
  const canExport = hasPermission('performers', 'export') || hasPermission('performers', 'manage')

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<PerformerSubmissionStatus | 'all'>('new')

  const queryConfig = useMemo(() => {
    const filters: Array<{ column: string; operator: 'eq' | 'contains'; value: any }> = []

    if (statusFilter !== 'all') {
      filters.push({ column: 'status', operator: 'eq', value: statusFilter })
    }

    return {
      select: 'id, created_at, full_name, email, phone, status',
      orderBy: { column: 'created_at', ascending: false },
      filters,
    }
  }, [statusFilter])

  const {
    data: submissions,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading,
    error,
    setPage,
    refresh,
  } = usePagination<PerformerSubmission>(
    supabase,
    'performer_submissions',
    queryConfig,
    {
      pageSize: 50,
      searchTerm,
      searchColumns: ['full_name', 'email', 'phone'],
    },
  )

  const handleExportCsv = useCallback(async () => {
    if (!canExport) {
      toast.error('You do not have permission to export performer submissions.')
      return
    }

    try {
      let query = supabase
        .from('performer_submissions')
        .select(
          'created_at, status, full_name, email, phone, bio, internal_notes, consent_data_storage',
        )
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      if (searchTerm.trim()) {
        const pattern = `%${searchTerm.trim()}%`
        const orConditions = ['full_name', 'email', 'phone']
          .map((col) => `${col}.ilike.${pattern}`)
          .join(',')
        query = query.or(orConditions)
      }

      const { data, error } = await query.range(0, 9999)

      if (error) {
        throw error
      }

      const rows = data || []

      const headers = [
        'Created at',
        'Status',
        'Full name',
        'Email',
        'Phone',
        'Consent (data storage)',
        'Description',
        'Internal notes',
      ]

      const csvLines = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((row: any) =>
          [
            row.created_at,
            row.status,
            row.full_name,
            row.email,
            row.phone,
            row.consent_data_storage ? 'yes' : 'no',
            row.bio,
            row.internal_notes || '',
          ]
            .map(escapeCsvCell)
            .join(','),
        ),
      ]

      const csv = `\ufeff${csvLines.join('\n')}`
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `performer-submissions-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(anchor)

      toast.success(`Exported ${rows.length} submission${rows.length === 1 ? '' : 's'}`)
    } catch (error) {
      console.error('Export failed:', error)
      toast.error('Failed to export performer submissions.')
    }
  }, [
    canExport,
    supabase,
    statusFilter,
    searchTerm,
  ])

  const columns = useMemo(() => {
    return [
      {
        key: 'created_at',
        header: 'Received',
        cell: (row: PerformerSubmission) => (
          <div className="text-sm text-gray-900">
            {format(new Date(row.created_at), 'MMM d, yyyy HH:mm')}
          </div>
        ),
      },
      {
        key: 'name',
        header: 'Name',
        cell: (row: PerformerSubmission) => (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{row.full_name}</div>
          </div>
        ),
      },
      {
        key: 'contact',
        header: 'Contact',
        cell: (row: PerformerSubmission) => (
          <div className="min-w-0">
            <div className="text-sm text-gray-700 truncate">{row.email}</div>
            <div className="text-xs text-gray-500 truncate">{row.phone}</div>
          </div>
        ),
        hideOnMobile: true,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row: PerformerSubmission) => (
          <Badge variant={getStatusBadgeVariant(row.status)}>{formatStatusLabel(row.status)}</Badge>
        ),
        align: 'center' as const,
      },
    ]
  }, [])

  if (permissionsLoading) {
    return (
      <PageLayout title="Performers" subtitle="Open mic performer interest submissions" loading loadingLabel="Loading..." />
    )
  }

  if (!canView) {
    return (
      <PageLayout title="Performers" subtitle="Open mic performer interest submissions">
        <Alert
          variant="error"
          title="Insufficient permissions"
          description="You do not have permission to view performer submissions."
        />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Performers"
      subtitle="Open mic performer interest submissions"
      headerActions={
        canExport ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={handleExportCsv}
            disabled={isLoading || totalCount === 0}
          >
            Export CSV
          </Button>
        ) : null
      }
    >
      <Card>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-9">
              <SearchInput
                placeholder="Search name, email, phone..."
                value={searchTerm}
                onSearch={setSearchTerm}
                loading={isLoading}
              />
            </div>
            <div className="md:col-span-3">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as PerformerSubmissionStatus | 'all')}
                options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-12 flex items-center justify-end">
              <Button variant="secondary" size="sm" onClick={refresh} disabled={isLoading}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="text-sm text-gray-600">
            {totalCount} submission{totalCount === 1 ? '' : 's'}
          </div>
        </div>
      </Card>

      {error && (
        <Alert
          variant="error"
          title="Failed to load submissions"
          description={error.message}
          className="mt-4"
        />
      )}

      <Card className="mt-4" padding="none">
        <DataTable<PerformerSubmission>
          data={submissions}
          getRowKey={(row) => row.id}
          columns={columns}
          loading={isLoading}
          emptyMessage="No performer submissions found"
          emptyDescription="Try adjusting your filters or check back later."
          clickableRows
          onRowClick={(row) => router.push(`/performers/${row.id}`)}
        />
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            itemsPerPage={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}
    </PageLayout>
  )
}
