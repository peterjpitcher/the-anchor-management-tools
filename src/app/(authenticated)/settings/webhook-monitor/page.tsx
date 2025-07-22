'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { WebhookLog } from '@/types/database'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { RefreshCwIcon, TestTubeIcon } from 'lucide-react'

export default function WebhookMonitorPage() {
  const supabase = useSupabase()
  
  const [logs, setLogs] = useState<WebhookLog[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  
  const loadLogs = useCallback(async () => {
    setLoading(true)
    
    const { data, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(100)
    
    if (error) {
      console.error('Error fetching webhook logs:', error)
      setLogs([])
    } else {
      setLogs(data || [])
    }
    
    setLoading(false)
  }, [supabase])
  
  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'success':
        return 'success'
      case 'error':
      case 'exception':
        return 'error'
      case 'signature_failed':
        return 'warning'
      default:
        return 'default'
    }
  }

  const columns: Column<WebhookLog>[] = [
    {
      key: 'processed_at',
      header: 'Time',
      cell: (log) => (
        <span className="text-sm text-gray-900">
          {formatDistanceToNow(new Date(log.processed_at), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (log) => (
        <Badge variant={getStatusVariant(log.status)} size="sm">
          {log.status}
        </Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (log) => (
        <span className="text-sm text-gray-900">
          {log.message_body ? 'Inbound' : 'Status Update'}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'From/To',
      cell: (log) => (
        <div className="text-xs">
          {log.from_number && <div>From: {log.from_number}</div>}
          {log.to_number && <div>To: {log.to_number}</div>}
        </div>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      cell: (log) => (
        <div>
          {log.message_body && (
            <div className="max-w-xs truncate" title={log.message_body}>
              {log.message_body}
            </div>
          )}
          {log.message_sid && (
            <div className="text-xs text-gray-500">
              SID: {log.message_sid}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'error',
      header: 'Error',
      cell: (log) => (
        log.error_message && (
          <div className="max-w-xs truncate text-red-600" title={log.error_message}>
            {log.error_message}
          </div>
        )
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      cell: (log) => (
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            setSelectedLog(log)
            setDetailsOpen(true)
          }}
        >
          View Details
        </Button>
      ),
    },
  ]

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Webhook Monitor' }
  ]

  const actions = (
    <div className="flex gap-2">
      <LinkButton href="/settings/webhook-test"
        variant="secondary"
        leftIcon={<TestTubeIcon className="h-4 w-4" />}
      >
        Test Webhook
      </LinkButton>
      <Button
        onClick={() => loadLogs()}
        variant="secondary"
        leftIcon={<RefreshCwIcon className="h-4 w-4" />}
      >
        Refresh
      </Button>
    </div>
  )

  const successCount = logs.filter(l => l.status === 'success').length
  const errorCount = logs.filter(l => l.status === 'error' || l.status === 'exception').length
  const authFailedCount = logs.filter(l => l.status === 'signature_failed').length

  return (
    <Page
      title="Webhook Monitor"
      description="Monitor incoming webhook requests and responses"
      breadcrumbs={breadcrumbs}
      actions={actions}
    >
      <Section>
        <Card>
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Spinner size="lg" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No webhook logs found"
              description="Webhook requests will appear here when they are received."
              action={
                <Link href="/settings/webhook-test">
                  <Button>
                    Test Webhook
                  </Button>
                </Link>
              }
            />
          ) : (
            <DataTable
              data={logs}
              columns={columns}
              getRowKey={(log) => log.id}
            />
          )}
        </Card>
      </Section>

      <Section title="Webhook Statistics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat
            label="Successful"
            value={successCount}
          />
          <Stat
            label="Errors"
            value={errorCount}
          />
          <Stat
            label="Auth Failed"
            value={authFailedCount}
          />
          <Stat
            label="Total"
            value={logs.length}
          />
        </div>
      </Section>

      <Modal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false)
          setSelectedLog(null)
        }}
        title="Webhook Details"
        size="lg"
      >
        {selectedLog && (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">Headers</h4>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(selectedLog.headers, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">Parameters</h4>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(selectedLog.params, null, 2)}
              </pre>
            </div>
            {selectedLog.error_details && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Error Details</h4>
                <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                  {JSON.stringify(selectedLog.error_details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Page>
  )
}