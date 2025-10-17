'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import type { WebhookLog } from '@/types/database'
import { listWebhookLogs } from '@/app/actions/webhooks'
import { formatDistanceToNow } from 'date-fns'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import { DataTable, type Column } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Stat } from '@/components/ui-v2/display/Stat'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { useRouter } from 'next/navigation'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { RefreshCwIcon, TestTubeIcon } from 'lucide-react'

type WebhookMonitorClientProps = {
  initialLogs: WebhookLog[]
  initialError: string | null
}

export default function WebhookMonitorClient({ initialLogs, initialError }: WebhookMonitorClientProps) {
  const router = useRouter()
  const [logs, setLogs] = useState<WebhookLog[]>(initialLogs)
  const [error, setError] = useState<string | null>(initialError)
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [isRefreshing, startRefreshTransition] = useTransition()

  const refreshLogs = () => {
    startRefreshTransition(async () => {
      setError(null)
      const result = await listWebhookLogs()
      if (result.error) {
        setError(result.error)
        return
      }
      setLogs(result.logs ?? [])
    })
  }

  const handleViewDetails = (log: WebhookLog) => {
    setSelectedLog(log)
    setDetailsOpen(true)
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'success':
        return 'success' as const
      case 'error':
      case 'exception':
        return 'error' as const
      case 'signature_failed':
        return 'warning' as const
      default:
        return 'default' as const
    }
  }

  const successCount = useMemo(() => logs.filter((log) => log.status === 'success').length, [logs])
  const errorCount = useMemo(
    () => logs.filter((log) => log.status === 'error' || log.status === 'exception').length,
    [logs],
  )
  const authFailedCount = useMemo(
    () => logs.filter((log) => log.status === 'signature_failed').length,
    [logs],
  )

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
        <span className="text-sm text-gray-900">{log.message_body ? 'Inbound' : 'Status Update'}</span>
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
            <div className="max-w-xs truncate" title={log.message_body ?? undefined}>
              {log.message_body}
            </div>
          )}
          {log.message_sid && <div className="text-xs text-gray-500">SID: {log.message_sid}</div>}
        </div>
      ),
    },
    {
      key: 'error',
      header: 'Error',
      cell: (log) => {
        if (!log.error_message) {
          return null
        }
        return (
          <div className="max-w-xs truncate text-red-600" title={log.error_message}>
            {log.error_message}
          </div>
        )
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      cell: (log) => (
        <Button variant="link" size="sm" onClick={() => handleViewDetails(log)}>
          View Details
        </Button>
      ),
    },
  ]

  const breadcrumbs = [
    { label: 'Settings', href: '/settings' },
    { label: 'Webhook Monitor' },
  ]

  return (
    <Page
      title='Webhook Monitor'
      description='Monitor incoming webhook requests and responses'
      breadcrumbs={breadcrumbs}
      actions={
        <div className="flex items-center space-x-3">
          <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
          <div className="flex gap-2">
            <LinkButton
              href="/settings/webhook-test"
              variant="secondary"
              leftIcon={<TestTubeIcon className="h-4 w-4" />}
            >
              Test Webhook
            </LinkButton>
            <Button
              onClick={refreshLogs}
              variant="secondary"
              leftIcon={<RefreshCwIcon className="h-4 w-4" />}
              disabled={isRefreshing}
              loading={isRefreshing}
            >
              Refresh
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <Alert variant="error" title="Error" description={error} className="mb-4" />
      )}

      <Section>
        <Card>
          {isRefreshing ? (
            <div className="flex items-center justify-center p-8">
              <Spinner size="lg" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No webhook logs found"
              description="Webhook requests will appear here when they are received."
              action={
                <Link href="/settings/webhook-test">
                  <Button>Test Webhook</Button>
                </Link>
              }
            />
          ) : (
            <DataTable
              data={logs}
              columns={columns}
              getRowKey={(log) => log.id}
              renderMobileCard={(log) => (
                <Card variant="bordered" padding="sm">
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <Badge variant={getStatusVariant(log.status)} size="sm">
                          {log.status}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDistanceToNow(new Date(log.processed_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Button variant="link" size="sm" onClick={() => handleViewDetails(log)}>
                        Details
                      </Button>
                    </div>

                    <div className="text-sm">
                      <span className="font-medium text-gray-700">
                        {log.message_body ? 'Inbound' : 'Status Update'}
                      </span>
                      {log.from_number && (
                        <p className="text-xs text-gray-500 mt-1">From: {log.from_number}</p>
                      )}
                      {log.to_number && (
                        <p className="text-xs text-gray-500">To: {log.to_number}</p>
                      )}
                    </div>

                    {log.message_body && (
                      <p className="text-sm text-gray-700 truncate">{log.message_body}</p>
                    )}

                    {log.message_sid && (
                      <p className="text-xs text-gray-500">SID: {log.message_sid}</p>
                    )}

                    {log.error_message && (
                      <p className="text-xs text-red-600 truncate">Error: {log.error_message}</p>
                    )}
                  </div>
                </Card>
              )}
            />
          )}
        </Card>
      </Section>

      <Section title="Webhook Statistics">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Successful" value={successCount} />
          <Stat label="Errors" value={errorCount} />
          <Stat label="Auth Failed" value={authFailedCount} />
          <Stat label="Total" value={logs.length} />
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
