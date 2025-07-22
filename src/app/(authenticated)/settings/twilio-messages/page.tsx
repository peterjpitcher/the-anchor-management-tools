'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchTwilioMessages, MessageComparison } from './actions'
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { Page } from '@/components/ui-v2/layout/Page'
import { Section } from '@/components/ui-v2/layout/Section'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Badge } from '@/components/ui-v2/display/Badge'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Stat } from '@/components/ui-v2/display/Stat'

export default function TwilioMessagesPage() {
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<MessageComparison[]>([])
  const [unloggedCount, setUnloggedCount] = useState<number | null>(null)
  const [showUnloggedOnly, setShowUnloggedOnly] = useState(false)
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 24 hours ago
    endDate: new Date().toISOString().split('T')[0] // Today
  })

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchTwilioMessages(dateRange.startDate, dateRange.endDate, 200)
      
      if (result.error) {
        toast.error(result.error)
        return
      }

      if (result.messages) {
        const filteredMessages = showUnloggedOnly 
          ? result.messages.filter(m => !m.isLogged)
          : result.messages
        
        setMessages(filteredMessages)
        
        // Count unlogged messages
        const unlogged = result.messages.filter(m => !m.isLogged).length
        setUnloggedCount(unlogged)
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [dateRange, showUnloggedOnly])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  function formatPhoneNumber(phone: string) {
    // Remove country code for display
    if (phone.startsWith('+44')) {
      return '0' + phone.substring(3)
    }
    return phone
  }

  function getStatusVariant(status: string): 'success' | 'error' | 'warning' | 'default' {
    switch (status) {
      case 'delivered':
      case 'sent':
        return 'success'
      case 'failed':
      case 'undelivered':
        return 'error'
      case 'queued':
      case 'sending':
        return 'warning'
      default:
        return 'default'
    }
  }

  function getDirectionIcon(direction: string) {
    if (direction.startsWith('outbound')) {
      return '↗️ '
    } else if (direction === 'inbound') {
      return '↙️ '
    }
    return ''
  }

  // Define table columns
  const columns: Column<MessageComparison>[] = [
    {
      key: 'status',
      header: 'Status',
      cell: (comparison) => {
        const msg = comparison.twilioMessage
        return (
          <div>
            <Badge variant={getStatusVariant(msg.status)} size="sm">
              {msg.status}
            </Badge>
            {msg.errorCode && (
              <div className="text-xs text-red-600 mt-1">
                Error {msg.errorCode}: {msg.errorMessage}
              </div>
            )}
          </div>
        )
      }
    },
    {
      key: 'direction',
      header: 'Direction',
      cell: (comparison) => (
        <span className="text-sm text-gray-900">
          {getDirectionIcon(comparison.twilioMessage.direction)}
          {comparison.twilioMessage.direction}
        </span>
      )
    },
    {
      key: 'phone',
      header: 'From/To',
      cell: (comparison) => {
        const msg = comparison.twilioMessage
        const isOutbound = msg.direction.startsWith('outbound')
        return (
          <div className="text-sm">
            <div className="font-medium text-gray-900">
              {isOutbound ? 'To:' : 'From:'} {formatPhoneNumber(isOutbound ? msg.to : msg.from)}
            </div>
            <div className="text-gray-500">
              {isOutbound ? 'From:' : 'To:'} {formatPhoneNumber(isOutbound ? msg.from : msg.to)}
            </div>
          </div>
        )
      }
    },
    {
      key: 'message',
      header: 'Message',
      cell: (comparison) => (
        <div>
          <div className="text-sm text-gray-900 max-w-md truncate" title={comparison.twilioMessage.body}>
            {comparison.twilioMessage.body}
          </div>
          {comparison.dbMessage && comparison.dbMessage.body !== comparison.twilioMessage.body && (
            <Badge variant="warning" size="sm" className="mt-1">
              Body mismatch in database
            </Badge>
          )}
        </div>
      )
    },
    {
      key: 'date',
      header: 'Date Sent',
      cell: (comparison) => {
        const dateSent = comparison.twilioMessage.dateSent || comparison.twilioMessage.dateCreated
        return (
          <span className="text-sm text-gray-500">
            {dateSent.toLocaleString()}
          </span>
        )
      }
    },
    {
      key: 'segments',
      header: 'Segments',
      cell: (comparison) => (
        <span className="text-sm text-gray-500">
          {comparison.twilioMessage.numSegments}
        </span>
      )
    },
    {
      key: 'logged',
      header: 'Logged',
      cell: (comparison) => (
        comparison.isLogged ? (
          <CheckCircleIcon className="h-5 w-5 text-green-500" title="Logged in database" />
        ) : (
          <XCircleIcon className="h-5 w-5 text-red-500" title="Not found in database" />
        )
      )
    }
  ]

  return (
    <Page
      title="Twilio Messages Monitor"
      description="Monitor and compare Twilio messages with database records"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Twilio Messages Monitor' }
      ]}
      actions={
        unloggedCount !== null && unloggedCount > 0 && (
          <Badge variant="warning" size="lg" icon={<ExclamationTriangleIcon className="h-4 w-4" />}>
            {unloggedCount} unlogged messages
          </Badge>
        )
      }
    >
      {/* Filters */}
      <Section title="Filters" className="mb-6">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              />
            </div>

            <div className="flex items-end">
              <Checkbox
                checked={showUnloggedOnly}
                onChange={(e) => setShowUnloggedOnly(e.target.checked)}
                label="Show unlogged only"
              />
            </div>

            <div className="flex items-end">
              <Button
                onClick={loadMessages}
                loading={loading}
                fullWidth
              >
                Refresh
              </Button>
            </div>
          </div>
        </Card>
      </Section>

      {/* Message Comparison Stats */}
      {!showUnloggedOnly && messages.length > 0 && (
        <Section className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Stat label="Total Messages"
              value={messages.length.toString()}
              icon={
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />

            <Stat
              label="Logged in Database"
              value={messages.filter(m => m.isLogged).length.toString()}
              color="success"
              icon={<CheckCircleIcon className="h-8 w-8 text-green-500" />}
            />

            <Stat label="Not Logged"
              value={(unloggedCount || 0).toString()}
              color="warning"
              icon={<ExclamationTriangleIcon className="h-8 w-8 text-amber-500" />}
            />
          </div>
        </Section>
      )}

      {/* Messages Table */}
      <Section 
        title={showUnloggedOnly ? 'Unlogged Messages' : 'All Messages'}
      >
        <Card padding="none">
          {loading ? (
            <div className="p-8 text-center">
              <Spinner size="xl" showLabel label="Loading messages from Twilio..." />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState title="No messages found"
              description="No messages found for the selected date range"
              icon={
                <svg className="h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />
          ) : (
            <DataTable
              data={messages}
              columns={columns}
              getRowKey={(row) => row.twilioMessage.sid}
              stickyHeader
            />
          )}
        </Card>
      </Section>

      {/* Legend */}
      <Section className="mt-6">
        <Alert
          variant="info"
          title="Legend"
          size="sm"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm mt-2">
            <div className="flex items-center space-x-2">
              <CheckCircleIcon className="h-4 w-4 text-green-500" />
              <span>Message logged in database</span>
            </div>
            <div className="flex items-center space-x-2">
              <XCircleIcon className="h-4 w-4 text-red-500" />
              <span>Message not found in database</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-4 w-8 bg-amber-50 border border-amber-200 rounded"></div>
              <span>Unlogged message row</span>
            </div>
          </div>
        </Alert>
      </Section>
    </Page>
  )
}