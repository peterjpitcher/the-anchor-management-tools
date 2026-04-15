'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { fetchBulkRecipients, sendBulkMessages } from '@/app/actions/bulk-messages'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'
import type { BulkRecipientFilters, BulkRecipient } from '@/types/bulk-messages'
import type { EventCategory } from '@/types/event-categories'

// --- Constants ---

const DEBOUNCE_MS = 300
const SMS_SEGMENT_LENGTH = 160
const SMS_SEGMENT_LENGTH_UNICODE = 70

interface EventOption {
  id: string
  name: string
  date: string
}

interface BulkMessagesClientProps {
  events: EventOption[]
  categories: EventCategory[]
}

// --- Helpers ---

function countSmsSegments(text: string): { chars: number; segments: number; isUnicode: boolean } {
  const chars = text.length
  if (chars === 0) return { chars: 0, segments: 0, isUnicode: false }
  // Check for non-GSM characters (simplified unicode check)
  const isUnicode = /[^\x00-\x7F\u00A0\u00A3\u00A4\u00A5\u00A7\u00BF\u00C4-\u00C6\u00C9\u00D1\u00D6\u00D8\u00DC\u00DF\u00E0\u00E4-\u00E9\u00EC\u00F1\u00F2\u00F6\u00F8\u00F9\u00FC]/.test(text)
  const limit = isUnicode ? SMS_SEGMENT_LENGTH_UNICODE : SMS_SEGMENT_LENGTH
  const segments = Math.ceil(chars / limit)
  return { chars, segments, isUnicode }
}

function applyPersonalisation(template: string, recipient: BulkRecipient): string {
  return template
    .replace(/\{\{first_name\}\}/g, recipient.first_name)
    .replace(/\{\{last_name\}\}/g, recipient.last_name)
}

// --- Component ---

export default function BulkMessagesClient({ events, categories }: BulkMessagesClientProps) {
  // Filter state
  const [eventId, setEventId] = useState('')
  const [bookingStatus, setBookingStatus] = useState('')
  const [smsOptIn, setSmsOptIn] = useState<'opted_in' | 'all'>('opted_in')
  const [categoryId, setCategoryId] = useState('')
  const [createdAfter, setCreatedAfter] = useState('')
  const [createdBefore, setCreatedBefore] = useState('')
  const [search, setSearch] = useState('')

  // Recipients state
  const [recipients, setRecipients] = useState<BulkRecipient[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Compose state
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Send state
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Request cancellation via counter
  const requestCounterRef = useRef(0)

  // Debounce timer
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Quiet hours check
  const quietHoursEval = useMemo(() => evaluateSmsQuietHours(), [])

  // Build filters object
  const buildFilters = useCallback((): BulkRecipientFilters => {
    return {
      eventId: eventId || undefined,
      bookingStatus: (bookingStatus as 'with_bookings' | 'without_bookings') || undefined,
      smsOptIn,
      categoryId: categoryId || undefined,
      createdAfter: createdAfter || undefined,
      createdBefore: createdBefore || undefined,
      search: search.trim() || undefined,
    }
  }, [eventId, bookingStatus, smsOptIn, categoryId, createdAfter, createdBefore, search])

  // Fetch recipients
  const loadRecipients = useCallback(async () => {
    const currentRequest = ++requestCounterRef.current
    setLoading(true)
    setError(null)
    setSelectedKeys(new Set())

    const filters = buildFilters()
    const result = await fetchBulkRecipients(filters)

    // Only update state if this is still the latest request
    if (currentRequest !== requestCounterRef.current) return

    if ('error' in result) {
      setError(result.error)
      setRecipients([])
    } else {
      setRecipients(result.data)
    }
    setLoading(false)
  }, [buildFilters])

  // Debounced fetch on filter changes
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      loadRecipients()
    }, DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [loadRecipients])

  // Insert personalisation variable at cursor
  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setMessage((prev) => prev + variable)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = message.slice(0, start)
    const after = message.slice(end)
    const newMessage = before + variable + after
    setMessage(newMessage)
    // Restore cursor position after variable
    requestAnimationFrame(() => {
      textarea.focus()
      const newPos = start + variable.length
      textarea.setSelectionRange(newPos, newPos)
    })
  }

  // Handle send
  const handleSend = async () => {
    const selectedIds = Array.from(selectedKeys) as string[]
    const trimmedMessage = message.trim()
    if (selectedIds.length === 0 || !trimmedMessage) return

    setSending(true)
    setShowConfirm(false)

    const result = await sendBulkMessages(
      selectedIds,
      trimmedMessage,
      eventId || undefined,
      categoryId || undefined
    )

    setSending(false)

    if (!result.success) {
      toast.error(result.error || 'Failed to send messages')
      return
    }

    if (result.queued) {
      toast.info(`${result.sent} messages queued for delivery`)
    } else {
      toast.success(`${result.sent} messages sent successfully`)
    }

    // Reset compose state
    setMessage('')
    setSelectedKeys(new Set())
  }

  // SMS segment info
  const smsInfo = countSmsSegments(message)

  // Columns
  const columns: Column<BulkRecipient>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (row) => (
          <span className="font-medium text-gray-900">
            {row.first_name} {row.last_name}
          </span>
        ),
        sortable: true,
        sortFn: (a, b) => {
          const aName = `${a.first_name} ${a.last_name}`.toLowerCase()
          const bName = `${b.first_name} ${b.last_name}`.toLowerCase()
          return aName.localeCompare(bName)
        },
      },
      {
        key: 'mobile_number',
        header: 'Mobile',
        cell: (row) => (
          <span className="text-gray-600 text-sm">{row.mobile_number}</span>
        ),
        hideOnMobile: true,
      },
      {
        key: 'last_booking_date',
        header: 'Last Booking',
        cell: (row) =>
          row.last_booking_date ? (
            <span className="text-gray-600 text-sm">
              {formatDateInLondon(row.last_booking_date, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          ) : (
            <span className="text-gray-400 text-sm">Never</span>
          ),
        sortable: true,
        sortFn: (a, b) => {
          if (!a.last_booking_date && !b.last_booking_date) return 0
          if (!a.last_booking_date) return 1
          if (!b.last_booking_date) return -1
          return a.last_booking_date.localeCompare(b.last_booking_date)
        },
      },
    ],
    []
  )

  // Preview message with first selected recipient
  const previewRecipient = useMemo(() => {
    if (selectedKeys.size === 0) return null
    const firstKey = selectedKeys.values().next().value
    return recipients.find((r) => r.id === firstKey) || null
  }, [selectedKeys, recipients])

  const previewMessage = previewRecipient
    ? applyPersonalisation(message, previewRecipient)
    : message

  const trimmedMessage = message.trim()
  const canSend = selectedKeys.size > 0 && trimmedMessage.length > 0 && !sending

  return (
    <PageLayout
      title="Bulk Messages"
      subtitle="Send SMS messages to multiple customers"
      breadcrumbs={[
        { label: 'Messages', href: '/messages' },
        { label: 'Bulk Messages' },
      ]}
    >
      <div className="space-y-6">
        {/* Quiet hours warning */}
        {quietHoursEval.inQuietHours && (
          <Alert variant="warning" title="SMS Quiet Hours Active">
            Messages sent now will be queued and delivered after{' '}
            {formatDateInLondon(quietHoursEval.nextAllowedSendAt, {
              hour: 'numeric',
              minute: 'numeric',
              timeZoneName: 'short',
            })}
            . Quiet hours are 9 PM to 9 AM London time.
          </Alert>
        )}

        {/* Filter Panel */}
        <Card
          header={
            <div className="flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-gray-500" />
              <h3 className="text-lg font-medium text-gray-900">Filters</h3>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Event filter */}
            <div>
              <label htmlFor="filter-event" className="block text-sm font-medium text-gray-700 mb-1">
                Event
              </label>
              <Select
                id="filter-event"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="All events"
              >
                <option value="">All events</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} ({formatDateInLondon(event.date, { day: 'numeric', month: 'short', year: 'numeric' })})
                  </option>
                ))}
              </Select>
            </div>

            {/* Booking status filter */}
            <div>
              <label htmlFor="filter-booking-status" className="block text-sm font-medium text-gray-700 mb-1">
                Booking Status
              </label>
              <Select
                id="filter-booking-status"
                value={bookingStatus}
                onChange={(e) => setBookingStatus(e.target.value)}
                placeholder="Any status"
              >
                <option value="">Any status</option>
                <option value="with_bookings">With bookings</option>
                <option value="without_bookings">Without bookings</option>
              </Select>
            </div>

            {/* SMS Opt-in filter */}
            <div>
              <label htmlFor="filter-sms-optin" className="block text-sm font-medium text-gray-700 mb-1">
                SMS Opt-in
              </label>
              <Select
                id="filter-sms-optin"
                value={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.value as 'opted_in' | 'all')}
              >
                <option value="opted_in">Opted in only</option>
                <option value="all">All customers</option>
              </Select>
            </div>

            {/* Category filter */}
            <div>
              <label htmlFor="filter-category" className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <Select
                id="filter-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="All categories"
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Date range filters */}
            <div>
              <label htmlFor="filter-created-after" className="block text-sm font-medium text-gray-700 mb-1">
                Created After
              </label>
              <Input
                id="filter-created-after"
                type="date"
                value={createdAfter}
                onChange={(e) => setCreatedAfter(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="filter-created-before" className="block text-sm font-medium text-gray-700 mb-1">
                Created Before
              </label>
              <Input
                id="filter-created-before"
                type="date"
                value={createdBefore}
                onChange={(e) => setCreatedBefore(e.target.value)}
              />
            </div>
          </div>

          {/* Search */}
          <div className="mt-4">
            <label htmlFor="filter-search" className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <Input
              id="filter-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or mobile number..."
              leftIcon={<MagnifyingGlassIcon />}
            />
          </div>
        </Card>

        {/* Recipients List */}
        <Card
          header={
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium text-gray-900">Recipients</h3>
                <Badge variant="info" size="sm">
                  {loading ? '...' : recipients.length}
                </Badge>
              </div>
              {selectedKeys.size > 0 && (
                <Badge variant="success" size="sm">
                  {selectedKeys.size} selected
                </Badge>
              )}
            </div>
          }
        >
          {error && (
            <Alert variant="error" title="Error loading recipients" description={error} className="mb-4" />
          )}

          <DataTable<BulkRecipient>
            data={recipients}
            columns={columns}
            getRowKey={(row) => row.id}
            loading={loading}
            selectable
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            emptyMessage="No recipients found"
            emptyDescription="Try adjusting your filters to find customers."
            size="sm"
          />
        </Card>

        {/* Compose Panel */}
        <Card
          header={
            <div className="flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="h-5 w-5 text-gray-500" />
              <h3 className="text-lg font-medium text-gray-900">Compose Message</h3>
            </div>
          }
        >
          {/* Personalisation variables */}
          <div className="mb-3">
            <span className="text-sm text-gray-500 mr-2">Insert variable:</span>
            <div className="inline-flex gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => insertVariable('{{first_name}}')}
              >
                {'{{first_name}}'}
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => insertVariable('{{last_name}}')}
              >
                {'{{last_name}}'}
              </Button>
            </div>
          </div>

          {/* Message textarea */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here..."
            rows={4}
            autoResize
            minRows={3}
            maxRows={8}
          />

          {/* Character / segment counter */}
          <div className="mt-2 flex items-center justify-between text-sm text-gray-500">
            <div className="flex items-center gap-3">
              <span>
                {smsInfo.chars} characters
              </span>
              <span>
                {smsInfo.segments} SMS segment{smsInfo.segments !== 1 ? 's' : ''}
              </span>
              {smsInfo.isUnicode && (
                <Badge variant="warning" size="sm">
                  Unicode
                </Badge>
              )}
            </div>
          </div>

          {/* Preview */}
          {trimmedMessage && previewRecipient && (
            <div className="mt-4 rounded-md bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs font-medium text-gray-500 mb-1">
                Preview (for {previewRecipient.first_name} {previewRecipient.last_name}):
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{previewMessage}</p>
            </div>
          )}

          {/* Send controls */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {selectedKeys.size > 0
                ? `${selectedKeys.size} recipient${selectedKeys.size !== 1 ? 's' : ''} selected`
                : 'Select recipients above to send'}
            </div>
            <Button
              variant="primary"
              leftIcon={<PaperAirplaneIcon />}
              onClick={() => setShowConfirm(true)}
              disabled={!canSend}
              loading={sending}
            >
              {sending
                ? 'Sending...'
                : `Send to ${selectedKeys.size} recipient${selectedKeys.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </Card>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleSend}
        title="Send Bulk SMS"
        message={
          <>
            Are you sure you want to send this message to{' '}
            <strong>{selectedKeys.size}</strong> recipient
            {selectedKeys.size !== 1 ? 's' : ''}?
            {quietHoursEval.inQuietHours && (
              <span className="block mt-2 text-yellow-600">
                Note: Messages will be queued until quiet hours end.
              </span>
            )}
          </>
        }
        type="info"
        confirmText="Send Messages"
        loadingText="Sending..."
      />
    </PageLayout>
  )
}
