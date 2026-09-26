'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BackgroundJob, BackgroundJobFilters, BackgroundJobSummary } from '@/app/actions/backgroundJobs'
import { listBackgroundJobs, retryBackgroundJob, deleteBackgroundJob } from '@/app/actions/backgroundJobs'
import { runCronJob } from '@/app/actions/cronJobs'
import { formatDate } from '@/lib/dateUtils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Empty,
  Field,
  Icon,
  IconButton,
  PageLayout,
  PageLoading,
  Select,
  Spinner,
  Stat,
  StatGrid,
  TablePagination,
  toast,
} from '@/ds'
import type { DescriptionListItem } from '@/ds'
import { backgroundJobStatusTone } from '../_shared/status-ui'

const jobTypeLabels: Record<string, string> = {
  send_sms: 'Send SMS',
  send_bulk_sms: 'Bulk SMS',
  send_event_reschedule_notifications: 'Event Reschedule Notifications',
  send_event_postponed_notifications: 'Event Postponed Notifications',
  cancel_event_bookings: 'Cancel Event Bookings',
  export_employees: 'Export Employees',
  rebuild_category_stats: 'Rebuild Category Stats',
  categorize_historical_events: 'Categorize Events',
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

export default function BackgroundJobsClient({
  initialJobs,
  initialSummary,
  canManage,
  initialError,
}: BackgroundJobsClientProps) {
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
  const [isProcessingEngagement, setIsProcessingEngagement] = useState(false)
  const [isProcessingCommsMonitor, setIsProcessingCommsMonitor] = useState(false)
  const [isProcessingCommsRetention, setIsProcessingCommsRetention] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Icon name="clock" size={16} />
      case 'processing':
        return <Spinner size="sm" />
      case 'completed':
        return <Icon name="checkCircle" size={16} />
      case 'failed':
      case 'cancelled':
        return <Icon name="xCircle" size={16} />
      default:
        return <Icon name="alertCircle" size={16} />
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

  const processEventGuestEngagement = () => {
    setIsProcessingEngagement(true)
    setError(null)
    runCronJob('event-guest-engagement')
      .then((result) => {
        if (!result.success) {
          const message = result.error ?? 'Failed to process event messaging'
          setError(message)
          toast.error(message)
          return
        }
        toast.success('Event messaging triggered')
        fetchJobs()
      })
      .catch((err) => {
        console.error('Error processing event messaging:', err)
        const message = err instanceof Error ? err.message : 'Failed to process event messaging'
        setError(message)
        toast.error(message)
      })
      .finally(() => {
        setIsProcessingEngagement(false)
      })
  }

  const processCommunicationsMonitor = () => {
    setIsProcessingCommsMonitor(true)
    setError(null)
    runCronJob('communications-monitor')
      .then((result) => {
        if (!result.success) {
          const message = result.error ?? 'Failed to run communications monitor'
          setError(message)
          toast.error(message)
          return
        }
        toast.success('Communications monitor triggered')
      })
      .catch((err) => {
        console.error('Error running communications monitor:', err)
        const message = err instanceof Error ? err.message : 'Failed to run communications monitor'
        setError(message)
        toast.error(message)
      })
      .finally(() => {
        setIsProcessingCommsMonitor(false)
      })
  }

  const processCommunicationsRetention = () => {
    setIsProcessingCommsRetention(true)
    setError(null)
    runCronJob('communications-retention')
      .then((result) => {
        if (!result.success) {
          const message = result.error ?? 'Failed to run communications retention'
          setError(message)
          toast.error(message)
          return
        }
        toast.success('Communications retention triggered')
      })
      .catch((err) => {
        console.error('Error running communications retention:', err)
        const message = err instanceof Error ? err.message : 'Failed to run communications retention'
        setError(message)
        toast.error(message)
      })
      .finally(() => {
        setIsProcessingCommsRetention(false)
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
        <Badge tone={backgroundJobStatusTone(job.status)} icon={getStatusIcon(job.status)}>
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
              label="Retry job"
              title="Retry job"
              disabled={isMutating}
            >
              <Icon name="refresh" size={16} />
            </IconButton>
          )}
          {canManage && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
            <IconButton
              variant="secondary"
              size="sm"
              onClick={() => setDeleteTargetId(job.id)}
              label="Delete job"
              title="Delete job"
              disabled={isMutating}
            >
              <Icon name="trash" size={16} />
            </IconButton>
          )}
        </div>
      ),
    },
  ]

  const headerActions = canManage ? (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={processCommunicationsMonitor}
        disabled={!canManage || isProcessingCommsMonitor}
        loading={isProcessingCommsMonitor}
        leftIcon={!isProcessingCommsMonitor && <Icon name="play" size={16} />}
        title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
      >
        {isProcessingCommsMonitor ? 'Running Monitor...' : 'Run Comms Monitor'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={processCommunicationsRetention}
        disabled={!canManage || isProcessingCommsRetention}
        loading={isProcessingCommsRetention}
        leftIcon={!isProcessingCommsRetention && <Icon name="play" size={16} />}
        title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
      >
        {isProcessingCommsRetention ? 'Running Retention...' : 'Run Comms Retention'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={processEventGuestEngagement}
        disabled={!canManage || isProcessingEngagement}
        loading={isProcessingEngagement}
        leftIcon={!isProcessingEngagement && <Icon name="play" size={16} />}
        title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
      >
        {isProcessingEngagement ? 'Running Event Messaging...' : 'Run Event Messaging'}
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={processJobs}
        disabled={!canManage || isProcessing}
        loading={isProcessing}
        leftIcon={!isProcessing && <Icon name="play" size={16} />}
        title={!canManage ? 'You need settings manage permission to process jobs.' : undefined}
      >
        {isProcessing ? 'Processing...' : 'Process Jobs'}
      </Button>
    </>
  ) : undefined

  const selectedJobDetails = selectedJob ? jobs.find((j) => j.id === selectedJob) : null

  return (
    <PageLayout
      title="Background Jobs"
      subtitle="Monitor and manage background job processing"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={headerActions}
    >
      {error && <Alert tone="danger" title="Error">{error}</Alert>}

      <StatGrid columns={4}>
        <Stat label="Total Jobs" value={summary.total} />
        <Stat label="Pending" value={summary.pending} tone={summary.pending > 0 ? 'warning' : 'default'} />
        <Stat label="Completed" value={summary.completed} tone="success" />
        <Stat label="Failed" value={summary.failed} tone={summary.failed > 0 ? 'danger' : 'default'} />
      </StatGrid>

      <Card padding="none">
        <CardHeader title="Jobs" />
        <CardBody className="flex flex-wrap items-end gap-3 border-b border-border">
          <Field label="Status Filter" className="w-full sm:w-48">
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
          </Field>

          <Field label="Type Filter" className="w-full sm:w-64">
            <Select
              value={filters.type || ''}
              onChange={(e) => handleFilterChange({ ...filters, type: e.target.value || undefined })}
              options={[
                { value: '', label: 'All Types' },
                ...Object.entries(jobTypeLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
          </Field>

          <Button variant="secondary" onClick={() => handleFilterChange({})} disabled={isRefreshing}>
            Clear Filters
          </Button>
        </CardBody>

        {isRefreshing ? (
          <PageLoading inline label="Loading jobs" />
        ) : pagedJobs.length === 0 ? (
          // A failed load is reported by the error above, never shown as an empty list.
          error ? null : (
            <Empty
              size="sm"
              icon={<Icon name="alertCircle" size={48} />}
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
          )
        ) : (
          <DataTable data={pagedJobs} columns={columns} getRowKey={(job) => job.id} bordered={false} />
        )}

        {pagedJobs.length > 0 && (
          <TablePagination
            page={page}
            totalPages={totalPages}
            totalItems={jobs.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </Card>

      {selectedJobDetails && (
        <Card>
          <CardHeader title="Job Details" />
          <CardBody>
            <DescriptionList
              items={[
                {
                  key: 'id',
                  label: 'Job ID',
                  value: <span className="font-mono">{selectedJobDetails.id}</span>,
                },
                {
                  key: 'priority',
                  label: 'Priority',
                  value: <Badge>{selectedJobDetails.priority}</Badge>,
                },
                ...(selectedJobDetails.started_at
                  ? [{
                      key: 'started_at',
                      label: 'Started At',
                      value: new Date(selectedJobDetails.started_at).toLocaleString(),
                    }]
                  : []),
                ...(selectedJobDetails.completed_at
                  ? [{
                      key: 'completed_at',
                      label: 'Completed At',
                      value: new Date(selectedJobDetails.completed_at).toLocaleString(),
                    }]
                  : []),
                ...(selectedJobDetails.error_message
                  ? [{
                      key: 'error',
                      label: 'Error',
                      value: <span className="whitespace-pre-wrap text-danger-fg">{selectedJobDetails.error_message}</span>,
                      span: 2,
                    } satisfies DescriptionListItem]
                  : []),
              ]}
            />
          </CardBody>
        </Card>
      )}

      {selectedJobDetails?.status === 'failed' && selectedJobDetails.error_message && (
        <Alert tone="danger" title="Error Message">
          <pre className="whitespace-pre-wrap text-sm">{selectedJobDetails.error_message}</pre>
        </Alert>
      )}

      {selectedJobDetails?.payload && (
        <Card>
          <CardHeader title="Payload" />
          <CardBody>
            <pre className="text-sm whitespace-pre-wrap bg-surface-2 p-3 rounded-sm">
              {JSON.stringify(selectedJobDetails.payload, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      {selectedJobDetails?.result && (
        <Card>
          <CardHeader title="Result" />
          <CardBody>
            <pre className="text-sm whitespace-pre-wrap bg-surface-2 p-3 rounded-sm">
              {JSON.stringify(selectedJobDetails.result, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (deleteTargetId) handleDelete(deleteTargetId)
        }}
        tone="danger"
        title="Delete Job"
        message="Delete this job? This cannot be undone."
        confirmLabel="Delete"
      />
    </PageLayout>
  )
}
