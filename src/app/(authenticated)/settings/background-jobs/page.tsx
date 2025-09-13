'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDate } from '@/lib/dateUtils'
import { usePagination } from '@/hooks/usePagination'
import toast from 'react-hot-toast'
import { 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon, 
  ExclamationCircleIcon,
  ArrowPathIcon,
  TrashIcon,
  PlayIcon
} from '@heroicons/react/24/outline'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
// import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'
import { Stat } from '@/components/ui-v2/display/Stat'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
interface BackgroundJob {
  id: string
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  priority: number
  attempts: number
  max_attempts: number
  scheduled_for: string
  created_at: string
  started_at?: string
  completed_at?: string
  failed_at?: string
  error_message?: string
  result?: Record<string, unknown>
  updated_at: string
}

const jobTypeLabels: Record<string, string> = {
  send_sms: 'Send SMS',
  send_bulk_sms: 'Bulk SMS',
  export_employees: 'Export Employees',
  rebuild_category_stats: 'Rebuild Category Stats',
  categorize_historical_events: 'Categorize Events',
  process_booking_reminder: 'Booking Reminder',
  process_event_reminder: 'Event Reminder',
  generate_report: 'Generate Report',
  sync_calendar: 'Sync Calendar',
  cleanup_old_data: 'Cleanup Old Data',
  process_reminder: 'Process Reminder',
  sync_customer_stats: 'Sync Customer Stats',
  cleanup_old_messages: 'Cleanup Messages',
  update_sms_health: 'Update SMS Health'
}

export default function BackgroundJobsPage() {
  const router = useRouter();
  const supabase = useSupabase()
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Build filters for pagination
  const paginationFilters = useMemo(() => {
    const filters: Array<{ column: string; operator: string; value: unknown }> = []
    if (statusFilter) {
      filters.push({ column: 'status', operator: 'eq', value: statusFilter })
    }
    if (typeFilter) {
      filters.push({ column: 'type', operator: 'eq', value: typeFilter })
    }
    return filters
  }, [statusFilter, typeFilter])

  const paginationOptions = useMemo(() => ({
    pageSize: 20
  }), [])

  // Use pagination hook
  const {
    data: jobs,
    currentPage,
    totalPages,
    totalCount,
    pageSize,
    isLoading,
    setPage,
    refresh
  } = usePagination<BackgroundJob>(
    supabase,
    'jobs',
    {
      select: '*',
      orderBy: { column: 'created_at', ascending: false },
      filters: paginationFilters as any
    },
    paginationOptions
  )

  // Set up real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('jobs_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'jobs' },
        () => {
          refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, refresh])

  const getStatusVariant = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'pending': return 'warning'
      case 'processing': return 'info'
      case 'completed': return 'success'
      case 'failed': return 'error'
      case 'cancelled': return 'default'
      default: return 'default'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <ClockIcon className="h-4 w-4" />
      case 'processing': return <ArrowPathIcon className="h-4 w-4 animate-spin" />
      case 'completed': return <CheckCircleIcon className="h-4 w-4" />
      case 'failed': return <XCircleIcon className="h-4 w-4" />
      case 'cancelled': return <XCircleIcon className="h-4 w-4" />
      default: return <ExclamationCircleIcon className="h-4 w-4" />
    }
  }

  const processJobs = async () => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/jobs/process', {
        method: 'POST'
        // Auth header handled server-side
      })
      
      if (!response.ok) {
        throw new Error('Failed to process jobs')
      }
      
      await refresh()
    } catch (error) {
      console.error('Error processing jobs:', error)
      toast.error('Failed to process jobs')
    } finally {
      setIsProcessing(false)
    }
  }

  const retryJob = async (jobId: string) => {
    const { error } = await (supabase as any)
      .from('jobs')
      .update({ 
        status: 'pending',
        attempts: 0,
        error_message: null,
        scheduled_for: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
    
    if (!error) {
      refresh()
    }
  }

  const deleteJob = async (jobId: string) => {
    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', jobId)
    
    if (!error) {
      refresh()
    }
  }

  // Table columns for DataTable
  const columns = [
    {
      key: 'status',
      header: 'Status',
      cell: (job: BackgroundJob) => (
        <Badge variant={getStatusVariant(job.status)}
          icon={getStatusIcon(job.status)}
        >
          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </Badge>
      )
    },
    {
      key: 'type',
      header: 'Type',
      cell: (job: BackgroundJob) => jobTypeLabels[job.type] || job.type
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (job: BackgroundJob) => formatDate(job.created_at)
    },
    {
      key: 'scheduled_for',
      header: 'Scheduled',
      cell: (job: BackgroundJob) => formatDate(job.scheduled_for)
    },
    {
      key: 'attempts',
      header: 'Attempts',
      cell: (job: BackgroundJob) => `${job.attempts} / ${job.max_attempts}`
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (job: BackgroundJob) => 
        job.started_at && job.completed_at 
          ? `${new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()}ms`
          : '-'
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      cell: (job: BackgroundJob) => (
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="link"
            size="sm"
            onClick={() => setSelectedJob(selectedJob === job.id ? null : job.id)}
          >
            {selectedJob === job.id ? 'Hide' : 'Details'}
          </Button>
          {job.status === 'failed' && (
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => retryJob(job.id)}
              title="Retry job"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </IconButton>
          )}
          {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => deleteJob(job.id)}
              title="Delete job"
            >
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      )
    }
  ]

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Background Jobs' }
  ]

  return (
    <Page
      title="Background Jobs"
      description="Monitor and manage background job processing"
      breadcrumbs={breadcrumbs}
      loading={isLoading}
      actions={
        <div className="flex items-center space-x-3">
          <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
          <Button 
            onClick={processJobs}
            disabled={isProcessing}
            loading={isProcessing}
            leftIcon={!isProcessing && <PlayIcon />}
          >
            {isProcessing ? 'Processing...' : 'Process Jobs'}
          </Button>
        </div>
      }
    >

      {/* Stats */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Stat
            label="Total Jobs"
            value={totalCount}
          />
          <Stat
            label="Pending"
            value={jobs.filter(j => j.status === 'pending').length}
            color="warning"
          />
          <Stat
            label="Completed"
            value={jobs.filter(j => j.status === 'completed').length}
            color="success"
          />
          <Stat
            label="Failed"
            value={jobs.filter(j => j.status === 'failed').length}
            color={jobs.filter(j => j.status === 'failed').length > 0 ? 'error' : 'default'}
          />
        </div>
      </Section>

      {/* Filters */}
      <Section>
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Status Filter">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'processing', label: 'Processing' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'cancelled', label: 'Cancelled' }
                ]}
              />
            </FormGroup>
            
            <FormGroup label="Type Filter">
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: '', label: 'All Types' },
                  ...Object.entries(jobTypeLabels).map(([value, label]) => ({
                    value,
                    label
                  }))
                ]}
              />
            </FormGroup>
          </div>
        </Card>
      </Section>

      {/* Jobs Table */}
      <Section>
        <Card>
          {jobs.length === 0 ? (
            <EmptyState icon={<ExclamationCircleIcon />}
              title="No jobs found"
              description="No background jobs match your current filters."
              action={
                (statusFilter || typeFilter) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setStatusFilter('')
                      setTypeFilter('')
                    }}
                  >
                    Clear Filters
                  </Button>
                )
              }
            />
          ) : (
            <DataTable
              data={jobs}
              columns={columns}
              getRowKey={(job) => job.id}
            />
          )}
        </Card>
      </Section>

      {/* Job Details */}
      {selectedJob && (() => {
        const job = jobs.find(j => j.id === selectedJob)
        if (!job) return null
        
        return (
          <Section>
            <Card title="Job Details">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Job ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-mono">{job.id}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Priority</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <Badge variant="secondary">{job.priority}</Badge>
                  </dd>
                </div>
                {job.started_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Started At</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(job.started_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {job.completed_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Completed At</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(job.completed_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Payload</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <pre className="bg-gray-50 p-3 rounded-md overflow-x-auto text-xs">
                      {JSON.stringify(job.payload, null, 2)}
                    </pre>
                  </dd>
                </div>
                {job.error_message && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">Error</dt>
                    <dd className="mt-1">
                      <div className="bg-red-50 border border-red-200 p-3 rounded-md">
                        <pre className="text-sm text-red-700 overflow-x-auto">
                          {job.error_message}
                        </pre>
                      </div>
                    </dd>
                  </div>
                )}
                {job.result && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">Result</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      <pre className="bg-gray-50 p-3 rounded-md overflow-x-auto text-xs">
                        {JSON.stringify(job.result, null, 2)}
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
        <Section>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            itemsPerPage={pageSize}
            onPageChange={setPage}
          />
        </Section>
      )}
    </Page>
  )
}
