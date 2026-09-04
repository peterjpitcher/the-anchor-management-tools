'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Drawer,
  Dropdown,
  DropdownItem,
  PageHeader,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import { interpretSendResult } from '@/lib/messages/sendOutcome'

import {
  getConversationMessages,
  getMessages,
  markAllMessagesAsRead,
  markConversationAsRead,
  markConversationAsUnread,
  searchConversations,
  type ConversationSummary,
} from '@/app/actions/messagesActions'
import { sendSmsReply } from '@/app/actions/messageActions'
import type { CustomerCommunication } from '@/types/communications'

import { ContactPanel } from './ContactPanel'
import { ConversationList, formatUnreadCount, type ChannelFilter } from './ConversationList'
import { ConversationThread } from './ConversationThread'

// Each tick re-reads the conversation list plus the open thread's newest page.
// At 15s a single tab left open all shift was hammering the inbox queries for no
// benefit: staff act on messages in minutes, not seconds.
const REFRESH_INTERVAL = 30000
/** Backoff ceiling after repeated failures, so an outage is not amplified. */
const MAX_REFRESH_INTERVAL = 300000
const SEARCH_DEBOUNCE_MS = 350
const SEARCH_MIN_LENGTH = 2
/** Matches --breakpoint-shell in globals.css, where the app chrome swaps over. */
const WIDE_LAYOUT_QUERY = '(min-width: 821px)'

const QUERY_PARAM = 'customer'

export function MessagesClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()

  const canSendMessages =
    hasPermission('messages', 'send_transactional') || hasPermission('messages', 'manage')
  // Read state is shared team state, and the server gates writes on the same
  // pair. Showing these controls to a view-only user only produced a failure
  // toast, including on every conversation they opened.
  const canWriteReadState = canSendMessages
  const canManageTemplates = hasPermission('messages', 'manage_templates')
  // The destination page requires send_marketing, so gating the link on
  // anything else sent people to /unauthorized.
  const canSendBulk = hasPermission('messages', 'send_marketing')

  /* ---- Layout ---- */

  // Selection lives in the URL, so a thread can be linked, survives a refresh,
  // and the device Back button returns to the list on a phone instead of
  // leaving the page entirely.
  const selectedCustomerId = searchParams.get(QUERY_PARAM)
  const [isWideLayout, setIsWideLayout] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(WIDE_LAYOUT_QUERY)
    const apply = () => setIsWideLayout(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  // On one pane the thread only exists once the user has chosen a row. That is
  // what makes "opened" different from "selected", and it is why a conversation
  // is no longer marked read while the reader is still looking at the list.
  const threadIsVisible = isWideLayout || Boolean(selectedCustomerId)

  const setSelectedCustomerId = useCallback(
    (customerId: string | null, options: { replace?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString())
      if (customerId) params.set(QUERY_PARAM, customerId)
      else params.delete(QUERY_PARAM)
      const query = params.toString()
      const url = query ? `${pathname}?${query}` : pathname
      // Auto-selection replaces, so it never fills the history with rows the
      // user did not choose. A tap pushes, so Back closes the thread.
      if (options.replace) router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  /* ---- List state ---- */

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [totalUnreadCount, setTotalUnreadCount] = useState(0)
  const [unreadIsCapped, setUnreadIsCapped] = useState(false)
  const [hasMoreUnread, setHasMoreUnread] = useState(false)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ConversationSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [confirmMarkAllOpen, setConfirmMarkAllOpen] = useState(false)

  /* ---- Thread state ---- */

  const [messages, setMessages] = useState<CustomerCommunication[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<ConversationSummary['customer'] | null>(null)
  const [markingUnread, setMarkingUnread] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  /* ---- Composer state ---- */

  // Keyed by customer so switching conversations, or stepping back to the list
  // and returning, no longer throws away a half-typed reply.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const draft = selectedCustomerId ? (drafts[selectedCustomerId] ?? '') : ''

  const setDraft = useCallback(
    (value: string) => {
      if (!selectedCustomerId) return
      setDrafts((previous) => ({ ...previous, [selectedCustomerId]: value }))
    },
    [selectedCustomerId],
  )

  /* ---- Refs ---- */

  // A monotonic id per thread request. Only the newest request may write to the
  // thread, so a slow response for customer A can no longer land under customer
  // B and put one customer's history under another's name.
  const threadRequestRef = useRef(0)
  const listRequestRef = useRef(0)
  const listInFlightRef = useRef(false)
  const failureCountRef = useRef(0)
  const markedReadRef = useRef<string | null>(null)
  const atBottomRef = useRef(true)
  // Read inside async callbacks that must not close over a stale selection.
  const selectedCustomerIdRef = useRef<string | null>(selectedCustomerId)

  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId
  }, [selectedCustomerId])

  /* ---- Data loading ---- */

  const loadConversations = useCallback(async (options: { withLoader?: boolean } = {}) => {
    const { withLoader = false } = options
    // Never let a slow tick stack up behind the previous one.
    if (listInFlightRef.current) return
    listInFlightRef.current = true
    const requestId = ++listRequestRef.current
    if (withLoader) setListLoading(true)

    try {
      const response = await getMessages()
      if (requestId !== listRequestRef.current) return

      if ('error' in response) {
        failureCountRef.current += 1
        setListError(response.error)
        return
      }

      failureCountRef.current = 0
      setListError(null)
      setConversations(response.conversations)
      setTotalUnreadCount(response.totalUnread)
      setUnreadIsCapped(response.unreadIsCapped)
      setHasMoreUnread(response.hasMoreUnread)
      setUnmatchedCount(response.unmatchedCount)
    } catch {
      if (requestId !== listRequestRef.current) return
      failureCountRef.current += 1
      setListError('Could not reach the server. Check your connection and try again.')
    } finally {
      listInFlightRef.current = false
      if (withLoader) setListLoading(false)
    }
  }, [])

  const loadThread = useCallback(async (customerId: string, options: { withLoader?: boolean } = {}) => {
    const { withLoader = true } = options
    const requestId = ++threadRequestRef.current
    if (withLoader) setMessagesLoading(true)

    try {
      const response = await getConversationMessages(customerId)
      // Two guards, not one: the sequence catches an out-of-order response for
      // the same customer, and the id catches a response for a customer who is
      // no longer selected at all.
      if (requestId !== threadRequestRef.current) return
      if (customerId !== selectedCustomerIdRef.current) return

      if ('error' in response) {
        setThreadError(response.error)
        return
      }

      setThreadError(null)
      setMessages(response.messages)
      setHasOlder(response.hasOlder)
      setSelectedCustomer(response.customer)
    } catch {
      if (requestId !== threadRequestRef.current) return
      if (customerId !== selectedCustomerIdRef.current) return
      setThreadError('Could not load this conversation.')
    } finally {
      if (requestId === threadRequestRef.current && withLoader) setMessagesLoading(false)
    }
  }, [])

  /* ---- Effects ---- */

  useEffect(() => {
    void loadConversations({ withLoader: true })
  }, [loadConversations])

  /*
   * Polling, with three guards the previous timer had none of: a hidden tab
   * does not poll at all, a slow request is never overlapped by the next tick,
   * and repeated failures back off instead of hammering an outage.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const schedule = () => {
      if (cancelled) return
      const backoff = Math.min(
        REFRESH_INTERVAL * 2 ** Math.min(failureCountRef.current, 4),
        MAX_REFRESH_INTERVAL,
      )
      timer = setTimeout(() => void run(), backoff)
    }

    const run = async () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') {
        schedule()
        return
      }
      await loadConversations()
      const currentId = selectedCustomerIdRef.current
      if (currentId && threadIsVisible) {
        await loadThread(currentId, { withLoader: false })
      }
      schedule()
    }

    const onVisibilityChange = () => {
      // Catch up immediately when the tab comes back, rather than waiting out
      // a timer that ticked past while it was hidden.
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer)
        void run()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadConversations, loadThread, threadIsVisible])

  /*
   * Auto-select the first conversation on the wide layouts only.
   *
   * On one pane this used to select the first unread conversation and the
   * selection effect immediately marked it read, while the user was still
   * looking at the list and had seen nothing. Unread work disappeared without
   * anyone reading it.
   */
  useEffect(() => {
    if (!isWideLayout) return
    if (conversations.length === 0) return
    if (selectedCustomerId && conversations.some((c) => c.customer.id === selectedCustomerId)) return
    if (selectedCustomerId && searchResults) return

    const firstUnread = conversations.find((c) => c.unreadCount > 0)
    const next = firstUnread?.customer.id ?? conversations[0]?.customer.id ?? null
    if (next && next !== selectedCustomerId) setSelectedCustomerId(next, { replace: true })
  }, [conversations, isWideLayout, searchResults, selectedCustomerId, setSelectedCustomerId])

  // Clear the thread the moment the selection changes, so the previous
  // customer's messages are never on screen under a new customer's name.
  useEffect(() => {
    threadRequestRef.current += 1
    markedReadRef.current = null
    setMessages([])
    setSelectedCustomer(null)
    setThreadError(null)
    setHasOlder(false)
    setDetailsOpen(false)

    if (!selectedCustomerId) {
      setMessagesLoading(false)
      return
    }
    void loadThread(selectedCustomerId)
  }, [selectedCustomerId, loadThread])

  /*
   * Mark read only once the thread is genuinely on screen and its messages have
   * loaded, and only for a user whose role may write read state.
   */
  useEffect(() => {
    if (!selectedCustomerId || !threadIsVisible || !canWriteReadState) return
    if (messagesLoading || threadError || !selectedCustomer) return
    if (markedReadRef.current === selectedCustomerId) return

    markedReadRef.current = selectedCustomerId
    const conversation = conversations.find((c) => c.customer.id === selectedCustomerId)
    const previousUnread = conversation?.unreadCount ?? 0
    if (previousUnread === 0) return

    setConversations((previous) =>
      previous.map((c) => (c.customer.id === selectedCustomerId ? { ...c, unreadCount: 0 } : c)),
    )
    setTotalUnreadCount((previous) => Math.max(0, previous - previousUnread))

    void markConversationAsRead(selectedCustomerId).catch(() => {
      markedReadRef.current = null
      setConversations((previous) =>
        previous.map((c) =>
          c.customer.id === selectedCustomerId ? { ...c, unreadCount: previousUnread } : c,
        ),
      )
      setTotalUnreadCount((previous) => previous + previousUnread)
      toast.error('Could not mark this conversation as read')
    })
  }, [
    canWriteReadState,
    conversations,
    messagesLoading,
    selectedCustomer,
    selectedCustomerId,
    threadError,
    threadIsVisible,
  ])

  /* ---- Server-side search ---- */

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < SEARCH_MIN_LENGTH) {
      setSearchResults(null)
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const response = await searchConversations(query)
      if (cancelled) return
      setSearching(false)
      if ('error' in response) {
        toast.error(response.error)
        return
      }
      setSearchResults(response.conversations)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery])

  /* ---- Derived ---- */

  /*
   * Filters intersect: a row must satisfy Unread AND channel AND search.
   * Channel matches any channel the conversation has ever used, not just its
   * latest message, because that is what the WhatsApp filter has to mean for a
   * customer whose most recent message happened to be an SMS.
   */
  const displayedConversations = useMemo(() => {
    const source = searchResults ?? conversations
    let filtered = source

    if (unreadOnly) {
      const unread = source.filter((c) => c.unreadCount > 0)
      // Keep the open conversation visible after opening it clears its unread
      // count, otherwise the row vanishes from under the reader.
      if (selectedCustomerId && !unread.some((c) => c.customer.id === selectedCustomerId)) {
        const selected = source.find((c) => c.customer.id === selectedCustomerId)
        filtered = selected ? [selected, ...unread] : unread
      } else {
        filtered = unread
      }
    }

    if (channelFilter !== 'all') {
      filtered = filtered.filter((c) => c.channels.includes(channelFilter))
    }

    return filtered
  }, [conversations, searchResults, unreadOnly, channelFilter, selectedCustomerId])

  const selectedConversation = selectedCustomerId
    ? (searchResults ?? conversations).find((c) => c.customer.id === selectedCustomerId)
    : undefined

  /* ---- Actions ---- */

  const handleRetryList = useCallback(() => {
    failureCountRef.current = 0
    void loadConversations({ withLoader: true })
  }, [loadConversations])

  const handleRetryThread = useCallback(() => {
    if (selectedCustomerId) void loadThread(selectedCustomerId)
  }, [loadThread, selectedCustomerId])

  const handleLoadOlder = useCallback(async () => {
    if (!selectedCustomerId || messages.length === 0) return
    setLoadingOlder(true)
    const oldest = messages[0]?.created_at
    try {
      const response = await getConversationMessages(selectedCustomerId, { before: oldest })
      if (selectedCustomerId !== selectedCustomerIdRef.current) return
      if ('error' in response) {
        toast.error(response.error)
        return
      }
      setMessages((previous) => [...response.messages, ...previous])
      setHasOlder(response.hasOlder)
    } catch {
      toast.error('Could not load older messages')
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, selectedCustomerId])

  const handleMarkAllAsRead = useCallback(async () => {
    setConfirmMarkAllOpen(false)
    setMarkingAll(true)
    try {
      await markAllMessagesAsRead()
      toast.success('All conversations marked as read')
      await loadConversations({ withLoader: true })
    } catch {
      toast.error('Failed to mark all messages as read')
    } finally {
      setMarkingAll(false)
    }
  }, [loadConversations])

  const handleMarkUnread = useCallback(async () => {
    if (!selectedCustomerId) return
    setMarkingUnread(true)
    try {
      await markConversationAsUnread(selectedCustomerId)
      // No optimistic "1". This restores every previously read inbound message
      // in the conversation, so the honest number can only come from a reload.
      markedReadRef.current = null
      toast.success('Conversation marked unread')
      await loadConversations()
    } catch {
      toast.error('Failed to mark conversation as unread')
    } finally {
      setMarkingUnread(false)
    }
  }, [loadConversations, selectedCustomerId])

  const handleSend = useCallback(async () => {
    const body = draft.trim()
    if (!body || sending || !selectedCustomerId) return
    setSending(true)
    const customerId = selectedCustomerId
    try {
      const result = await sendSmsReply(customerId, body)
      const outcome = interpretSendResult(result)

      if (outcome.tone === 'success') toast.success(outcome.message)
      else if (outcome.tone === 'warning') toast.warning(outcome.message)
      else toast.error(outcome.message)

      if (outcome.clearsDraft) {
        setDrafts((previous) => ({ ...previous, [customerId]: '' }))
        atBottomRef.current = true
        await loadThread(customerId, { withLoader: false })
        await loadConversations()
      }
    } catch {
      // The draft is deliberately kept: retyping a reply because the network
      // blipped is the fastest way to lose one.
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }, [draft, loadConversations, loadThread, selectedCustomerId, sending])

  const handleSelectConversation = useCallback(
    (customerId: string) => setSelectedCustomerId(customerId),
    [setSelectedCustomerId],
  )

  const handleBack = useCallback(() => setSelectedCustomerId(null), [setSelectedCustomerId])

  const handleViewProfile = useCallback(() => {
    if (selectedCustomerId) router.push(`/customers/${selectedCustomerId}`)
  }, [router, selectedCustomerId])

  /* ---- Render ---- */

  const unreadLabel = formatUnreadCount(totalUnreadCount, unreadIsCapped)

  const overflowActions = (
    <Dropdown
      align="right"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="moreVertical" size={16} />}
          aria-label="More inbox actions"
        />
      }
    >
      {/* Below the shell breakpoint the header row has no room for a third
          button beside the title, so the holding queue moves into the menu. */}
      {unmatchedCount > 0 && (
        <div className="shell:hidden">
          <DropdownItem
            onClick={() => router.push('/messages/holding')}
            icon={<Icon name="alertCircle" size={14} />}
          >
            Holding queue ({unmatchedCount})
          </DropdownItem>
        </div>
      )}
      <DropdownItem onClick={handleRetryList} icon={<Icon name="refresh" size={14} />}>
        Refresh
      </DropdownItem>
      {canWriteReadState && totalUnreadCount > 0 && (
        <DropdownItem onClick={() => setConfirmMarkAllOpen(true)} icon={<Icon name="check" size={14} />}>
          {markingAll ? 'Marking all read...' : 'Mark all read'}
        </DropdownItem>
      )}
      {canManageTemplates && (
        <DropdownItem
          onClick={() => router.push('/settings/message-templates')}
          icon={<Icon name="file" size={14} />}
        >
          Message templates
        </DropdownItem>
      )}
    </Dropdown>
  )

  return (
    /*
     * Height model. Below the shell breakpoint `<main>` is `flex-1` inside a
     * `h-[100dvh]` shell, so its height is already definite and `h-full` is
     * exact. At and above it there is no topbar and `<main>` is content-sized,
     * so the page subtracts the shell's own vertical padding, which now lives
     * in `--spacing-page-shell-pad-y` beside the other layout tokens rather
     * than being copied into this file.
     *
     * `100dvh`, never `100vh`: vh is the large viewport, so it over-measures by
     * roughly 100px whenever mobile browser chrome is showing. That is what
     * pushed the composer below the fold before.
     *
     * PageHeader is a shrink-0 row and the inbox takes the rest, so the number
     * of action buttons can no longer change how tall the inbox is.
     *
     * The inbox keeps a 360px floor and the page scrolls rather than clipping.
     * At 200% zoom on a short window there is barely any room left after the
     * chrome, and without the floor the whole inbox compressed to a header row.
     */
    <div className="flex h-full flex-col overflow-y-auto shell:h-[calc(100dvh-var(--spacing-page-shell-pad-y))]">
      <PageHeader
        className="flex-shrink-0 mb-3 pb-3"
        breadcrumbs={[{ label: 'Messages' }]}
        title="Messages"
        subtitle={
          totalUnreadCount > 0
            ? `${unreadLabel} unread message${totalUnreadCount === 1 && !unreadIsCapped ? '' : 's'}`
            : 'All caught up'
        }
        actions={
          <div className="flex items-center gap-2">
            {canSendBulk && (
              <Button variant="primary" size="sm" onClick={() => router.push('/messages/bulk')}>
                Bulk message
              </Button>
            )}
            {unmatchedCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="hidden shell:inline-flex"
                onClick={() => router.push('/messages/holding')}
              >
                Holding queue ({unmatchedCount})
              </Button>
            )}
            {overflowActions}
          </div>
        }
      />

      {hasMoreUnread && (
        <Alert tone="warning" className="mb-3 flex-shrink-0">
          There are more than {totalUnreadCount} unread messages, so the count above is a lower bound.
          Search for a customer, or open their profile, to reach older unread messages.
        </Alert>
      )}

      <Card className="flex min-h-[360px] flex-1 flex-col overflow-hidden">
        <CardBody className="flex min-h-0 flex-1 flex-col p-0">
          {/*
            One pane below 821px, two from 821px, three from 1280px. The split
            moves with the shell breakpoint so iPad portrait gets a real
            two-column inbox, and the contact rail only appears once there is
            enough width left for a usable thread beside it.

            These classes deliberately avoid the substring `lg:grid-cols`, which
            globals.css rewrites to `1fr !important` below 821px. `min-w-0` on
            each column is what actually stops a track being widened by its own
            content.
          */}
          <div className="grid min-h-0 flex-1 grid-cols-1 shell:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
            <div
              className={`${selectedCustomerId ? 'hidden shell:flex' : 'flex'} min-h-0 min-w-0 flex-col border-r border-border`}
            >
              <ConversationList
                conversations={displayedConversations}
                selectedCustomerId={selectedCustomerId}
                onSelect={handleSelectConversation}
                loading={listLoading}
                error={listError}
                onRetry={handleRetryList}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searching={searching}
                searchScope={searchResults ? 'server' : 'recent'}
                unreadOnly={unreadOnly}
                onUnreadOnlyChange={setUnreadOnly}
                unreadCount={totalUnreadCount}
                unreadIsCapped={unreadIsCapped}
                channelFilter={channelFilter}
                onChannelFilterChange={setChannelFilter}
                focusedCustomerId={selectedCustomerId ?? displayedConversations[0]?.customer.id ?? null}
              />
            </div>

            <div
              className={`${selectedCustomerId ? 'flex' : 'hidden shell:flex'} min-h-0 min-w-0 flex-col`}
            >
              <ConversationThread
                customer={selectedCustomer}
                customerId={selectedCustomerId}
                messages={messages}
                loading={messagesLoading}
                error={threadError}
                onRetry={handleRetryThread}
                hasOlder={hasOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={() => void handleLoadOlder()}
                unreadCount={selectedConversation?.unreadCount ?? 0}
                canSend={canSendMessages}
                canWriteReadState={canWriteReadState}
                showBack={!isWideLayout && Boolean(selectedCustomerId)}
                onBack={handleBack}
                onMarkUnread={() => void handleMarkUnread()}
                markingUnread={markingUnread}
                onViewProfile={handleViewProfile}
                onShowDetails={() => setDetailsOpen(true)}
                detailsButtonClassName="xl:hidden"
                value={draft}
                onValueChange={setDraft}
                onSend={() => void handleSend()}
                sending={sending}
                onAtBottomChange={(value) => {
                  atBottomRef.current = value
                }}
              />
            </div>

            <div className="hidden min-h-0 min-w-0 flex-col overflow-y-auto border-l border-border xl:flex">
              {selectedCustomer ? (
                <ContactPanel
                  customer={selectedCustomer}
                  channels={selectedConversation?.channels ?? []}
                  lastMessageAt={selectedConversation?.lastMessageAt}
                  onViewProfile={handleViewProfile}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-4">
                  <p className="text-center text-xs text-text-muted">
                    Select a conversation to see contact details
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Below xl the contact details live in a drawer, so a phone or an iPad
          can still reach the customer's number without leaving the thread. A
          bottom sheet below the shell breakpoint keeps it in thumb reach. */}
      <Drawer
        open={detailsOpen && Boolean(selectedCustomer)}
        onClose={() => setDetailsOpen(false)}
        title="Contact details"
        side={isWideLayout ? 'right' : 'bottom'}
        width="min(380px, 100vw)"
      >
        {selectedCustomer && (
          <ContactPanel
            customer={selectedCustomer}
            channels={selectedConversation?.channels ?? []}
            lastMessageAt={selectedConversation?.lastMessageAt}
            onViewProfile={handleViewProfile}
            className="p-0"
          />
        )}
      </Drawer>

      {/* Mark all read touches every unread message in the database, not just
          the page on screen, and there is no undo. */}
      <ConfirmDialog
        open={confirmMarkAllOpen}
        onClose={() => setConfirmMarkAllOpen(false)}
        onConfirm={() => void handleMarkAllAsRead()}
        title="Mark every conversation as read?"
        message="This clears the unread flag on every inbound message for the whole team, including conversations that are not shown here. It cannot be undone in bulk."
        confirmLabel="Mark all read"
        tone="warning"
      />
    </div>
  )
}
