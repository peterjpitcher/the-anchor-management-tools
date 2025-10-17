'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BackgroundJob, BackgroundJobFilters, BackgroundJobSummary } from '@/app/actions/backgroundJobs'
import { listBackgroundJobs, retryBackgroundJob, deleteBackgroundJob } from '@/app/actions/backgroundJobs'
import { runCronJob } from '@/app/actions/cronJobs'
import { formatDate } from '@/lib/dateUtils'
import toast from 'react-hot-toast'
import {
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  TrashIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Pagination } from '@/components/ui-v2/navigation/Pagination'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { Alert } from '@/components/ui-v2/feedback/Alert'

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
  sync_customer_stats: 'Sync Customer Stats',
  cleanup_old_messages: 'Cleanup Messages',
  update_sms_health: 'Update SMS Health',
}

const PAGE_SIZE = 50

type BackgroundJobsClientProps = {
  initialJobs: BackgroundJob[]
  initialSummary: BackgroundJobSummary
  canManage: boolean
  initialError: string | null
}

export default function BackgroundJobsClient({ initialJobs, initialSummary, canManage, initialError }: BackgroundJobsClientProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<BackgroundJob[]>(initialJobs)
  const [summary, setSummary] = useState<BackgroundJobSummary>(initialSummary)
  const [error, setError] = useState<string | null>(initialError)
  const [filters, setFilters] = useState<BackgroundJobFilters>({})
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [isMutating, startMutateTransition] = useTransition()
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    setJobs(initialJobs)
    setSummary(initialSummary)
  }, [initialJobs, initialSummary])

  const pagedJobs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return jobs.slice(start, start + PAGE_SIZE)
  }, [jobs, page])

  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))

  const fetchJobs = (nextFilters: BackgroundJobFilters = filters) => {
    startRefreshTransition(async () => {
      setError(null)
      const result = await listBackgroundJobs(nextFilters)
      if (result.error) {
        setError(result.error)
        return
      }
      setJobs(result.jobs ?? [])
      setSummary(result.summary ?? { total: 0, pending: 0, completed: 0, failed: 0 })
      setPage(1)
    })
  }

  const handleFilterChange = (next: BackgroundJobFilters) => {
    setFilters(next)
    fetchJobs(next)
  }

  const getStatusVariant = (status: string): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'pending':
        return 'warning'
      case 'processing':
        return 'info'
      case 'completed':
        return 'success'
      case 'failed':
        return 'error'
      case 'cancelled':
        return 'default'
      default:
        return 'default'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="h-4 w-4" />
      case 'processing':
        return <ArrowPathIcon className="h-4 w-4 animate-spin" />
      case 'completed':
        return <CheckCircleIcon className="h-4 w-4" />
      case 'failed':
      case 'cancelled':
        return <XCircleIcon className="h-4 w-4" />
      default:
        return <ExclamationCircleIcon className="h-4 w-4" />
    }
  }

  const processJobs = () => {
    setIsProcessing(true)
    setError(null)
    runCronJob('job-queue')
      .then((result) => {
        if (!result.success) {
          const message = result.error ?? 'Failed to process jobs'
          setError(message)
          toast.error(message)
          return
        }
        toast.success('Job processor triggered')
        fetchJobs()
      })
      .catch((err) => {
        console.error('Error processing jobs:', err)
        const message = err instanceof Error ? err.message : 'Failed to process jobs'
        setError(message)
        toast.error(message)
      })
      .finally(() => {
        setIsProcessing(false)
      })
  }

  const handleRetry = (jobId: string) => {
    startMutateTransition(async () => {
      const result = await retryBackgroundJob(jobId)
      if (result.error) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success('Job queued for retry')
      fetchJobs()
    })
  }

  const handleDelete = (jobId: string) => {
    const confirmed = confirm('Delete this job? This cannot be undone.')
    if (!confirmed) {
      return
    }

    startMutateTransition(async () => {
      const result = await deleteBackgroundJob(jobId)
      if (result.error) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success('Job deleted')
      fetchJobs()
    })
  }

  const columns = [
    {
      key: 'status',
      header: 'Status',
      cell: (job: BackgroundJob) => (
        <Badge variant={getStatusVariant(job.status)} icon={getStatusIcon(job.status)}>
          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (job: BackgroundJob) => jobTypeLabels[job.type] || job.type,
    },
    {
      key: 'created_at',
      header: 'Created',
      cell: (job: BackgroundJob) => formatDate(job.created_at),
    },
    {
      key: 'scheduled_for',
      header: 'Scheduled',
      cell: (job: BackgroundJob) => formatDate(job.scheduled_for),
    },
    {
      key: 'attempts',
      header: 'Attempts',
      cell: (job: BackgroundJob) => `${job.attempts} / ${job.max_attempts}`,
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (job: BackgroundJob) =>
        job.started_at && job.completed_at
          ? `${new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()}ms`
          : '-',
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
          {canManage && job.status === 'failed' && (
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => handleRetry(job.id)}
              title="Retry job"
              disabled={isMutating}
            >
              <ArrowPathIcon className="h-4 w-4" />
            </IconButton>
          )}
          {canManage && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => handleDelete(job.id)}
              title="Delete job"
              disabled={isMutating}
            >
              <TrashIcon className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      ),
    },
  ]

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Background Jobs' },
  ]

  return (
    <Page
      title="Background Jobs"
      description="Monitor and manage background job processing"
      breadcrumbs={breadcrumbs}
      actions={
        <div className="flex items-center gap-2">
          <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
          <Button
            variant="primary"
            onClick={processJobs}
            disabled={!canManage || isProcessing}
            loading={isProcessing}
            leftIcon={!isProcessing && <PlayIcon />}
            title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
          >
            {isProcessing ? 'Processing...' : 'Process Jobs'}
          </Button>
        </div>
      }
    >
      {error && <Alert variant="error" title="Error" description={error} className="mb-4" />}

      <Section>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Stat label="Total Jobs" value={summary.total} />
          <Stat label="Pending" value={summary.pending} color="warning" />
          <Stat label="Completed" value={summary.completed} color="success" />
          <Stat
            label="Failed"
            value={summary.failed}
            color={summary.failed > 0 ? 'error' : 'default'}
          />
        </div>
      </Section>

      <Section>
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Status Filter">
              <Select
                value={filters.status || ''}
                onChange={(e) => handleFilterChange({ ...filters, status: e.target.value || undefined })}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'processing', label: 'Processing' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
            </FormGroup>

            <FormGroup label="Type Filter">
              <Select
                value={filters.type || ''}
                onChange={(e) => handleFilterChange({ ...filters, type: e.target.value || undefined })}
                options={[
                  { value: '', label: 'All Types' },
                  ...Object.entries(jobTypeLabels).map(([value, label]) => ({ value, label })),
                ]}
              />
            </FormGroup>
          </div>
        </Card>
      </Section>

      <Section>
        <Card>
          {isRefreshing ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : pagedJobs.length === 0 ? (
            <EmptyState
              icon={<ExclamationCircleIcon />}
              title="No jobs found"
              description="No background jobs match your current filters."
              action={
                (filters.status || filters.type) && (
                  <Button
                    variant="secondary"
                    onClick={() => handleFilterChange({})}
                    disabled={isRefreshing}
                  >
                    Clear Filters
                  </Button>
                )
              }
            />
          ) : (
            <DataTable data={pagedJobs} columns={columns} getRowKey={(job) => job.id} />
          )}
        </Card>
      </Section>

      {pagedJobs.length > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={jobs.length}
          itemsPerPage={PAGE_SIZE}
          onPageChange={setPage}
          position="end"
        />
      )}

      {selectedJob && (() => {
        const job = jobs.find((j) => j.id === selectedJob)
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
                {job.error_message && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-red-600">Error</dt>
                    <dd className="mt-1 text-sm text-red-600 whitespace-pre-wrap">{job.error_message}</dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Payload</dt>
                  <dd className="mt-1">
                    <pre className="bg-gray-100 rounded-md p-3 text-xs overflow-x-auto">
                      {JSON.stringify(job.payload, null, 2)}
                    </pre>
                  </dd>
                </div>
                {job.result && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500">Result</dt>
                    <dd className="mt-1">
                      <pre className="bg-gray-100 rounded-md p-3 text-xs overflow-x-auto">
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
    </Page>
  )
}
