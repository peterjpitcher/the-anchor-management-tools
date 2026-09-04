'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  Avatar,
  Badge,
  Button,
  CustomerLink,
  Dropdown,
  DropdownItem,
  Empty,
  IconButton,
  Spinner,
  Textarea,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { cn } from '@/lib/utils'
import { toLocalIsoDate } from '@/lib/dateUtils'
import { getReplyEligibility } from '@/lib/messages/replyEligibility'
import type { CustomerCommunication } from '@/types/communications'

import {
  channelLabel,
  describeAttachments,
  describeSmsCost,
  formatCustomerName,
  formatThreadDateHeading,
  getMessageBody,
  getMessageTime,
  getStatusText,
  type ConversationCustomer,
} from './messagesFormat'

const MAX_COMPOSER_HEIGHT = 132
/** Treat the reader as "at the bottom" inside this many pixels. */
const AT_BOTTOM_SLACK = 60

export interface ConversationThreadProps {
  customer: ConversationCustomer | null
  customerId: string | null
  messages: CustomerCommunication[]
  loading: boolean
  error: string | null
  onRetry: () => void
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  unreadCount: number
  canSend: boolean
  canWriteReadState: boolean
  showBack: boolean
  onBack: () => void
  onMarkUnread: () => void
  markingUnread: boolean
  onViewProfile: () => void
  onShowDetails: () => void
  /** Hidden at xl, where the contact rail is already on screen. */
  detailsButtonClassName?: string
  value: string
  onValueChange: (value: string) => void
  onSend: () => void
  sending: boolean
  /** Raised whenever the reader's proximity to the newest message changes. */
  onAtBottomChange?: (atBottom: boolean) => void
}

type MessageRun = {
  key: string
  isOutbound: boolean
  channel: CustomerCommunication['channel']
  messages: CustomerCommunication[]
}

function isFailed(message: CustomerCommunication): boolean {
  return (
    message.direction !== 'inbound' &&
    (message.status === 'failed' || message.status === 'undelivered')
  )
}

/**
 * Groups a day's messages into runs of consecutive same-side, same-channel,
 * same-status messages. Timestamps and delivery status then render once per run
 * instead of once per bubble, which is what made the old thread so noisy.
 *
 * Status is part of the key, not just side and channel. A run only ever shows
 * its last message's status, so mixing a "Sent" and a "Delivered" message into
 * one run silently relabelled the other. A failed message therefore also sits
 * alone: stamping "Not delivered" across a resend that did reach the customer
 * is worse than the bug it replaced, and staff act on that label.
 */
export function buildRuns(messages: CustomerCommunication[]): MessageRun[] {
  const runs: MessageRun[] = []
  for (const message of messages) {
    const isOutbound = message.direction !== 'inbound'
    const last = runs[runs.length - 1]
    const canExtend =
      last !== undefined &&
      last.isOutbound === isOutbound &&
      last.channel === message.channel &&
      last.messages[last.messages.length - 1].status === message.status &&
      !isFailed(message)

    if (canExtend) {
      last.messages.push(message)
    } else {
      runs.push({ key: message.id, isOutbound, channel: message.channel, messages: [message] })
    }
  }
  return runs
}

export function ConversationThread({
  customer,
  customerId,
  messages,
  loading,
  error,
  onRetry,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  unreadCount,
  canSend,
  canWriteReadState,
  showBack,
  onBack,
  onMarkUnread,
  markingUnread,
  onViewProfile,
  onShowDetails,
  detailsButtonClassName,
  value,
  onValueChange,
  onSend,
  sending,
  onAtBottomChange,
}: ConversationThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledRef = useRef(false)
  const isComposingRef = useRef(false)
  const previousCountRef = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [unseenBelow, setUnseenBelow] = useState(0)

  useEffect(() => {
    hasAutoScrolledRef.current = false
    previousCountRef.current = 0
    setUnseenBelow(0)
  }, [customerId])

  // Move focus to the thread when it replaces the list on a phone, so a
  // keyboard or screen-reader user is not left on a row that is now hidden.
  useEffect(() => {
    if (showBack) headingRef.current?.focus()
  }, [showBack, customerId])

  const measureAtBottom = useCallback(() => {
    const container = scrollerRef.current
    if (!container) return
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    const next = distance < AT_BOTTOM_SLACK
    setAtBottom(next)
    if (next) setUnseenBelow(0)
    onAtBottomChange?.(next)
  }, [onAtBottomChange])

  /*
   * Jump to the newest message on open, and follow new arrivals only when the
   * reader is already at the bottom.
   *
   * A zero-height scroller does not count as having scrolled, because below the
   * shell breakpoint this pane is display:none while the list is showing.
   * Scrolling a hidden element does nothing but used to mark the job done, and
   * the thread then opened at the oldest message.
   */
  useEffect(() => {
    const container = scrollerRef.current
    if (!container || messages.length === 0) return
    if (container.clientHeight === 0) {
      hasAutoScrolledRef.current = false
      return
    }

    const added = messages.length - previousCountRef.current
    previousCountRef.current = messages.length

    const distance = container.scrollHeight - container.scrollTop - container.clientHeight

    if (!hasAutoScrolledRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
      hasAutoScrolledRef.current = true
      measureAtBottom()
      return
    }

    if (distance < AT_BOTTOM_SLACK) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      return
    }

    // Reading older messages when something new lands. Do not yank the view;
    // offer a jump instead, or the arrival is simply never noticed.
    if (added > 0) setUnseenBelow((count) => count + added)
  }, [messages, showBack, measureAtBottom])

  const jumpToLatest = useCallback(() => {
    const container = scrollerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    setUnseenBelow(0)
  }, [])

  // Auto-grow the composer up to a cap, then let it scroll.
  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [value])

  /*
   * Ctrl/Cmd+Enter sends; Enter always inserts a newline.
   *
   * The previous rule branched on `matchMedia('(pointer: fine)')`, read once.
   * A hybrid laptop, a tablet with a mouse paired, or a remote session all
   * report a fine pointer while someone types on a touch keyboard, so Enter
   * could fire a half-written reply at a customer. One shortcut on every device
   * has no such edge, and `isComposing` keeps it clear of IME input.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter') return
      if (isComposingRef.current || event.nativeEvent.isComposing) return
      if (!(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      onSend()
    },
    [onSend],
  )

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, CustomerCommunication[]>()
    for (const message of messages) {
      const parsed = new Date(message.created_at)
      // An unparseable timestamp used to reach toLocalIsoDate and produce a
      // group headed "Invalid Date". Park those under a known heading instead.
      const date = Number.isNaN(parsed.getTime()) ? 'unknown' : toLocalIsoDate(parsed)
      const existing = groups.get(date)
      if (existing) existing.push(message)
      else groups.set(date, [message])
    }
    return Array.from(groups.entries())
  }, [messages])

  const smsInfo = useMemo(() => describeSmsCost(value), [value])
  const eligibility = useMemo(() => getReplyEligibility(customer, { canSend }), [customer, canSend])

  if (!customerId || !customer) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Empty
          size="sm"
          title="Select a conversation"
          description="Choose a customer on the left to read and reply to their messages."
        />
      </div>
    )
  }

  const name = formatCustomerName(customer)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-touch-targets>
      {/* ---- Header ---- */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        {showBack && (
          <IconButton
            variant="ghost"
            size="md"
            label="Back to conversations"
            icon={<Icon name="chevronLeft" size={18} />}
            onClick={onBack}
            className="shell:hidden -ml-1 flex-shrink-0"
          />
        )}
        <Avatar name={name} size="md" className="flex-shrink-0" />
        <div ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <CustomerLink
            customerId={customerId}
            name={name}
            className="block truncate text-sm font-semibold"
          />
          <p className="truncate text-xs text-text-muted">
            {unreadCount > 0 ? `${unreadCount} unread` : customer.mobile_number || 'No mobile number'}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Button variant="ghost" size="md" onClick={onShowDetails} className={detailsButtonClassName}>
            Details
          </Button>
          <Dropdown
            align="right"
            trigger={
              <IconButton
                variant="ghost"
                size="md"
                label="Conversation actions"
                icon={<Icon name="moreVertical" size={16} />}
              />
            }
          >
            <DropdownItem onClick={onViewProfile} icon={<Icon name="user" size={14} />}>
              View full profile
            </DropdownItem>
            {canWriteReadState && (
              <DropdownItem onClick={onMarkUnread} icon={<Icon name="mail" size={14} />}>
                {markingUnread ? 'Marking unread...' : 'Mark whole conversation unread'}
              </DropdownItem>
            )}
          </Dropdown>
        </div>
      </div>

      {/* ---- Messages ---- */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={measureAtBottom}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Conversation with ${name}`}
          className="h-full overflow-y-auto bg-surface-2 px-3 py-4 sm:px-4"
        >
          {error ? (
            <div className="flex h-full items-center justify-center">
              <Empty
                size="sm"
                icon={<Icon name="alertTriangle" size={40} className="text-warning" />}
                title="Could not load this conversation"
                description={error}
                action={
                  <Button variant="secondary" size="md" onClick={onRetry}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : loading && messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Empty
                size="sm"
                title="No messages yet"
                description="Send the first message to start this conversation."
              />
            </div>
          ) : (
            <>
              {hasOlder && (
                <div className="mb-3 flex justify-center">
                  <Button variant="secondary" size="sm" onClick={onLoadOlder} loading={loadingOlder}>
                    Load older messages
                  </Button>
                </div>
              )}

              {groupedByDate.map(([date, dateMessages]) => (
                <div key={date} className="pb-2">
                  {/* Not sticky: an opaque pill pinned to the top of the scroller
                      sat over the first bubble of the group and clipped its text. */}
                  <div className="mb-3 flex justify-center">
                    <span className="rounded-pill border border-border bg-surface px-3 py-0.5 text-[11px] font-medium text-text-muted shadow-sm">
                      {date === 'unknown' ? 'Date unknown' : formatThreadDateHeading(date)}
                    </span>
                  </div>

                  {buildRuns(dateMessages).map((run) => {
                    const runFailed = run.messages.some(isFailed)
                    const lastMessage = run.messages[run.messages.length - 1]
                    const statusText = run.isOutbound ? getStatusText(lastMessage.status) : ''
                    // Show the channel once at the start of each non-SMS run;
                    // omit it entirely for SMS, which is nearly every message.
                    const showChannel = run.channel !== 'sms'

                    return (
                      <div
                        key={run.key}
                        className={cn('mb-3 flex flex-col', run.isOutbound ? 'items-end' : 'items-start')}
                      >
                        {showChannel && (
                          <Badge tone="neutral" className="mb-1">
                            {channelLabel(run.channel)}
                          </Badge>
                        )}

                        <div
                          className={cn(
                            'flex w-full flex-col gap-1',
                            run.isOutbound ? 'items-end' : 'items-start',
                          )}
                        >
                          {run.messages.map((message, index) => {
                            const body = getMessageBody(message)
                            const attachments = describeAttachments(message.attachments)
                            const isLastInRun = index === run.messages.length - 1

                            return (
                              <div
                                key={message.id}
                                className={cn(
                                  'max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[78%] xl:max-w-[68%]',
                                  run.isOutbound
                                    ? 'bg-primary text-primary-fg'
                                    : 'border border-border bg-surface text-text',
                                  isLastInRun && (run.isOutbound ? 'rounded-br-sm' : 'rounded-bl-sm'),
                                  isFailed(message) && 'ring-2 ring-danger/50',
                                )}
                              >
                                {/* Direction is otherwise carried only by colour
                                    and alignment, neither of which is announced. */}
                                <span className="sr-only">
                                  {run.isOutbound ? 'You said' : `${name} said`}, at{' '}
                                  {getMessageTime(message.created_at)}:{' '}
                                </span>
                                {body.subject && (
                                  <p className="mb-1 text-[12px] font-semibold">{body.subject}</p>
                                )}
                                {body.text ? (
                                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                                    {body.text}
                                  </p>
                                ) : (
                                  <p
                                    className={cn(
                                      'text-[13px] italic',
                                      run.isOutbound ? 'text-primary-fg/80' : 'text-text-muted',
                                    )}
                                  >
                                    {body.placeholder}
                                  </p>
                                )}
                                {message.has_attachments && (
                                  <ul
                                    className={cn(
                                      'mt-1.5 space-y-0.5 text-[11px]',
                                      run.isOutbound ? 'text-primary-fg/85' : 'text-text-muted',
                                    )}
                                  >
                                    {(attachments.length > 0 ? attachments : ['Attachment']).map(
                                      (filename, attachmentIndex) => (
                                        <li key={attachmentIndex} className="flex items-center gap-1">
                                          <Icon name="file" size={12} />
                                          <span className="break-all">{filename}</span>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5">
                          <span aria-hidden="true" className="text-[11px] text-text-muted">
                            {getMessageTime(lastMessage.created_at)}
                          </span>
                          {runFailed ? (
                            <Badge tone="danger">Not delivered</Badge>
                          ) : (
                            statusText && <span className="text-[11px] text-text-muted">{statusText}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Something arrived while the reader was scrolled up. Yanking the view
            is hostile, and saying nothing means the arrival is missed. */}
        {!atBottom && unseenBelow > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              variant="primary"
              size="sm"
              className="pointer-events-auto shadow-lg"
              onClick={jumpToLatest}
              icon={<Icon name="arrowDown" size={14} />}
            >
              {unseenBelow} new message{unseenBelow === 1 ? '' : 's'}
            </Button>
          </div>
        )}
      </div>

      {/* ---- Composer ---- */}
      {eligibility.canReply ? (
        <div className="flex-shrink-0 border-t border-border p-3">
          <div className="flex items-end gap-2">
            {/* Textarea renders its own flex-col wrapper, so the flex sizing has
                to live outside it or the input shrinks to its default width. */}
            <div className="min-w-0 flex-1">
              <Textarea
                ref={composerRef}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false
                }}
                aria-label={`Reply by SMS to ${eligibility.destination}`}
                /* The number lives in the helper line below, not here: at 375px
                   a placeholder carrying it wrapped and was clipped by the
                   single-row composer. */
                placeholder="Reply by SMS..."
                rows={1}
                className="max-h-[132px] min-h-[var(--spacing-input-h)] resize-none py-2 leading-snug"
                disabled={sending}
              />
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={onSend}
              loading={sending}
              disabled={!value.trim() || sending}
              icon={<Icon name="message" size={16} />}
            >
              Send
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            {value.length > 0 ? (
              <>
                <span>{smsInfo.chars} characters</span>
                <span className={cn(smsInfo.segments >= 3 && 'font-medium text-warning-fg')}>
                  {smsInfo.segments} SMS segment{smsInfo.segments === 1 ? '' : 's'}
                </span>
                {smsInfo.isUnicode && <Badge tone="warning">Unicode</Badge>}
              </>
            ) : (
              // Say what this composer actually does, and to which number. The
              // thread can show email and WhatsApp, but the only reply
              // transport is SMS.
              <span>Replies send by SMS to {eligibility.destination}</span>
            )}
            <span className="ml-auto text-text-subtle">Ctrl+Enter to send</span>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'flex-shrink-0 border-t border-border px-4 py-3',
            eligibility.reason === 'opted_out' ? 'bg-danger-soft' : 'bg-warning-soft',
          )}
        >
          <p
            className={cn(
              'text-xs font-semibold',
              eligibility.reason === 'opted_out' ? 'text-danger-fg' : 'text-warning-fg',
            )}
          >
            {eligibility.title}
          </p>
          <p
            className={cn(
              'mt-0.5 text-xs',
              eligibility.reason === 'opted_out' ? 'text-danger-fg' : 'text-warning-fg',
            )}
          >
            {eligibility.detail}
          </p>
          {eligibility.reason !== 'no_permission' && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={onViewProfile}>
              Open customer profile
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
