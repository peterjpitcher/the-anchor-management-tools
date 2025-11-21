'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BackgroundJob, BackgroundJobFilters, BackgroundJobSummary } from '@/app/actions/backgroundJobs'
import { listBackgroundJobs, retryBackgroundJob, deleteBackgroundJob } from '@/app/actions/backgroundJobs'
import { runCronJob } from '@/app/actions/cronJobs'
import { getReminderQueueSummary, type ReminderQueueSummary } from '@/app/actions/reminderQueue'
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
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
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
import { Alert } from '@/components/ui-v2/feedback/Alert'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

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
  initialReminderSummary?: ReminderQueueSummary | null
  initialReminderError?: string | null
}

const defaultReminderSummary: ReminderQueueSummary = {
  pendingDue: 0,
  pendingScheduled: 0,
  failed: 0,
  cancelled: 0,
  nextDueAt: null,
  lastSentAt: null,
  activeJobs: 0,
}

export default function BackgroundJobsClient({
  initialJobs,
  initialSummary,
  canManage,
  initialError,
  initialReminderSummary = defaultReminderSummary,
  initialReminderError = null
}: BackgroundJobsClientProps) {
  const router = useRouter()
  const [jobs, setJobs] = useState<BackgroundJob[]>(initialJobs)
  const [summary, setSummary] = useState<BackgroundJobSummary>(initialSummary)
  const [error, setError] = useState<string | null>(initialError)
  const [reminderSummary, setReminderSummary] = useState<ReminderQueueSummary>(
    initialReminderSummary ?? defaultReminderSummary
  )
  const [reminderError, setReminderError] = useState<string | null>(initialReminderError)
  const [filters, setFilters] = useState<BackgroundJobFilters>({})
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [isMutating, startMutateTransition] = useTransition()
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReminderRefreshing, startReminderRefresh] = useTransition()

  useEffect(() => {
    setJobs(initialJobs)
    setSummary(initialSummary)
    setReminderSummary(initialReminderSummary ?? defaultReminderSummary)
    setReminderError(initialReminderError ?? null)
  }, [initialJobs, initialSummary, initialReminderSummary, initialReminderError])

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

  const refreshReminderSummary = () => {
    startReminderRefresh(async () => {
      const result = await getReminderQueueSummary()
      if (result.error) {
        setReminderError(result.error)
        toast.error(result.error)
        return
      }

      if (result.summary) {
        setReminderSummary(result.summary)
        setReminderError(null)
      }
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

  const navItems: HeaderNavItem[] = [
    { label: 'Summary', href: '#summary' },
    { label: 'Jobs', href: '#jobs' },
    { label: 'Details', href: '#job-details' },
  ]

  const navActions = canManage ? (
    <Button
      variant="primary"
      size="sm"
      onClick={processJobs}
      disabled={!canManage || isProcessing}
      loading={isProcessing}
      leftIcon={!isProcessing && <PlayIcon />}
      title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
    >
      {isProcessing ? 'Processing...' : 'Process Jobs'}
    </Button>
  ) : undefined

  const selectedJobDetails = selectedJob ? jobs.find((j) => j.id === selectedJob) : null

  return (
    <PageLayout
      title="Background Jobs"
      subtitle="Monitor and manage background job processing"
      breadcrumbs={breadcrumbs}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      navItems={navItems}
      navActions={navActions}
    >
      <div className="space-y-6">
        {error && <Alert variant="error" title="Error" description={error} />}

        <Section id="summary" title="Summary">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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

        <Section title="Reminder Queue Health">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-gray-600">
              Tracks scheduled event reminders still waiting to send. Jobs run asynchronously via the queue.
            </p>
            <div className="flex items-center gap-2">
              {reminderError && <span className="text-sm text-red-600">{reminderError}</span>}
              <Button
                variant="secondary"
                size="sm"
                onClick={refreshReminderSummary}
                disabled={isReminderRefreshing}
                loading={isReminderRefreshing}
              >
                Refresh
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <Stat label="Due Now" value={reminderSummary.pendingDue} color={reminderSummary.pendingDue > 0 ? 'warning' : 'default'} />
            <Stat label="Upcoming" value={reminderSummary.pendingScheduled} />
            <Stat label="Failed" value={reminderSummary.failed} color={reminderSummary.failed > 0 ? 'error' : 'default'} />
            <Stat label="Cancelled" value={reminderSummary.cancelled} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <p className="text-sm text-gray-600">Next Reminder Due</p>
              <p className="mt-1 text-lg font-semibold">
                {reminderSummary.nextDueAt ? formatDate(reminderSummary.nextDueAt) : 'None'}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-600">Last Reminder Sent</p>
              <p className="mt-1 text-lg font-semibold">
                {reminderSummary.lastSentAt ? formatDate(reminderSummary.lastSentAt) : 'Not recorded'}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-600">Active Reminder Jobs</p>
              <p className="mt-1 text-lg font-semibold">{reminderSummary.activeJobs}</p>
            </Card>
          </div>
        </Section>

        <Section title="Filters">
          <Card>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => handleFilterChange({})} disabled={isRefreshing}>
                Clear Filters
              </Button>
            </div>
          </Card>
        </Section>

        <Section id="jobs" title="Jobs">
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

        {selectedJobDetails && (
          <Section id="job-details" title="Job Details">
            <Card>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Job ID</dt>
                  <dd className="mt-1 text-sm text-gray-900 font-mono">{selectedJobDetails.id}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Priority</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <Badge variant="secondary">{selectedJobDetails.priority}</Badge>
                  </dd>
                </div>
                {selectedJobDetails.started_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Started At</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(selectedJobDetails.started_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {selectedJobDetails.completed_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Completed At</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(selectedJobDetails.completed_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                {selectedJobDetails.error_message && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-red-600">Error</dt>
                    <dd className="mt-1 text-sm text-red-600 whitespace-pre-wrap">
                      {selectedJobDetails.error_message}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          </Section>
        )}

        {selectedJobDetails?.status === 'failed' && selectedJobDetails.error_message && (
          <Section title="Error Message">
            <Card>
              <pre className="text-sm text-red-600 whitespace-pre-wrap bg-red-50 p-3 rounded">
                {selectedJobDetails.error_message}
              </pre>
            </Card>
          </Section>
        )}

        {selectedJobDetails?.payload && (
          <Section title="Payload">
            <Card>
              <pre className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">
                {JSON.stringify(selectedJobDetails.payload, null, 2)}
              </pre>
            </Card>
          </Section>
        )}

        {selectedJobDetails?.result && (
          <Section title="Result">
            <Card>
              <pre className="text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded">
                {JSON.stringify(selectedJobDetails.result, null, 2)}
              </pre>
            </Card>
          </Section>
        )}
      </div>
    </PageLayout>
  )
}
