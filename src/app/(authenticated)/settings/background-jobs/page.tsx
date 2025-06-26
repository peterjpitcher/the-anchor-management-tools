'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDate } from '@/lib/dateUtils'
import { usePagination } from '@/hooks/usePagination'
import { Pagination } from '@/components/Pagination'
import { 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon, 
  ExclamationCircleIcon,
  ArrowPathIcon,
  TrashIcon,
  PlayIcon
} from '@heroicons/react/24/outline'

interface BackgroundJob {
  id: string
  type: string
  payload: Record<string, any>
  status: 'pending' | 'processing' | 'completed' | 'failed'
  priority: number
  attempts: number
  max_attempts: number
  scheduled_for: string
  created_at: string
  processed_at?: string
  completed_at?: string
  error?: string
  result?: Record<string, any>
  duration_ms?: number
}

const jobTypeLabels: Record<string, string> = {
  send_sms: 'Send SMS',
  send_bulk_sms: 'Bulk SMS',
  process_reminder: 'Process Reminder',
  sync_customer_stats: 'Sync Customer Stats',
  cleanup_old_messages: 'Cleanup Messages',
  generate_report: 'Generate Report',
  process_webhook: 'Process Webhook',
  update_sms_health: 'Update SMS Health'
}

export default function BackgroundJobsPage() {
  const supabase = useSupabase()
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Build filters for pagination
  const paginationFilters = useMemo(() => {
    const filters = []
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
    'background_jobs',
    {
      select: '*',
      orderBy: { column: 'created_at', ascending: false },
      filters: paginationFilters
    },
    paginationOptions
  )

  // Set up real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('background_jobs_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'background_jobs' },
        () => {
          refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, refresh])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <ClockIcon className="h-5 w-5 text-gray-500" />
      case 'processing': return <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />
      case 'completed': return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'failed': return <XCircleIcon className="h-5 w-5 text-red-500" />
      default: return <ExclamationCircleIcon className="h-5 w-5 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-800'
      case 'processing': return 'bg-blue-100 text-blue-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'failed': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const processJobs = async () => {
    setIsProcessing(true)
    try {
      const response = await fetch('/api/jobs/process', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET_KEY || ''}`
        }
      })
      
      if (!response.ok) {
        throw new Error('Failed to process jobs')
      }
      
      await refresh()
    } catch (error) {
      console.error('Error processing jobs:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const retryJob = async (jobId: string) => {
    const { error } = await supabase
      .from('background_jobs')
      .update({ 
        status: 'pending',
        attempts: 0,
        error: null,
        scheduled_for: new Date().toISOString()
      })
      .eq('id', jobId)
    
    if (!error) {
      refresh()
    }
  }

  const deleteJob = async (jobId: string) => {
    const { error } = await supabase
      .from('background_jobs')
      .delete()
      .eq('id', jobId)
    
    if (!error) {
      refresh()
    }
  }

  if (isLoading) {
    return <div className="p-4">Loading jobs...</div>
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Background Jobs</h1>
        <button
          onClick={processJobs}
          disabled={isProcessing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isProcessing ? (
            <>
              <ArrowPathIcon className="h-5 w-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <PlayIcon className="h-5 w-5" />
              Process Jobs
            </>
          )}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Total Jobs</div>
          <div className="text-2xl font-bold">{totalCount}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Pending</div>
          <div className="text-2xl font-bold text-gray-600">
            {jobs.filter(j => j.status === 'pending').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Completed</div>
          <div className="text-2xl font-bold text-green-600">
            {jobs.filter(j => j.status === 'completed').length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-600">Failed</div>
          <div className="text-2xl font-bold text-red-600">
            {jobs.filter(j => j.status === 'failed').length}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border-gray-300"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border-gray-300"
          >
            <option value="">All Types</option>
            {Object.entries(jobTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Scheduled
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Attempts
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duration
              </th>
              <th className="relative px-6 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(job.status)}
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {jobTypeLabels[job.type] || job.type}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(job.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(job.scheduled_for)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {job.attempts} / {job.max_attempts}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {job.duration_ms ? `${job.duration_ms}ms` : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setSelectedJob(selectedJob === job.id ? null : job.id)}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {selectedJob === job.id ? 'Hide' : 'Details'}
                    </button>
                    {job.status === 'failed' && (
                      <button
                        onClick={() => retryJob(job.id)}
                        className="text-orange-600 hover:text-orange-900"
                        title="Retry job"
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                      </button>
                    )}
                    {(job.status === 'completed' || job.status === 'failed') && (
                      <button
                        onClick={() => deleteJob(job.id)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete job"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {jobs.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No jobs found matching your filters
          </div>
        )}
      </div>

      {/* Job Details */}
      {selectedJob && (() => {
        const job = jobs.find(j => j.id === selectedJob)
        if (!job) return null
        
        return (
          <div className="mt-4 bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Job Details</h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Job ID</dt>
                <dd className="mt-1 text-sm text-gray-900">{job.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Priority</dt>
                <dd className="mt-1 text-sm text-gray-900">{job.priority}</dd>
              </div>
              {job.processed_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Processed At</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(job.processed_at).toLocaleString()}
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
                  <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                    {JSON.stringify(job.payload, null, 2)}
                  </pre>
                </dd>
              </div>
              {job.error && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Error</dt>
                  <dd className="mt-1 text-sm text-red-600">
                    <pre className="bg-red-50 p-2 rounded overflow-x-auto">
                      {job.error}
                    </pre>
                  </dd>
                </div>
              )}
              {job.result && (
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500">Result</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <pre className="bg-gray-100 p-2 rounded overflow-x-auto">
                      {JSON.stringify(job.result, null, 2)}
                    </pre>
                  </dd>
                </div>
              )}
            </dl>
          </div>
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