'use client'

import { useCallback, useRef } from 'react'

import { Avatar, Button, Empty, SearchInput, Select, Spinner } from '@/ds'
import { Icon } from '@/ds/icons'
import { cn } from '@/lib/utils'
import type { ConversationSummary } from '@/app/actions/messagesActions'
import type { CommunicationChannel } from '@/types/communications'

import { channelLabel, formatCustomerName, formatInboxTimestamp, getPreviewText } from './messagesFormat'

export type ChannelFilter = 'all' | Exclude<CommunicationChannel, 'feedback'>

export interface ConversationListProps {
  conversations: ConversationSummary[]
  selectedCustomerId: string | null
  onSelect: (customerId: string) => void
  loading: boolean
  error: string | null
  onRetry: () => void
  searchQuery: string
  onSearchChange: (value: string) => void
  searching: boolean
  searchScope: 'recent' | 'server'
  unreadOnly: boolean
  onUnreadOnlyChange: (value: boolean) => void
  unreadCount: number
  unreadIsCapped: boolean
  channelFilter: ChannelFilter
  onChannelFilterChange: (value: ChannelFilter) => void
  /** Owns the tab stop when focus enters the list. */
  focusedCustomerId: string | null
}

/**
 * `feedback` is deliberately absent. It reaches `customer_communications` as a
 * read-only record of a survey response, it cannot be replied to, and offering
 * it as a filter implied it behaved like the other channels.
 */
const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All channels' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
]

/** "500 unread" is a lie when the query stopped counting at 500. */
export function formatUnreadCount(count: number, capped: boolean): string {
  return capped ? `${count}+` : String(count)
}

function ConversationSkeleton() {
  return (
    <ul className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <li key={index} className="flex items-start gap-3 px-3 py-3">
          <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-surface-hover" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-surface-hover" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ConversationList({
  conversations,
  selectedCustomerId,
  onSelect,
  loading,
  error,
  onRetry,
  searchQuery,
  onSearchChange,
  searching,
  searchScope,
  unreadOnly,
  onUnreadOnlyChange,
  unreadCount,
  unreadIsCapped,
  channelFilter,
  onChannelFilterChange,
  focusedCustomerId,
}: ConversationListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const isFiltered = unreadOnly || channelFilter !== 'all' || searchQuery.trim().length > 0

  // Roving tab stop: one option is reachable by Tab, then Up/Down move between
  // rows. Putting 250 buttons in the tab order is unusable with a keyboard.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    )
    if (options.length === 0) return

    event.preventDefault()
    const currentIndex = options.findIndex((option) => option === document.activeElement)
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? Math.min(options.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1)

    options[nextIndex]?.focus()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-touch-targets>
      {/* Filters. Deliberately two rows, not a tab strip: five tabs with counts
          need ~400px and this column is 300px, so SectionNav silently hid two
          filters behind a scrollbar-less overflow. */}
      <div className="flex-shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search name, phone or email..."
          />
          {searching && (
            <span className="absolute right-9 top-1/2 -translate-y-1/2" aria-hidden="true">
              <Spinner />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className={cn(
              'inline-flex h-[var(--spacing-input-h)] flex-shrink-0 items-center gap-1.5 rounded-pill border px-3 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              unreadOnly
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface text-text-muted hover:bg-surface-hover',
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-pill px-1 text-[10px] leading-none',
                  unreadOnly ? 'bg-white/20 text-primary-fg' : 'bg-info-soft text-info-fg',
                )}
              >
                {formatUnreadCount(unreadCount, unreadIsCapped)}
              </span>
            )}
          </button>
          {/* Select renders its own flex-col wrapper, so the flex sizing has to
              go on an element outside it or the control shrinks to content. */}
          <div className="min-w-0 flex-1">
            <Select
              aria-label="Filter by channel"
              value={channelFilter}
              onChange={(event) => onChannelFilterChange(event.target.value as ChannelFilter)}
              options={CHANNEL_OPTIONS}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          // An outage must never look like an empty queue. Staff have missed
          // inbound work because "No conversations" was shown after a failure.
          <div className="p-6">
            <Empty
              size="sm"
              icon={<Icon name="alertTriangle" size={40} className="text-warning" />}
              title="Could not load conversations"
              description={error}
              action={
                <Button variant="secondary" size="md" onClick={onRetry}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : loading && conversations.length === 0 ? (
          <ConversationSkeleton />
        ) : conversations.length === 0 ? (
          <div className="p-6">
            <Empty
              size="sm"
              title={isFiltered ? 'No matching conversations' : 'No conversations'}
              description={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'Conversations appear here once a customer gets in touch.'
              }
            />
          </div>
        ) : (
          <>
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Conversations"
              onKeyDown={handleKeyDown}
              className="divide-y divide-border"
            >
              {conversations.map((conversation) => {
                const isSelected = conversation.customer.id === selectedCustomerId
                const unread = conversation.unreadCount > 0
                const name = formatCustomerName(conversation.customer)
                const channel = conversation.lastMessage.channel
                const preview = getPreviewText(conversation)
                const when = formatInboxTimestamp(conversation.lastMessageAt)

                return (
                  <li key={conversation.customer.id}>
                    <div
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={conversation.customer.id === focusedCustomerId ? 0 : -1}
                      onClick={() => onSelect(conversation.customer.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelect(conversation.customer.id)
                        }
                      }}
                      /* The accessible name carries what the visual row conveys
                         through weight and colour: who, unread state, when, and
                         whether the customer or we spoke last. */
                      aria-label={`${name}, ${
                        unread ? `${conversation.unreadCount} unread, ` : ''
                      }${when}. ${preview}`}
                      className={cn(
                        'relative flex w-full cursor-pointer items-start gap-3 py-3 pl-3 pr-3 text-left transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                        isSelected
                          ? 'bg-primary-soft before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
                          : 'hover:bg-surface-hover',
                      )}
                    >
                      <Avatar name={name} size="md" className="mt-0.5 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'min-w-0 truncate text-[13px]',
                              unread ? 'font-semibold text-text-strong' : 'font-medium text-text',
                            )}
                          >
                            {name}
                          </span>
                          <span
                            aria-hidden="true"
                            className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-muted"
                          >
                            {when}
                          </span>
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'min-w-0 truncate text-xs',
                              unread ? 'font-medium text-text' : 'text-text-muted',
                            )}
                          >
                            {channel !== 'sms' && (
                              <span className="text-text-subtle">{channelLabel(channel)} · </span>
                            )}
                            {preview}
                          </span>
                          {unread && (
                            <span
                              aria-hidden="true"
                              className="inline-flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-pill bg-info px-1 text-[10px] font-semibold leading-none text-white"
                            >
                              {conversation.unreadCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* The list is a capped page, not the whole history. Saying so stops
                staff concluding a customer does not exist. */}
            <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-text-subtle">
              {searchScope === 'server'
                ? 'Showing customers matching your search, including older conversations.'
                : 'Showing recent conversations. Search by name, phone or email to reach older ones.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
