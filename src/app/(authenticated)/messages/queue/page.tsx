'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDistanceToNow } from 'date-fns'
import { 
  ExclamationTriangleIcon, 
  CheckCircleIcon, 
  ClockIcon,
  XCircleIcon,
  ArrowPathIcon,
  TrashIcon
} from '@heroicons/react/24/outline'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { Alert } from '@/components/ui-v2/feedback/Alert'

interface QueuedMessage {
  id: string
  customer_id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  twilio_status: string | null
  twilio_message_sid: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  failed_at: string | null
  to_number: string
  from_number: string
  price: number | null
  customer?: {
    first_name: string
    last_name: string
  }
}

interface Job {
  id: string
  type: string
  status: string
  payload: unknown
  error: string | null
  attempts: number
  max_attempts: number
  created_at: string
  scheduled_for: string
  completed_at: string | null
  failed_at: string | null
}

interface QueueStats {
  totalQueued: number
  totalPending: number
  totalSending: number
  totalFailed: number
  totalDelivered: number
  totalJobs: number
  oldestMessage: string | null
}

export default function SMSQueueStatusPage() {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('queued')
  const [messages, setMessages] = useState<QueuedMessage[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<QueueStats>({
    totalQueued: 0,
    totalPending: 0,
    totalSending: 0,
    totalFailed: 0,
    totalDelivered: 0,
    totalJobs: 0,
    oldestMessage: null
  })
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      // Load messages
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select(`
          *,
          customer:customers(first_name, last_name)
        `)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(500)

      if (messagesError) throw messagesError

      // Load jobs
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'send_sms')
        .order('created_at', { ascending: false })
        .limit(100)

      if (jobsError) throw jobsError

      setMessages(messagesData || [])
      setJobs(jobsData || [])

      // Calculate stats
      const queued = messagesData?.filter((m: QueuedMessage) => m.status === 'queued') || []
      const pending = messagesData?.filter((m: QueuedMessage) => m.status === 'pending') || []
      const sending = messagesData?.filter((m: QueuedMessage) => m.status === 'sending') || []
      const failed = messagesData?.filter((m: QueuedMessage) => m.status === 'failed') || []
      const delivered = messagesData?.filter((m: QueuedMessage) => m.status === 'delivered') || []
      const pendingJobs = jobsData?.filter((j: Job) => j.status === 'pending') || []

      const allMessages = [...queued, ...pending, ...sending] as QueuedMessage[]
      const oldestQueued = allMessages.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )[0]

      setStats({
        totalQueued: queued.length,
        totalPending: pending.length,
        totalSending: sending.length,
        totalFailed: failed.length,
        totalDelivered: delivered.length,
        totalJobs: pendingJobs.length,
        oldestMessage: oldestQueued?.created_at || null
      })
    } catch (error) {
      console.error('Error loading SMS queue data:', error)
      toast.error('Failed to load SMS queue data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
    // Refresh every 10 seconds
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [loadData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
  }

  const reconcileMessage = async (_messageId: string) => {
    try {
      // This would call a server action to check Twilio's API for the message status
      toast.info('Reconciliation would check Twilio API for message status')
      // TODO: Implement server action to reconcile with Twilio
    } catch {
      toast.error('Failed to reconcile message')
    }
  }

  const retryMessage = async (_messageId: string) => {
    try {
      // This would call a server action to retry sending the message
      toast.info('Retry functionality would resend the message via Twilio')
      // TODO: Implement server action to retry message
    } catch {
      toast.error('Failed to retry message')
    }
  }

  const deleteMessage = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId)

      if (error) throw error

      toast.success('Message deleted')
      await loadData()
    } catch {
      toast.error('Failed to delete message')
    }
  }

  const clearOldMessages = async () => {
    if (!confirm('Are you sure you want to delete all messages older than 7 days?')) {
      return
    }

    try {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const { error } = await supabase
        .from('messages')
        .delete()
        .in('status', ['queued', 'pending', 'failed'])
        .lt('created_at', sevenDaysAgo.toISOString())

      if (error) throw error

      toast.success('Old messages cleared')
      await loadData()
    } catch {
      toast.error('Failed to clear old messages')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'sent':
        return <CheckCircleIcon className="h-5 w-5 text-blue-500" />
      case 'failed':
      case 'undelivered':
        return <XCircleIcon className="h-5 w-5 text-red-500" />
      case 'queued':
      case 'pending':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />
      case 'sending':
        return <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin" />
      default:
        return null
    }
  }

  const getStatusBadgeVariant = (status: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'delivered':
        return 'success'
      case 'sent':
        return 'info'
      case 'failed':
      case 'undelivered':
        return 'error'
      case 'queued':
      case 'pending':
      case 'sending':
        return 'warning'
      default:
        return 'info'
    }
  }

  const filteredMessages = messages.filter(message => {
    switch (activeTab) {
      case 'queued':
        return ['queued', 'pending', 'sending'].includes(message.status)
      case 'failed':
        return ['failed', 'undelivered'].includes(message.status)
      case 'delivered':
        return ['delivered', 'sent'].includes(message.status)
      default:
        return true
    }
  })

  const filteredJobs = jobs.filter((_job) => {
    switch (activeTab) {
      case 'jobs':
        return true
      default:
        return false
    }
  })

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader
          title="SMS Queue Status"
          subtitle="Monitor and manage SMS message queue"
          backButton={{ label: "Back to Messages", href: "/messages" }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Spinner size="lg" />
              <p className="mt-4 text-gray-600">Loading SMS queue data...</p>
            </div>
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHeader
        title="SMS Queue Status"
        subtitle="Monitor and manage SMS message queue"
        backButton={{ label: "Back to Messages", href: "/messages" }}
        actions={
          <div className="flex gap-2">
            <Button
              onClick={handleRefresh}
              variant="secondary"
              size="sm"
              disabled={refreshing}
            >
              {refreshing ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <ArrowPathIcon className="h-4 w-4 mr-2" />
                  Refresh
                </>
              )}
            </Button>
            <Button
              onClick={clearOldMessages}
              variant="danger"
              size="sm"
            >
              <TrashIcon className="h-4 w-4 mr-2" />
              Clear Old Messages
            </Button>
          </div>
        }
      />
      
      <PageContent>
        {/* Stats Overview */}
        <Card>
          <StatGroup>
            <Stat 
              label="Queued" 
              value={stats.totalQueued} 
              color={stats.totalQueued > 0 ? "warning" : "default"} 
            />
            <Stat 
              label="Pending" 
              value={stats.totalPending} 
              color={stats.totalPending > 0 ? "warning" : "default"} 
            />
            <Stat 
              label="Sending" 
              value={stats.totalSending} 
              color={stats.totalSending > 0 ? "info" : "default"} 
            />
            <Stat 
              label="Failed" 
              value={stats.totalFailed} 
              color={stats.totalFailed > 0 ? "error" : "default"} 
            />
            <Stat 
              label="Delivered" 
              value={stats.totalDelivered} 
              color="success" 
            />
            <Stat 
              label="Pending Jobs" 
              value={stats.totalJobs} 
              color={stats.totalJobs > 0 ? "warning" : "default"} 
            />
          </StatGroup>
        </Card>

        {/* Alert for stuck messages */}
        {stats.oldestMessage && (
          <Alert variant="warning">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <div>
              <strong>Stuck Messages Detected</strong>
              <p>
                You have messages in the queue. The oldest message has been waiting{' '}
                {formatDistanceToNow(new Date(stats.oldestMessage), { addSuffix: false })}.
              </p>
            </div>
          </Alert>
        )}

        {/* Tabs for different views */}
        <Card>
          <Tabs
            items={[
              { key: 'queued', label: `Queued (${stats.totalQueued + stats.totalPending + stats.totalSending})`, content: null },
              { key: 'failed', label: `Failed (${stats.totalFailed})`, content: null },
              { key: 'delivered', label: `Delivered (${stats.totalDelivered})`, content: null },
              { key: 'jobs', label: `Jobs (${stats.totalJobs})`, content: null },
            ]}
            activeKey={activeTab}
            onChange={setActiveTab}
            padded={false}
          />
        </Card>

        {/* Message/Job List */}
        <Section title={activeTab === 'jobs' ? 'SMS Jobs' : 'Messages'}>
          <Card>
            {activeTab === 'jobs' ? (
              // Jobs view
              filteredJobs.length === 0 ? (
                <EmptyState
                  title="No pending jobs"
                  description="All SMS jobs have been processed"
                />
              ) : (
                <DataTable
                  data={filteredJobs}
                  getRowKey={(job) => job.id}
                  columns={[
                    {
                      key: 'id',
                      header: 'Job ID',
                      cell: (job) => <span className="text-sm font-medium text-gray-900">{job.id.substring(0,8)}...</span>
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (job) => <Badge variant={getStatusBadgeVariant(job.status)}>{job.status}</Badge>
                    },
                    {
                      key: 'attempts',
                      header: 'Attempts',
                      cell: (job) => <span className="text-sm text-gray-500">{job.attempts} / {job.max_attempts}</span>
                    },
                    {
                      key: 'created',
                      header: 'Created',
                      cell: (job) => <span className="text-sm text-gray-500">{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
                    },
                    {
                      key: 'error',
                      header: 'Error',
                      cell: (job) => <span className="text-sm text-red-600">{job.error || '-'}</span>
                    }
                  ]}
                  emptyMessage="No pending jobs"
                />
              )
            ) : (
              // Messages view
              filteredMessages.length === 0 ? (
                <EmptyState
                  title={`No ${activeTab} messages`}
                  description={`There are no messages in ${activeTab} status`}
                />
              ) : (
                <DataTable
                  data={filteredMessages}
                  getRowKey={(m) => m.id}
                  columns={[
                    {
                      key: 'to',
                      header: 'To',
                      cell: (m) => (
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {m.customer?.first_name} {m.customer?.last_name}
                          </div>
                          <div className="text-sm text-gray-500">{m.to_number}</div>
                        </div>
                      )
                    },
                    {
                      key: 'message',
                      header: 'Message',
                      cell: (m) => (
                        <div className="text-sm text-gray-900 max-w-xs truncate">{m.body}</div>
                      )
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      cell: (m) => (
                        <div className="flex items-center">
                          {getStatusIcon(m.status)}
                          <Badge variant={getStatusBadgeVariant(m.status)} size="sm" className="ml-2">
                            {m.status}
                          </Badge>
                        </div>
                      )
                    },
                    {
                      key: 'twilio',
                      header: 'Twilio Status',
                      cell: (m) => m.twilio_status ? (
                        <Badge variant="info" size="sm">{m.twilio_status}</Badge>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )
                    },
                    {
                      key: 'created',
                      header: 'Created',
                      cell: (m) => <span className="text-sm text-gray-500">{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</span>
                    },
                    {
                      key: 'error',
                      header: 'Error',
                      cell: (m) => m.error_message ? (
                        <span className="text-sm text-red-600">{m.error_code ? `${m.error_code}: ` : ''}{m.error_message}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      align: 'right',
                      cell: (m) => (
                        <div className="flex gap-2 justify-end">
                          {['queued', 'pending', 'sending'].includes(m.status) && (
                            <button onClick={() => reconcileMessage(m.id)} className="text-blue-600 hover:text-blue-900" title="Check status with Twilio">Reconcile</button>
                          )}
                          {m.status === 'failed' && (
                            <button onClick={() => retryMessage(m.id)} className="text-green-600 hover:text-green-900" title="Retry sending">Retry</button>
                          )}
                          <button onClick={() => deleteMessage(m.id)} className="text-red-600 hover:text-red-900" title="Delete message">Delete</button>
                        </div>
                      )
                    },
                  ]}
                  emptyMessage={`No ${activeTab} messages`}
                />
              )
            )}
          </Card>
        </Section>

        {/* Information Section */}
        <Section title="Queue Information">
          <Card>
            <div className="space-y-4 text-sm text-gray-600">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Message Status Definitions:</h4>
                <ul className="space-y-1">
                  <li>• <strong>Queued:</strong> Message is waiting to be sent to Twilio</li>
                  <li>• <strong>Pending:</strong> Message has been accepted by our system</li>
                  <li>• <strong>Sending:</strong> Message is being sent to Twilio</li>
                  <li>• <strong>Sent:</strong> Twilio has accepted the message</li>
                  <li>• <strong>Delivered:</strong> Message was delivered to the recipient</li>
                  <li>• <strong>Failed:</strong> Message could not be sent</li>
                  <li>• <strong>Undelivered:</strong> Twilio could not deliver the message</li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Twilio Status Tracking:</h4>
                <ul className="space-y-1">
                  <li>• Messages are sent to Twilio via API</li>
                  <li>• Twilio sends webhook callbacks for status updates</li>
                  <li>• If no update after 12 hours, reconciliation is needed</li>
                  <li>• Daily reconciliation recommended for all pending messages</li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-gray-900 mb-2">Common Error Codes:</h4>
                <ul className="space-y-1">
                  <li>• <strong>21211:</strong> Invalid phone number format</li>
                  <li>• <strong>21610:</strong> Number has opted out</li>
                  <li>• <strong>20429:</strong> Rate limit exceeded</li>
                  <li>• <strong>30003:</strong> Unreachable destination</li>
                  <li>• <strong>30005:</strong> Unknown destination</li>
                </ul>
              </div>
            </div>
          </Card>
        </Section>
      </PageContent>
    </PageWrapper>
  )
}
