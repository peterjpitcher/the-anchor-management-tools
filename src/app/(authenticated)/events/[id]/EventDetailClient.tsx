'use client'

import { useState, useCallback, useTransition, useMemo } from 'react'
import Link from 'next/link'
import {
  Card, CardHeader, CardBody,
  PageHeader,
  Tabs,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge,
  Button,
  Input,
  ConfirmDialog,
  toast,
  Spinner,
} from '@/ds'
import { EmptyState } from '@/ds'
import { Icon } from '@/ds/icons'
import type { Event } from '@/types/database'
import type { EventBookingRow } from '@/app/actions/events'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'
import {
  getEventBookings,
  createEventManualBooking,
  updateEventManualBookingSeats,
  cancelEventManualBooking,
} from '@/app/actions/events'
import {
  regenerateEventMarketingLinks,
} from '@/app/actions/event-marketing-links'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface EventDetailClientProps {
  event: Event | null
  bookings: EventBookingRow[]
  marketingLinks: EventMarketingLink[]
  permissions: { canEdit: boolean; canDelete: boolean; canManage: boolean }
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
  event,
  bookings: initialBookings,
  marketingLinks: initialLinks,
  permissions,
  initialError,
}: EventDetailClientProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [bookings, setBookings] = useState<EventBookingRow[]>(initialBookings)
  const [links, setLinks] = useState<EventMarketingLink[]>(initialLinks)
  const [showCancelled, setShowCancelled] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Manual booking form state
  const [newPhone, setNewPhone] = useState('')
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newSeats, setNewSeats] = useState(1)

  // Edit seats state
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [editSeatsValue, setEditSeatsValue] = useState(1)

  // Cancel confirmation state
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)

  /* ---- Derived data ---- */

  const activeBookings = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled'),
    [bookings],
  )

  const visibleBookings = useMemo(
    () => (showCancelled ? bookings : activeBookings),
    [showCancelled, bookings, activeBookings],
  )

  const totalSeats = useMemo(
    () => activeBookings.reduce((sum, b) => sum + (b.seats ?? 0), 0),
    [activeBookings],
  )

  const capacityPct = useMemo(() => {
    if (!event?.capacity) return null
    return Math.round((totalSeats / event.capacity) * 100)
  }, [totalSeats, event?.capacity])

  const estimatedRevenue = useMemo(() => {
    if (!event?.price || event.is_free) return null
    return totalSeats * event.price
  }, [totalSeats, event?.price, event?.is_free])

  /* ---- Refresh bookings ---- */

  const refreshBookings = useCallback(async () => {
    if (!event) return
    const result = await getEventBookings(event.id)
    if (result.data) {
      setBookings(result.data)
    }
  }, [event])

  /* ---- Manual booking ---- */

  const handleCreateBooking = useCallback(() => {
    if (!event || !newPhone.trim()) return
    startTransition(async () => {
      const result = await createEventManualBooking({
        eventId: event.id,
        phone: newPhone.trim(),
        seats: newSeats,
        firstName: newFirstName.trim() || undefined,
        lastName: newLastName.trim() || undefined,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Booking created successfully')
        setNewPhone('')
        setNewFirstName('')
        setNewLastName('')
        setNewSeats(1)
        await refreshBookings()
      }
    })
  }, [event, newPhone, newSeats, newFirstName, newLastName, refreshBookings])

  /* ---- Edit seats ---- */

  const handleStartEditSeats = useCallback((booking: EventBookingRow) => {
    setEditingBookingId(booking.id)
    setEditSeatsValue(booking.seats ?? 1)
  }, [])

  const handleSaveSeats = useCallback(() => {
    if (!editingBookingId || !event) return
    startTransition(async () => {
      const result = await updateEventManualBookingSeats({
        bookingId: editingBookingId,
        seats: editSeatsValue,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Seats updated')
        setEditingBookingId(null)
        await refreshBookings()
      }
    })
  }, [editingBookingId, editSeatsValue, event, refreshBookings])

  /* ---- Cancel booking ---- */

  const handleConfirmCancel = useCallback(() => {
    if (!cancellingBookingId || !event) return
    startTransition(async () => {
      const result = await cancelEventManualBooking({
        bookingId: cancellingBookingId,
      })
      if ('error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Booking cancelled')
        setCancellingBookingId(null)
        await refreshBookings()
      }
    })
  }, [cancellingBookingId, event, refreshBookings])

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
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={getStatusTone(event.event_status)} dot>
              {formatStatusLabel(event.event_status)}
            </Badge>
            {event.is_free ? (
              <Badge tone="info">Free</Badge>
            ) : event.price ? (
              <Badge tone="neutral">{formatCurrency(event.price)}</Badge>
            ) : null}
            {permissions.canEdit && (
              <Button variant="secondary" size="sm" icon={<Icon name="edit" size={14} />}>
                Edit
              </Button>
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
          { id: 'overview', label: 'Overview' },
          { id: 'attendees', label: 'Attendees', count: activeBookings.length },
          { id: 'marketing', label: 'Marketing' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Tab content */}
      <div className={isPending ? 'opacity-60 pointer-events-none' : ''}>
        {activeTab === 'overview' && (
          <OverviewTab
            event={event}
            activeBookings={activeBookings}
            totalSeats={totalSeats}
            capacityPct={capacityPct}
            estimatedRevenue={estimatedRevenue}
          />
        )}

        {activeTab === 'attendees' && (
          <AttendeesTab
            event={event}
            visibleBookings={visibleBookings}
            showCancelled={showCancelled}
            onToggleCancelled={() => setShowCancelled((v) => !v)}
            canManage={permissions.canManage}
            newPhone={newPhone}
            onNewPhoneChange={setNewPhone}
            newFirstName={newFirstName}
            onNewFirstNameChange={setNewFirstName}
            newLastName={newLastName}
            onNewLastNameChange={setNewLastName}
            newSeats={newSeats}
            onNewSeatsChange={setNewSeats}
            onCreateBooking={handleCreateBooking}
            editingBookingId={editingBookingId}
            editSeatsValue={editSeatsValue}
            onEditSeatsValueChange={setEditSeatsValue}
            onStartEditSeats={handleStartEditSeats}
            onSaveSeats={handleSaveSeats}
            onCancelEdit={() => setEditingBookingId(null)}
            onCancelBooking={setCancellingBookingId}
            isPending={isPending}
          />
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

      {/* Checklist — persistent across all tabs */}
      <EventChecklistCard
        eventId={event.id}
        eventName={event.name}
      />

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        open={cancellingBookingId !== null}
        onClose={() => setCancellingBookingId(null)}
        onConfirm={handleConfirmCancel}
        title="Cancel Booking"
        message="Are you sure you want to cancel this booking? This action cannot be undone."
        confirmLabel="Cancel Booking"
        tone="danger"
      />
    </div>
  )
}

/* ================================================================== */
/*  Overview Tab                                                       */
/* ================================================================== */

function OverviewTab({
  event,
  activeBookings,
  totalSeats,
  capacityPct,
  estimatedRevenue,
}: {
  event: Event
  activeBookings: EventBookingRow[]
  totalSeats: number
  capacityPct: number | null
  estimatedRevenue: number | null
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Metadata card -- spans 2 cols */}
      <Card className="lg:col-span-2">
        <CardHeader title="Event Details" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Date" value={formatDateInLondon(event.date, { day: 'numeric', month: 'long', year: 'numeric' })} />
            <DetailRow label="Time" value={formatTime12Hour(event.time)} />
            {event.end_time && <DetailRow label="End Time" value={formatTime12Hour(event.end_time)} />}
            {event.doors_time && <DetailRow label="Doors" value={formatTime12Hour(event.doors_time)} />}
            {event.last_entry_time && <DetailRow label="Last Entry" value={formatTime12Hour(event.last_entry_time)} />}
            {event.capacity !== null && <DetailRow label="Capacity" value={String(event.capacity)} />}
            {event.performer_name && <DetailRow label="Performer" value={`${event.performer_name}${event.performer_type ? ` (${event.performer_type})` : ''}`} />}
            {event.slug && (
              <DetailRow label="Slug" value={event.slug}>
                <CopyButton text={event.slug} label="Slug" />
              </DetailRow>
            )}
            {event.brief && (
              <DetailRow label="Brief" value={event.brief} className="sm:col-span-2">
                <CopyButton text={event.brief} label="Brief" />
              </DetailRow>
            )}
            {event.booking_url && (
              <DetailRow label="Booking URL" value={event.booking_url} className="sm:col-span-2">
                <CopyButton text={event.booking_url} label="Booking URL" />
              </DetailRow>
            )}
          </dl>

          {event.hero_image_url && (
            <div className="mt-4">
              <p className="text-xs font-medium text-text-muted mb-1">Hero Image</p>
              <img
                src={event.hero_image_url}
                alt={`${event.name} hero image`}
                className="rounded-lg max-h-48 object-cover"
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Summary card */}
      <Card>
        <CardHeader title="Bookings Summary" />
        <CardBody>
          <dl className="grid gap-4">
            <DetailRow label="Active Bookings" value={String(activeBookings.length)} />
            <DetailRow label="Total Seats Booked" value={String(totalSeats)} />
            <DetailRow
              label="Capacity"
              value={capacityPct !== null ? `${capacityPct}%` : '-'}
            />
            <DetailRow
              label="Estimated Revenue"
              value={estimatedRevenue !== null ? formatCurrency(estimatedRevenue) : '-'}
            />
          </dl>
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
  newPhone,
  onNewPhoneChange,
  newFirstName,
  onNewFirstNameChange,
  newLastName,
  onNewLastNameChange,
  newSeats,
  onNewSeatsChange,
  onCreateBooking,
  editingBookingId,
  editSeatsValue,
  onEditSeatsValueChange,
  onStartEditSeats,
  onSaveSeats,
  onCancelEdit,
  onCancelBooking,
  isPending,
}: {
  event: Event
  visibleBookings: EventBookingRow[]
  showCancelled: boolean
  onToggleCancelled: () => void
  canManage: boolean
  newPhone: string
  onNewPhoneChange: (v: string) => void
  newFirstName: string
  onNewFirstNameChange: (v: string) => void
  newLastName: string
  onNewLastNameChange: (v: string) => void
  newSeats: number
  onNewSeatsChange: (v: number) => void
  onCreateBooking: () => void
  editingBookingId: string | null
  editSeatsValue: number
  onEditSeatsValueChange: (v: number) => void
  onStartEditSeats: (booking: EventBookingRow) => void
  onSaveSeats: () => void
  onCancelEdit: () => void
  onCancelBooking: (id: string) => void
  isPending: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Manual booking form */}
      {canManage && (
        <Card>
          <CardHeader title="Add Manual Booking" />
          <CardBody>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-text-muted mb-1">Phone *</label>
                <Input
                  value={newPhone}
                  onChange={(e) => onNewPhoneChange(e.target.value)}
                  placeholder="07700 900000"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-medium text-text-muted mb-1">First Name</label>
                <Input
                  value={newFirstName}
                  onChange={(e) => onNewFirstNameChange(e.target.value)}
                  placeholder="First name"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-medium text-text-muted mb-1">Last Name</label>
                <Input
                  value={newLastName}
                  onChange={(e) => onNewLastNameChange(e.target.value)}
                  placeholder="Last name"
                />
              </div>
              <div className="w-24">
                <label className="block text-xs font-medium text-text-muted mb-1">Seats</label>
                <Input
                  type="number"
                  value={String(newSeats)}
                  onChange={(e) => onNewSeatsChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  min={1}
                  max={20}
                />
              </div>
              <Button
                variant="primary"
                onClick={onCreateBooking}
                disabled={!newPhone.trim() || isPending}
                icon={isPending ? <Spinner className="h-4 w-4" /> : <Icon name="plus" size={14} />}
              >
                Add Booking
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Bookings table */}
      <Card>
        <CardHeader
          title="Attendees"
          action={
            <Button variant="ghost" size="sm" onClick={onToggleCancelled}>
              {showCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
            </Button>
          }
        />
        <CardBody>
          {visibleBookings.length === 0 ? (
            <EmptyState title="No Bookings" description="No bookings yet for this event." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    {canManage && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBookings.map((booking) => {
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
                        <TableCell>{customerName}</TableCell>
                        <TableCell>{booking.customer?.mobile_number ?? '-'}</TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={String(editSeatsValue)}
                                onChange={(e) => onEditSeatsValueChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                                min={1}
                                max={20}
                                className="w-16"
                              />
                              <Button size="sm" variant="primary" onClick={onSaveSeats} disabled={isPending}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            booking.seats ?? '-'
                          )}
                        </TableCell>
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
                            {!isCancelled && !isEditing && (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onStartEditSeats(booking)}
                                  icon={<Icon name="edit" size={14} />}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onCancelBooking(booking.id)}
                                  className="text-danger hover:text-danger"
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
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
      <dd className="mt-0.5 text-sm text-text flex items-center gap-1.5">
        <span className="break-all">{value}</span>
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
