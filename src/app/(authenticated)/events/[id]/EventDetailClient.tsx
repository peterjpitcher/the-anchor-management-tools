'use client'

import { useState, useCallback, useTransition, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Card, CardHeader, CardBody,
  PageHeader,
  Tabs,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TablePagination,
  Badge,
  Button,
  Input,
  Select,
  ConfirmDialog,
  CustomerLink,
  toast,
} from '@/ds'
import { EmptyState } from '@/ds'
import { Icon } from '@/ds/icons'
import type { Event } from '@/types/database'
import type { EventBookingRow } from '@/app/actions/events'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'
import type { EventMarketingMessage } from '@/app/actions/event-marketing-messages'
import type { EventCategory } from '@/types/event-categories'
import {
  getEventById,
  getEventBookings,
  updateEventManualBookingSeats,
  cancelEventManualBooking,
  getEventBookingRefundInfo,
  markEventBookingPaidManually,
  transferEventBooking,
  deleteEvent,
} from '@/app/actions/events'
import {
  regenerateEventMarketingLinks,
} from '@/app/actions/event-marketing-links'
import { EventTicketTypesCard } from './EventTicketTypesCard'
import type { EventTicketTypeRow } from '@/lib/events/ticket-types'
import { EventDrawer } from '@/app/(authenticated)/events/_components/EventDrawer'
import { AddManualBookingForm } from './AddManualBookingForm'
import { RefundBookingDialog } from './RefundBookingDialog'
import { EditAttendeeNamesModal } from './EditAttendeeNamesModal'
import { validateSeatsInput } from './manual-booking-helpers'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { formatDateInLondon, formatTime12Hour, formatDateTime12Hour, getTodayIsoDate } from '@/lib/dateUtils'
import { resolveEventOnlineDiscountAmount, resolveEventPaymentMode, resolveEventPriceAmount, resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import { buildEventBookingStats } from '@/lib/events/stats'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface EventDetailClientProps {
  event: Event | null
  bookings: EventBookingRow[]
  marketingLinks: EventMarketingLink[]
  marketingMessages: EventMarketingMessage[]
  categories: EventCategory[]
  transferEvents: Event[]
  permissions: { canEdit: boolean; canDelete: boolean; canManage: boolean }
  ticketTypesEnabled: boolean
  initialTicketTypes: EventTicketTypeRow[]
  initialError: string | null
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'scheduled': return 'success'
    case 'cancelled': return 'danger'
    case 'postponed': return 'warning'
    case 'rescheduled': return 'info'
    case 'sold_out': return 'primary'
    default: return 'neutral'
  }
}

function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '-'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function formatBookingMode(mode: Event['booking_mode']): string {
  switch (mode) {
    case 'general':
      return 'General entry'
    case 'mixed':
      return 'Mixed'
    case 'communal':
      return 'Communal seating'
    case 'table':
      return 'Table booking'
    default:
      return 'Table booking'
  }
}

function formatPaymentMode(paymentMode: Event['payment_mode']): string | null {
  switch (paymentMode) {
    case 'prepaid':
      return 'paid online'
    case 'cash_only':
      return 'cash on arrival'
    case 'free':
      return 'free'
    default:
      return null
  }
}

function formatEventCost(event: Event): string {
  const ticketPrice = resolveEventTicketPriceAmount(event)
  const onlinePrice = resolveEventPriceAmount(event)
  const onlineSaving = resolveEventOnlineDiscountAmount(event)
  const paymentModeValue = resolveEventPaymentMode(event) as Event['payment_mode']
  const paymentMode = formatPaymentMode(paymentModeValue)

  if (ticketPrice === 0 && paymentModeValue === 'free') {
    return 'Free'
  }

  if (onlineSaving > 0 && onlinePrice !== ticketPrice) {
    return `Ticket ${formatCurrency(ticketPrice)} per person, online ${formatCurrency(onlinePrice)} (save ${formatCurrency(onlineSaving)})${paymentMode ? `, ${paymentMode}` : ''}`
  }

  return `${formatCurrency(ticketPrice)} per person${paymentMode ? `, ${paymentMode}` : ''}`
}

function formatBookingPayment(booking: EventBookingRow): string {
  const amount = Number(booking.paid_amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return booking.payment_method_summary === 'Comp' ? 'Comp' : '-'
  }

  const status = booking.payment_status_summary || 'Paid'
  const method = booking.payment_method_summary ? ` · ${booking.payment_method_summary}` : ''
  return `${formatCurrency(amount)} ${status.toLowerCase()}${method}`
}

function copyToClipboard(text: string, label: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied to clipboard`),
    () => toast.error('Failed to copy to clipboard'),
  )
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EventDetailClient({
  event: initialEvent,
  bookings: initialBookings,
  marketingLinks: initialLinks,
  marketingMessages,
  categories,
  transferEvents,
  permissions,
  ticketTypesEnabled,
  initialTicketTypes,
  initialError,
}: EventDetailClientProps) {
  const router = useRouter()
  const [event, setEvent] = useState<Event | null>(initialEvent)
  const [activeTab, setActiveTab] = useState('overview')
  // Ticket types apply to standard (table/general) events only; communal/mixed
  // events stay single-price. Gated by the server-resolved feature flag.
  const showTicketTypesTab =
    ticketTypesEnabled &&
    event?.booking_mode !== 'communal' &&
    event?.booking_mode !== 'mixed'
  const [bookings, setBookings] = useState<EventBookingRow[]>(initialBookings)
  const [links, setLinks] = useState<EventMarketingLink[]>(initialLinks)
  const [showCancelled, setShowCancelled] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Edit seats state
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [editSeatsValue, setEditSeatsValue] = useState('')
  const [editSeatsError, setEditSeatsError] = useState<string | null>(null)

  // Row action dialogs
  const [refundingBooking, setRefundingBooking] = useState<EventBookingRow | null>(null)
  const [editNamesBooking, setEditNamesBooking] = useState<EventBookingRow | null>(null)
  const [compBookingId, setCompBookingId] = useState<string | null>(null)

  // Cancel confirmation state
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)
  const [cancelRefundInfo, setCancelRefundInfo] = useState<{
    canRefund: boolean
    maxRefundable: number
    policySuggestion: number
    amountPaid: number
  } | null>(null)
  const [cancelRefundLoading, setCancelRefundLoading] = useState(false)
  const [cancelRefundOn, setCancelRefundOn] = useState(false)
  const [cancelRefundMode, setCancelRefundMode] = useState<'full' | 'partial'>('full')
  const [cancelRefundAmount, setCancelRefundAmount] = useState('')
  const [transferringBookingId, setTransferringBookingId] = useState<string | null>(null)
  const [transferTargetEventId, setTransferTargetEventId] = useState('')

  /* ---- Derived data ---- */

  // Expired payment holds are dead bookings too — counting them inflates the
  // Overview tab count and "Active Bookings" card relative to totalSeats.
  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'expired' && b.is_reminder_only !== true),
    [bookings],
  )

  const visibleBookings = useMemo(
    () => (showCancelled ? bookings : activeBookings),
    [showCancelled, bookings, activeBookings],
  )

  const eventStats = useMemo(
    () => event ? buildEventBookingStats(event, bookings, links) : null,
    [event, bookings, links],
  )

  const totalSeats = eventStats?.totalSeats ?? 0
  const capacityPct = eventStats?.capacityPct ?? null
  const estimatedRevenue = eventStats?.estimatedRevenue ?? 0
  const totalPaidAmount = useMemo(
    () => activeBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.paid_amount || 0)), 0),
    [activeBookings],
  )
  const totalLinkClicks = eventStats?.totalLinkClicks ?? 0

  const canDeleteEvent = permissions.canDelete || permissions.canManage
  const resolvedEventPrice = event ? resolveEventTicketPriceAmount(event) : 0
  const resolvedPaymentMode = event ? resolveEventPaymentMode(event) : 'free'

  /* ---- Refresh bookings ---- */

  const refreshBookings = useCallback(async () => {
    if (!event) return
    const result = await getEventBookings(event.id)
    if (result.data) {
      setBookings(result.data)
    }
  }, [event])

  /* ---- Edit drawer ---- */

  const handleDrawerSave = useCallback(async () => {
    setDrawerOpen(false)
    if (!event) return
    const result = await getEventById(event.id)
    if (result.data) {
      setEvent(result.data)
    }
    await refreshBookings()
  }, [event, refreshBookings])

  /* ---- Edit seats ---- */

  const handleStartEditSeats = useCallback((booking: EventBookingRow) => {
    setEditingBookingId(booking.id)
    setEditSeatsValue(String(booking.seats ?? 1))
    setEditSeatsError(null)
  }, [])

  const handleEditSeatsValueChange = useCallback((value: string) => {
    setEditSeatsValue(value)
    setEditSeatsError(null)
  }, [])

  const handleSaveSeats = useCallback(() => {
    if (!editingBookingId || !event) return
    // Out-of-range input gets an inline error rather than being silently clamped.
    const seatsCheck = validateSeatsInput(editSeatsValue)
    if (seatsCheck.error || seatsCheck.seats === null) {
      setEditSeatsError(seatsCheck.error ?? 'Enter the number of seats.')
      return
    }
    const seatsToSave = seatsCheck.seats
    startTransition(async () => {
      const result = await updateEventManualBookingSeats({
        bookingId: editingBookingId,
        seats: seatsToSave,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Seats updated')
        setEditingBookingId(null)
        setEditSeatsError(null)
        await refreshBookings()
      }
    })
  }, [editingBookingId, editSeatsValue, event, refreshBookings])

  /* ---- Cancel booking ---- */

  // Load refund context (max refundable, policy suggestion, permission) when the
  // cancel dialog opens, and reset the refund choice when it closes.
  useEffect(() => {
    if (!cancellingBookingId) {
      setCancelRefundInfo(null)
      setCancelRefundLoading(false)
      setCancelRefundOn(false)
      setCancelRefundMode('full')
      setCancelRefundAmount('')
      return
    }
    let cancelled = false
    setCancelRefundLoading(true)
    setCancelRefundInfo(null)
    getEventBookingRefundInfo(cancellingBookingId)
      .then((res) => {
        if (cancelled || 'error' in res) return
        setCancelRefundInfo(res.data)
        if (res.data.maxRefundable > 0 && res.data.canRefund) {
          setCancelRefundOn(true)
          setCancelRefundMode('full')
          setCancelRefundAmount(res.data.maxRefundable.toFixed(2))
        }
      })
      .finally(() => {
        if (!cancelled) setCancelRefundLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cancellingBookingId])

  const handleConfirmCancel = useCallback(() => {
    if (!cancellingBookingId || !event) return
    const refundDecision: 'none' | 'full' | 'partial' =
      cancelRefundInfo && cancelRefundInfo.canRefund && cancelRefundInfo.maxRefundable > 0 && cancelRefundOn
        ? cancelRefundMode
        : 'none'
    startTransition(async () => {
      const result = await cancelEventManualBooking({
        bookingId: cancellingBookingId,
        refundDecision,
        ...(refundDecision === 'partial' ? { refundAmount: Number(cancelRefundAmount) || 0 } : {}),
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        const refundAmount = result.data.refund_amount || 0
        if (result.data.refund_status === 'succeeded' && refundAmount > 0) {
          toast.success(`Booking cancelled. Refund issued: ${formatCurrency(refundAmount)}`)
        } else if (result.data.refund_status === 'pending' && refundAmount > 0) {
          toast.success(`Booking cancelled. Refund pending: ${formatCurrency(refundAmount)}`)
        } else if ((result.data.refund_status === 'manual_required' || result.data.refund_status === 'failed') && refundAmount > 0) {
          toast.warning(`Booking cancelled. Refund needs staff follow-up: ${formatCurrency(refundAmount)}`)
        } else {
          toast.success('Booking cancelled')
        }
        setCancellingBookingId(null)
        await refreshBookings()
      }
    })
  }, [cancellingBookingId, event, refreshBookings, cancelRefundInfo, cancelRefundOn, cancelRefundMode, cancelRefundAmount])

  const handleMarkPaid = useCallback((bookingId: string, method: 'cash' | 'card_terminal' | 'comp') => {
    startTransition(async () => {
      const result = await markEventBookingPaidManually({ bookingId, method })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (result.data.state === 'manual_review') {
        toast.warning('Payment recorded. Booking needs staff review.')
      } else if (result.data.state === 'blocked') {
        toast.error(formatStatusLabel(result.data.reason || 'Payment blocked'))
      } else {
        toast.success('Booking marked paid')
      }
      await refreshBookings()
    })
  }, [refreshBookings])

  const handleTransferBooking = useCallback(() => {
    if (!transferringBookingId || !transferTargetEventId.trim()) return
    startTransition(async () => {
      const result = await transferEventBooking({
        bookingId: transferringBookingId,
        targetEventId: transferTargetEventId.trim()
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (result.data.state === 'blocked') {
        toast.error(formatStatusLabel(result.data.reason || 'Transfer blocked'))
        return
      }
      toast.success('Booking transferred')
      setTransferringBookingId(null)
      setTransferTargetEventId('')
      await refreshBookings()
    })
  }, [transferringBookingId, transferTargetEventId, refreshBookings])

  /* ---- Marketing links ---- */

  const handleRegenerateLinks = useCallback(async () => {
    if (!event) return
    const result = await regenerateEventMarketingLinks(event.id)
    if (result.links) {
      setLinks(result.links)
      toast.success('Marketing links regenerated')
    } else if (result.error) {
      toast.error(result.error)
    }
  }, [event])

  const handleLinkGenerated = useCallback((link: EventMarketingLink) => {
    setLinks((prev) => [...prev, link])
  }, [])

  /* ---- Delete event ---- */

  const handleConfirmDeleteEvent = useCallback(() => {
    const eventId = event?.id
    if (!eventId) return
    startTransition(async () => {
      const result = await deleteEvent(eventId)
      if ('error' in result) {
        toast.error(result.error ?? 'Failed to delete event')
        return
      }

      toast.success('Event deleted successfully')
      router.push('/events')
      router.refresh()
    })
  }, [event, router])

  /* ---- Error / missing event ---- */

  if (initialError && !event) {
    return (
      <div className="p-6">
        <PageHeader
          title="Event Details"
          breadcrumbs={[
            { label: 'Events', href: '/events' },
            { label: 'Error' },
          ]}
        />
        <Card>
          <CardBody>
            <p className="text-text-muted">{initialError}</p>
            <Link href="/events" className="text-primary underline mt-2 inline-block">
              Back to Events
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="p-6">
        <PageHeader
          title="Event Details"
          breadcrumbs={[
            { label: 'Events', href: '/events' },
            { label: 'Not found' },
          ]}
        />
        <EmptyState title="Not Found" description="Event not found." />
      </div>
    )
  }

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title={event.name}
        breadcrumbs={[
          { label: 'Events', href: '/events' },
          { label: event.name },
        ]}
        className="mb-0"
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={getStatusTone(event.event_status)} dot>
                {formatStatusLabel(event.event_status)}
              </Badge>
              {resolvedEventPrice === 0 && resolvedPaymentMode === 'free' ? (
                <Badge tone="info">Free</Badge>
              ) : resolvedEventPrice > 0 ? (
                <Badge tone="neutral">{formatCurrency(resolvedEventPrice)}</Badge>
              ) : null}
            </div>
            {(permissions.canEdit || canDeleteEvent) && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {permissions.canEdit && (
                  <Button variant="secondary" size="sm" fullWidth className="sm:w-auto" icon={<Icon name="edit" size={14} />} onClick={() => setDrawerOpen(true)}>
                    Edit
                  </Button>
                )}
                {canDeleteEvent && (
                  <Button
                    variant="danger"
                    size="sm"
                    fullWidth
                    className="sm:w-auto"
                    icon={<Icon name="trash" size={14} />}
                    onClick={() => setDeleteDialogOpen(true)}
                    loading={isPending}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        }
      />

      {initialError && (
        <div className="rounded-md bg-warning/10 border border-warning/30 p-3 text-sm text-warning">
          {initialError}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview', count: activeBookings.length },
          ...(showTicketTypesTab ? [{ id: 'ticket-types', label: 'Tickets' }] : []),
          { id: 'short-links', label: 'Short Links', count: totalLinkClicks || undefined },
          { id: 'marketing', label: 'Marketing' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main content + checklist sidebar */}
      <div className="flex gap-6 items-start">
        {/* Tab content — takes remaining space */}
        <div className={`flex-1 min-w-0 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-6">
              <OverviewTab event={event} />
              <AttendeesTab
                event={event}
                visibleBookings={visibleBookings}
                showCancelled={showCancelled}
                onToggleCancelled={() => setShowCancelled((v) => !v)}
                canManage={permissions.canManage}
                totalSeats={totalSeats}
                activeBookingsCount={activeBookings.length}
                capacityPct={capacityPct}
                estimatedRevenue={estimatedRevenue}
                totalPaidAmount={totalPaidAmount}
                totalLinkClicks={totalLinkClicks}
                ticketTypes={initialTicketTypes}
                basketEligible={showTicketTypesTab}
                onBookingCreated={refreshBookings}
                editingBookingId={editingBookingId}
                editSeatsValue={editSeatsValue}
                editSeatsError={editSeatsError}
                onEditSeatsValueChange={handleEditSeatsValueChange}
                onStartEditSeats={handleStartEditSeats}
                onSaveSeats={handleSaveSeats}
                onCancelEdit={() => {
                  setEditingBookingId(null)
                  setEditSeatsError(null)
                }}
                onCancelBooking={setCancellingBookingId}
                onMarkPaid={handleMarkPaid}
                onRequestComp={setCompBookingId}
                onRefundBooking={setRefundingBooking}
                onEditNames={setEditNamesBooking}
                transferringBookingId={transferringBookingId}
                transferTargetEventId={transferTargetEventId}
                transferEvents={transferEvents}
                onStartTransfer={(bookingId) => {
                  setTransferringBookingId(bookingId)
                  setTransferTargetEventId('')
                }}
                onTransferTargetEventIdChange={setTransferTargetEventId}
                onConfirmTransfer={handleTransferBooking}
                onCancelTransfer={() => {
                  setTransferringBookingId(null)
                  setTransferTargetEventId('')
                }}
                isPending={isPending}
              />
              <MarketingMessagesCard messages={marketingMessages} />
            </div>
          )}

          {activeTab === 'ticket-types' && showTicketTypesTab && event && (
            <EventTicketTypesCard
              eventId={event.id}
              initialTicketTypes={initialTicketTypes}
              canManage={permissions.canManage}
            />
          )}

          {activeTab === 'short-links' && (
            <ShortLinksTab links={links} totalClicks={totalLinkClicks} />
          )}

          {activeTab === 'marketing' && (
            <MarketingTab
              event={event}
              links={links}
              onRegenerate={handleRegenerateLinks}
              onLinkGenerated={handleLinkGenerated}
            />
          )}
        </div>

        {/* Checklist — persistent right panel */}
        <div className="hidden lg:block w-80 shrink-0 sticky top-6">
          <EventChecklistCard
            eventId={event.id}
            eventName={event.name}
          />
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        open={cancellingBookingId !== null}
        onClose={() => setCancellingBookingId(null)}
        onConfirm={handleConfirmCancel}
        title="Cancel Booking"
        message={
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              Are you sure you want to cancel this booking? This action cannot be undone.
            </p>
            {cancelRefundLoading ? (
              <p className="text-sm text-text-muted">Checking payment…</p>
            ) : cancelRefundInfo && cancelRefundInfo.maxRefundable > 0 ? (
              cancelRefundInfo.canRefund ? (
                <div className="space-y-2 rounded-md border border-line bg-surface-sunk p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-text">
                    <input
                      type="checkbox"
                      checked={cancelRefundOn}
                      onChange={(e) => setCancelRefundOn(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Issue a refund (paid {formatCurrency(cancelRefundInfo.amountPaid)})
                  </label>
                  {cancelRefundOn && (
                    <div className="space-y-2 pl-6">
                      <Select
                        value={cancelRefundMode}
                        onChange={(e) => {
                          const mode = e.target.value === 'partial' ? 'partial' : 'full'
                          setCancelRefundMode(mode)
                          if (mode === 'full' && cancelRefundInfo) {
                            setCancelRefundAmount(cancelRefundInfo.maxRefundable.toFixed(2))
                          }
                        }}
                        options={[
                          { value: 'full', label: `Full refund (${formatCurrency(cancelRefundInfo.maxRefundable)})` },
                          { value: 'partial', label: 'Partial refund' },
                        ]}
                      />
                      {cancelRefundMode === 'partial' && (
                        <Input
                          type="number"
                          min={0}
                          max={cancelRefundInfo.maxRefundable}
                          step="0.01"
                          value={cancelRefundAmount}
                          onChange={(e) => setCancelRefundAmount(e.target.value)}
                          placeholder="Refund amount"
                        />
                      )}
                      <p className="text-xs text-text-muted">
                        Up to {formatCurrency(cancelRefundInfo.maxRefundable)}. Policy suggests{' '}
                        {formatCurrency(cancelRefundInfo.policySuggestion)}.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-amber-700">
                  This booking is paid ({formatCurrency(cancelRefundInfo.amountPaid)}). Only a manager can
                  cancel a paid booking, so the refund can be decided.
                </p>
              )
            ) : null}
          </div>
        }
        confirmLabel="Cancel Booking"
        tone="danger"
        loading={cancelRefundLoading || isPending}
      />

      {/* Comp confirmation dialog */}
      <ConfirmDialog
        open={compBookingId !== null}
        onClose={() => setCompBookingId(null)}
        onConfirm={() => {
          if (compBookingId) {
            handleMarkPaid(compBookingId, 'comp')
          }
        }}
        title="Comp Booking"
        message="Mark this booking as complimentary? It will be confirmed with no payment taken."
        confirmLabel="Comp Booking"
        tone="warning"
        loading={isPending}
      />

      {/* After-the-fact refund dialog */}
      <RefundBookingDialog
        booking={refundingBooking}
        onClose={() => setRefundingBooking(null)}
        onDone={refreshBookings}
      />

      {/* Edit attendee names modal */}
      <EditAttendeeNamesModal
        booking={editNamesBooking}
        onClose={() => setEditNamesBooking(null)}
        onSaved={refreshBookings}
      />

      {/* Delete event confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDeleteEvent}
        title="Delete Event"
        message={`Delete "${event.name}"? This action cannot be undone. Events with active bookings must be cancelled before deletion.`}
        confirmLabel="Delete"
        tone="danger"
        loading={isPending}
      />

      {/* Edit event drawer */}
      {permissions.canEdit && (
        <EventDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          event={event}
          categories={categories}
          onSave={handleDrawerSave}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/*  Overview Tab                                                       */
/* ================================================================== */

function OverviewTab({ event }: { event: Event }) {
  return (
    <Card>
      <CardHeader title="Event Details" />
      <CardBody>
        <div className="flex flex-col gap-6 lg:flex-row">
          {event.hero_image_url && (
            <div className="shrink-0">
              <img
                src={event.hero_image_url}
                alt={`${event.name} hero image`}
                className="rounded-lg w-full lg:w-64 lg:h-64 aspect-square object-cover"
              />
            </div>
          )}
          <dl className="grid flex-1 gap-4 sm:grid-cols-2 content-start">
            <DetailRow label="Date" value={formatDateInLondon(event.date, { day: 'numeric', month: 'long', year: 'numeric' })} />
            <DetailRow label="Time" value={formatTime12Hour(event.time)} />
            {event.end_time && <DetailRow label="End Time" value={formatTime12Hour(event.end_time)} />}
            {event.doors_time && <DetailRow label="Doors" value={formatTime12Hour(event.doors_time)} />}
            {event.last_entry_time && <DetailRow label="Last Entry" value={formatTime12Hour(event.last_entry_time)} />}
            {event.booking_cutoff_at && (
              <DetailRow label="Online sales close" value={formatDateTime12Hour(event.booking_cutoff_at)}>
                {new Date(event.booking_cutoff_at).getTime() < Date.now() && (
                  <Badge tone="neutral" size="sm">Online sales closed</Badge>
                )}
              </DetailRow>
            )}
            {event.booking_mode === 'communal' ? (
              <>
                {(event as any).seated_capacity !== null && (event as any).seated_capacity !== undefined && (
                  <DetailRow label="Seated Capacity" value={String((event as any).seated_capacity)} />
                )}
                {(event as any).standing_capacity !== null && (event as any).standing_capacity !== undefined && (
                  <DetailRow label="Standing Capacity" value={String((event as any).standing_capacity)} />
                )}
              </>
            ) : (
              event.capacity !== null && <DetailRow label="Capacity" value={String(event.capacity)} />
            )}
            <DetailRow label="Booking Type" value={formatBookingMode(event.booking_mode)} />
            <DetailRow label="Cost" value={formatEventCost(event)} />
            {event.performer_name && <DetailRow label="Performer" value={`${event.performer_name}${event.performer_type ? ` (${event.performer_type})` : ''}`} />}
            {event.slug && (
              <DetailRow label="Slug" value={event.slug}>
                <CopyButton text={event.slug} label="Slug" />
              </DetailRow>
            )}
            {event.brief && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-text-muted">Brief</dt>
                <dd className="mt-0.5">
                  <CopyButton text={event.brief} label="Brief" />
                </dd>
              </div>
            )}
            {event.booking_url && (
              <DetailRow label="Booking URL" value={event.booking_url} className="sm:col-span-2">
                <CopyButton text={event.booking_url} label="Booking URL" />
              </DetailRow>
            )}
          </dl>
        </div>
      </CardBody>
    </Card>
  )
}

/* ================================================================== */
/*  Short Links Tab                                                    */
/* ================================================================== */

function ShortLinksTab({ links, totalClicks }: { links: EventMarketingLink[]; totalClicks: number }) {
  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => (b.clickCount ?? 0) - (a.clickCount ?? 0)),
    [links],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Total Clicks</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{totalClicks.toLocaleString()}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Active Links</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{links.length}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Avg. Clicks/Link</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">
            {links.length > 0 ? Math.round(totalClicks / links.length) : 0}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Click Breakdown by Channel" />
        <CardBody>
          {sortedLinks.length === 0 ? (
            <EmptyState title="No Links" description="No marketing links have been generated for this event yet." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Short URL</TableHead>
                    <TableHead align="right">Clicks</TableHead>
                    <TableHead>Last Clicked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell>
                        <span className="font-medium text-text-strong">{link.label}</span>
                      </TableCell>
                      <TableCell>
                        <Badge tone={link.type === 'digital' ? 'info' : 'neutral'} size="sm">
                          {link.type === 'digital' ? 'Digital' : 'Print'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-muted font-mono">{link.shortCode}</span>
                          <CopyButton text={link.shortUrl} label="Short URL" />
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <span className={`font-semibold ${link.clickCount > 0 ? 'text-text-strong' : 'text-text-muted'}`}>
                          {link.clickCount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-text-muted">
                          {link.lastClickedAt ? formatDateInLondon(link.lastClickedAt) : '-'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

/* ================================================================== */
/*  Attendees Tab                                                      */
/* ================================================================== */

function AttendeesTab({
  event,
  visibleBookings,
  showCancelled,
  onToggleCancelled,
  canManage,
  totalSeats,
  activeBookingsCount,
  capacityPct,
  estimatedRevenue,
  totalPaidAmount,
  totalLinkClicks,
  ticketTypes,
  basketEligible,
  onBookingCreated,
  editingBookingId,
  editSeatsValue,
  editSeatsError,
  onEditSeatsValueChange,
  onStartEditSeats,
  onSaveSeats,
  onCancelEdit,
  onCancelBooking,
  onMarkPaid,
  onRequestComp,
  onRefundBooking,
  onEditNames,
  transferringBookingId,
  transferTargetEventId,
  transferEvents,
  onStartTransfer,
  onTransferTargetEventIdChange,
  onConfirmTransfer,
  onCancelTransfer,
  isPending,
}: {
  event: Event
  visibleBookings: EventBookingRow[]
  showCancelled: boolean
  onToggleCancelled: () => void
  canManage: boolean
  totalSeats: number
  activeBookingsCount: number
  capacityPct: number | null
  estimatedRevenue: number | null
  totalPaidAmount: number
  totalLinkClicks: number
  ticketTypes: EventTicketTypeRow[]
  basketEligible: boolean
  onBookingCreated: () => Promise<void> | void
  editingBookingId: string | null
  editSeatsValue: string
  editSeatsError: string | null
  onEditSeatsValueChange: (v: string) => void
  onStartEditSeats: (booking: EventBookingRow) => void
  onSaveSeats: () => void
  onCancelEdit: () => void
  onCancelBooking: (id: string) => void
  onMarkPaid: (id: string, method: 'cash' | 'card_terminal' | 'comp') => void
  onRequestComp: (id: string) => void
  onRefundBooking: (booking: EventBookingRow) => void
  onEditNames: (booking: EventBookingRow) => void
  transferringBookingId: string | null
  transferTargetEventId: string
  transferEvents: Event[]
  onStartTransfer: (id: string) => void
  onTransferTargetEventIdChange: (v: string) => void
  onConfirmTransfer: () => void
  onCancelTransfer: () => void
  isPending: boolean
}) {
  const pageSize = 25
  const [attendeePage, setAttendeePage] = useState(1)
  const totalAttendeePages = Math.max(1, Math.ceil(visibleBookings.length / pageSize))
  const pagedBookings = useMemo(
    () => visibleBookings.slice((attendeePage - 1) * pageSize, attendeePage * pageSize),
    [visibleBookings, attendeePage],
  )
  const transferOptions = useMemo(() => {
    // Past events are never valid transfer targets (the RPC would bounce them
    // with event_started anyway) — only offer today-or-future events.
    const todayIso = getTodayIsoDate()
    return [
      { value: '', label: 'Select event' },
      ...transferEvents
        .filter((candidate) => {
          if (candidate.id === event.id) return false
          if (['cancelled', 'draft'].includes(String(candidate.event_status || ''))) return false
          return String(candidate.date || '') >= todayIso
        })
        .map((candidate) => ({
          value: candidate.id,
          label: `${candidate.name} · ${formatDateInLondon(candidate.date)}${candidate.time ? ` ${formatTime12Hour(candidate.time)}` : ''}`,
        })),
    ]
  }, [event.id, transferEvents])

  useEffect(() => {
    setAttendeePage((current) => Math.min(current, totalAttendeePages))
  }, [totalAttendeePages])

  // Numbered attendee-name list — shared between the desktop table cell and the
  // mobile card so both stay in sync.
  const renderAttendeeNames = (booking: EventBookingRow) => {
    const attendeeNames = (booking.attendee_names ?? []).filter(
      (name) => typeof name === 'string' && name.trim().length > 0
    )
    if (attendeeNames.length === 0) return null
    return (
      <ol className="mt-1 list-decimal pl-4 text-xs text-text-muted">
        {attendeeNames.map((name, index) => (
          <li key={index}>{name}</li>
        ))}
      </ol>
    )
  }

  // Per-booking action cluster (mark-paid/comp/edit/edit-names/transfer/refund/
  // cancel plus the inline seats and transfer editors). Extracted so the desktop
  // table and the mobile card render the exact same controls and handlers.
  const renderBookingActions = (booking: EventBookingRow) => {
    if (!canManage) return null
    const isEditing = editingBookingId === booking.id
    const isTransferring = transferringBookingId === booking.id
    const isCancelled = booking.status === 'cancelled'

    // Paid (confirmed or cancelled) bookings can be refunded after the fact —
    // cancelling with "no refund" is no longer a one-shot decision.
    const canShowRefund =
      booking.is_reminder_only !== true &&
      Number(booking.paid_amount ?? 0) > 0 &&
      (booking.status === 'confirmed' || booking.status === 'cancelled')

    if (isEditing) {
      return (
        <div>
          <div className="flex items-center gap-1">
            <Input
              inputMode="numeric"
              value={editSeatsValue}
              onChange={(e) => onEditSeatsValueChange(e.target.value.replace(/\D/g, ''))}
              min={1}
              max={20}
              className="w-16"
              aria-label="Seats"
            />
            <Button size="sm" variant="primary" onClick={onSaveSeats} disabled={isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
          {editSeatsError && (
            <p className="mt-1 text-xs text-danger" role="alert">{editSeatsError}</p>
          )}
        </div>
      )
    }

    if (isCancelled) {
      return canShowRefund ? (
        <Button size="sm" variant="ghost" onClick={() => onRefundBooking(booking)}>
          Refund…
        </Button>
      ) : null
    }

    if (isTransferring) {
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Select
            value={transferTargetEventId}
            onChange={(e) => onTransferTargetEventIdChange(e.target.value)}
            options={transferOptions}
            className="w-44"
          />
          <Button size="sm" variant="primary" onClick={onConfirmTransfer} disabled={!transferTargetEventId.trim() || isPending}>
            Transfer
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelTransfer}>
            Cancel
          </Button>
        </div>
      )
    }

    const canEditNames =
      booking.is_reminder_only !== true && Number(booking.seats ?? 0) >= 1

    return (
      <div className="flex flex-wrap items-center gap-1">
        {booking.status === 'pending_payment' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onMarkPaid(booking.id, 'cash')}>
              Cash paid
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onMarkPaid(booking.id, 'card_terminal')}>
              Card paid
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onRequestComp(booking.id)}>
              Comp
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onStartEditSeats(booking)}
          icon={<Icon name="edit" size={14} />}
        >
          Edit
        </Button>
        {canEditNames && (
          <Button size="sm" variant="ghost" onClick={() => onEditNames(booking)}>
            Edit names
          </Button>
        )}
        {booking.status === 'confirmed' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onStartTransfer(booking.id)}
          >
            Transfer
          </Button>
        )}
        {canShowRefund && (
          <Button size="sm" variant="ghost" onClick={() => onRefundBooking(booking)}>
            Refund…
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onCancelBooking(booking.id)}
          className="text-danger hover:text-danger"
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards — min-[1280px] instead of xl: works around a Tailwind v4
          cascade bug where a named md/lg/xl grid-cols variant overrides the
          base grid-cols-2 below its breakpoint, collapsing the grid to one
          column on mobile. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 min-[1280px]:grid-cols-6">
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Total Seats Booked</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{totalSeats}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Active Bookings</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{activeBookingsCount}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Capacity</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{capacityPct !== null ? `${capacityPct}%` : '-'}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Est. Revenue</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{estimatedRevenue !== null ? formatCurrency(estimatedRevenue) : '-'}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Paid</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{formatCurrency(totalPaidAmount)}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs font-medium text-text-muted">Link Clicks</p>
          <p className="mt-1 text-2xl font-semibold text-text-primary">{totalLinkClicks.toLocaleString()}</p>
        </Card>
      </div>

      {/* Manual booking form */}
      {canManage && (
        <AddManualBookingForm
          event={event}
          ticketTypes={ticketTypes}
          basketEligible={basketEligible}
          onCreated={onBookingCreated}
        />
      )}

      {/* Bookings table */}
      <Card>
        <CardHeader
          title="Attendees"
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="check" size={14} />}
                  onClick={() => {
                    window.location.href = `/events/${event.id}/check-in`
                  }}
                >
                  Check-In
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={14} />}
                onClick={() => {
                  window.location.href = `/api/events/${event.id}/booking-sheets`
                }}
                disabled={activeBookingsCount === 0}
              >
                Booking Sheets
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={14} />}
                onClick={() => {
                  window.location.href = `/api/events/${event.id}/guest-list`
                }}
                disabled={activeBookingsCount === 0}
              >
                Guest List
              </Button>
              <Button variant="ghost" size="sm" onClick={onToggleCancelled}>
                {showCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
              </Button>
            </div>
          }
        />
        <CardBody>
          {visibleBookings.length === 0 ? (
            <EmptyState title="No Bookings" description="No bookings yet for this event." />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Seats</TableHead>
                      {event.booking_mode === 'communal' && <TableHead>Type</TableHead>}
                      <TableHead>Paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      {canManage && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedBookings.map((booking) => {
                      const isEditing = editingBookingId === booking.id
                      const customerName = [
                        booking.customer?.first_name,
                        booking.customer?.last_name,
                      ]
                        .filter(Boolean)
                        .join(' ') || '-'
                      const isCancelled = booking.status === 'cancelled'

                      return (
                        <TableRow key={booking.id} className={isCancelled ? 'opacity-50' : ''}>
                          <TableCell>
                            <CustomerLink
                              customerId={booking.customer?.id ?? null}
                              name={customerName}
                              fallback="-"
                              className="text-blue-600 hover:text-blue-700"
                            />
                            {renderAttendeeNames(booking)}
                          </TableCell>
                          <TableCell>{booking.customer?.mobile_number ?? '-'}</TableCell>
                          <TableCell>
                            {isEditing ? (
                              renderBookingActions(booking)
                            ) : (
                              <>
                                {booking.seats ?? '-'}
                                {booking.ticket_breakdown && (
                                  <div className="mt-0.5 text-xs text-text-muted">{booking.ticket_breakdown}</div>
                                )}
                              </>
                            )}
                          </TableCell>
                          {event.booking_mode === 'communal' && (
                            <TableCell>
                              <Badge tone={booking.event_seating_type === 'standing' ? 'warning' : 'info'}>
                                {booking.event_seating_type === 'standing' ? 'Standing' : 'Seated'}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell>{formatBookingPayment(booking)}</TableCell>
                          <TableCell>
                            <Badge
                              tone={booking.status === 'cancelled' ? 'danger' : booking.status === 'confirmed' ? 'success' : 'neutral'}
                              dot
                            >
                              {formatStatusLabel(booking.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {formatDateInLondon(booking.created_at, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </TableCell>
                          {canManage && (
                            <TableCell>
                              {isEditing ? null : renderBookingActions(booking)}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="block md:hidden divide-y divide-border">
                {pagedBookings.map((booking) => {
                  const customerName = [
                    booking.customer?.first_name,
                    booking.customer?.last_name,
                  ]
                    .filter(Boolean)
                    .join(' ') || '-'
                  const isCancelled = booking.status === 'cancelled'

                  return (
                    <div key={booking.id} className={`py-4 ${isCancelled ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 font-medium">
                          <CustomerLink
                            customerId={booking.customer?.id ?? null}
                            name={customerName}
                            fallback="-"
                            className="text-blue-600 hover:text-blue-700"
                          />
                        </div>
                        <Badge
                          tone={booking.status === 'cancelled' ? 'danger' : booking.status === 'confirmed' ? 'success' : 'neutral'}
                          dot
                        >
                          {formatStatusLabel(booking.status)}
                        </Badge>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div>
                          <dt className="text-xs font-medium text-text-muted">Phone</dt>
                          <dd className="mt-0.5 text-text">{booking.customer?.mobile_number ?? '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-text-muted">Seats</dt>
                          <dd className="mt-0.5 text-text">
                            {booking.seats ?? '-'}
                            {booking.ticket_breakdown && (
                              <div className="mt-0.5 text-xs text-text-muted">{booking.ticket_breakdown}</div>
                            )}
                          </dd>
                        </div>
                        {event.booking_mode === 'communal' && (
                          <div>
                            <dt className="text-xs font-medium text-text-muted">Type</dt>
                            <dd className="mt-0.5">
                              <Badge tone={booking.event_seating_type === 'standing' ? 'warning' : 'info'}>
                                {booking.event_seating_type === 'standing' ? 'Standing' : 'Seated'}
                              </Badge>
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="text-xs font-medium text-text-muted">Paid</dt>
                          <dd className="mt-0.5 text-text">{formatBookingPayment(booking)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-text-muted">Created</dt>
                          <dd className="mt-0.5 text-text">
                            {formatDateInLondon(booking.created_at, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </dd>
                        </div>
                      </dl>

                      {renderAttendeeNames(booking)}

                      {canManage && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderBookingActions(booking)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <TablePagination
                page={attendeePage}
                totalPages={totalAttendeePages}
                onPageChange={setAttendeePage}
                pageSize={pageSize}
                totalItems={visibleBookings.length}
              />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

/* ================================================================== */
/*  Sent Marketing Messages                                            */
/* ================================================================== */

function formatMarketingTemplateLabel(templateKey: string): string {
  const labels: Record<string, string> = {
    bulk_sms_campaign: 'Bulk campaign',
    event_cross_promo_14d: 'Cross-promo 14d',
    event_cross_promo_14d_paid: 'Cross-promo 14d paid',
    event_general_promo_14d: 'General promo 14d',
    event_general_promo_14d_paid: 'General promo 14d paid',
    event_reminder_promo_7d: 'Promo reminder 7d',
    event_reminder_promo_7d_paid: 'Promo reminder 7d paid',
    event_reminder_promo_3d: 'Promo reminder 3d',
    event_reminder_promo_3d_paid: 'Promo reminder 3d paid',
  }

  return labels[templateKey] ?? formatStatusLabel(templateKey)
}

function getMessageStatusTone(status: string): BadgeTone {
  switch (status.toLowerCase()) {
    case 'sent':
    case 'delivered':
      return 'success'
    case 'queued':
    case 'scheduled':
    case 'accepted':
      return 'warning'
    case 'failed':
    case 'undelivered':
      return 'danger'
    default:
      return 'neutral'
  }
}

function MarketingMessagesCard({ messages }: { messages: EventMarketingMessage[] }) {
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [messages],
  )

  return (
    <Card>
      <CardHeader
        title="Sent Marketing Messages"
        action={messages.length > 0 ? (
          <Badge tone="info" size="sm">{messages.length}</Badge>
        ) : null}
      />
      <CardBody>
        {sortedMessages.length === 0 ? (
          <EmptyState
            title="No Marketing Messages Sent"
            description="No event marketing SMS messages have been logged for this event yet."
          />
        ) : (
          <div className="space-y-3">
            {sortedMessages.map((message) => {
              const recipient = message.customerName || message.recipientPhone || 'Unknown recipient'
              const hasBody = Boolean(message.body?.trim())

              return (
                <div key={message.id} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info" size="sm">
                      {formatMarketingTemplateLabel(message.templateKey)}
                    </Badge>
                    <Badge tone={getMessageStatusTone(message.status)} size="sm">
                      {formatStatusLabel(message.status)}
                    </Badge>
                    <span className="text-xs text-text-muted">
                      Sent {formatDateInLondon(message.sentAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="text-xs text-text-muted">to {recipient}</span>
                  </div>
                  <p className={`mt-2 whitespace-pre-wrap break-words text-sm ${hasBody ? 'text-text' : 'text-text-muted italic'}`}>
                    {hasBody ? message.body : 'Message body was not logged, but the marketing send was recorded.'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/* ================================================================== */
/*  Marketing Tab                                                      */
/* ================================================================== */

function MarketingTab({
  event,
  links,
  onRegenerate,
  onLinkGenerated,
}: {
  event: Event
  links: EventMarketingLink[]
  onRegenerate: () => Promise<void>
  onLinkGenerated: (link: EventMarketingLink) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <EventMarketingLinksCard
        links={links}
        eventId={event.id}
        onRegenerate={onRegenerate}
        onLinkGenerated={onLinkGenerated}
      />

      <EventPromotionContentCard
        eventId={event.id}
        eventName={event.name}
        brief={event.brief}
        marketingLinks={links}
        facebookName={event.facebook_event_name}
        facebookDescription={event.facebook_event_description}
        googleTitle={event.gbp_event_title}
        googleDescription={event.gbp_event_description}
      />
    </div>
  )
}

/* ================================================================== */
/*  Shared sub-components                                              */
/* ================================================================== */

function DetailRow({
  label,
  value,
  className,
  children,
}: {
  label: string
  value: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text flex items-center gap-1.5 min-w-0">
        <span className="truncate min-w-0">{value}</span>
        {children}
      </dd>
    </div>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(text, label)}
      className="inline-flex items-center justify-center rounded p-0.5 text-text-muted hover:text-text transition-colors"
      aria-label={`Copy ${label}`}
    >
      <Icon name="copy" size={14} />
    </button>
  )
}
