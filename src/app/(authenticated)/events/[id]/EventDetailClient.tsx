'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateFull, formatTime12Hour } from '@/lib/dateUtils'
import { Event as BaseEvent } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteEvent } from '@/app/actions/events'
import { regenerateEventMarketingLinks, type EventMarketingLink } from '@/app/actions/event-marketing-links'
import { EventChecklistCard } from '@/components/features/events/EventChecklistCard'
import { EventMarketingLinksCard } from '@/components/features/events/EventMarketingLinksCard'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

type Event = BaseEvent & {
  category?: EventCategory | null
}

interface EventDetailClientProps {
  event: Event
  initialMarketingLinks: EventMarketingLink[]
}

function resolveStatusLabel(status: string | null): string {
  if (!status) return 'Scheduled'
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'cancelled':
      return 'Cancelled'
    case 'postponed':
      return 'Postponed'
    case 'scheduled':
      return 'Scheduled'
    default:
      return status.replace(/_/g, ' ')
  }
}

function resolveStatusVariant(status: string | null): 'default' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'draft':
      return 'neutral'
    case 'cancelled':
      return 'error'
    case 'postponed':
      return 'warning'
    default:
      return 'success'
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 2,
})

export default function EventDetailClient({ event, initialMarketingLinks }: EventDetailClientProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageEvents = hasPermission('events', 'manage')

  const [isDeletingEvent, setIsDeletingEvent] = useState(false)
  const [marketingLinks, setMarketingLinks] = useState<EventMarketingLink[]>(initialMarketingLinks)
  const [marketingLoading, setMarketingLoading] = useState(false)
  const [marketingError, setMarketingError] = useState<string | null>(null)

  useEffect(() => {
    setMarketingLinks(initialMarketingLinks)
  }, [initialMarketingLinks])

  const bookingUrl = useMemo(() => {
    const trimmed = (event.booking_url || '').trim()
    return trimmed.length > 0 ? trimmed : null
  }, [event.booking_url])

  const handleOpenBookingUrl = useCallback(() => {
    if (!bookingUrl || !isHttpUrl(bookingUrl)) {
      toast.error('No valid booking URL set for this event.')
      return
    }

    window.open(bookingUrl, '_blank', 'noopener,noreferrer')
  }, [bookingUrl])

  const handleCopyToClipboard = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast.error('Failed to copy')
    }
  }, [])

  const handleRegenerateMarketingLinks = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to refresh marketing links.')
      return
    }

    try {
      setMarketingLoading(true)
      setMarketingError(null)
      const result = await regenerateEventMarketingLinks(event.id)
      if (!result.success) {
        const errorMessage = result.error || 'Failed to refresh marketing links'
        setMarketingError(errorMessage)
        toast.error(errorMessage)
        return
      }

      setMarketingLinks(result.links || [])
      toast.success('Marketing links refreshed')
      router.refresh()
    } catch (error) {
      console.error('Failed to regenerate marketing links:', error)
      setMarketingError('Failed to refresh marketing links.')
      toast.error('Failed to refresh marketing links')
    } finally {
      setMarketingLoading(false)
    }
  }, [canManageEvents, event.id, router])

  const handleDeleteEvent = useCallback(async () => {
    if (!canManageEvents) {
      toast.error('You do not have permission to delete events.')
      return
    }

    if (!window.confirm(`Delete "${event.name}"? This action cannot be undone.`)) return

    try {
      setIsDeletingEvent(true)
      const result = await deleteEvent(event.id)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Event deleted successfully')
      router.replace('/events')
    } catch (error) {
      console.error('Error deleting event:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete event')
    } finally {
      setIsDeletingEvent(false)
    }
  }, [canManageEvents, event.id, event.name, router])

  const eventDate = event.date ? formatDateFull(event.date) : 'To be confirmed'
  const eventTime = formatTime12Hour(event.time)
  const statusLabel = resolveStatusLabel(event.event_status ?? null)
  const statusVariant = resolveStatusVariant(event.event_status ?? null)
  const priceLabel = event.is_free || !event.price ? 'Free' : currencyFormatter.format(event.price)

  return (
    <PageLayout
      title={event.name}
      subtitle={`${eventDate}${event.time ? ` • ${eventTime}` : ''}${event.category?.name ? ` • ${event.category.name}` : ''}`}
      backButton={{ label: 'Back to events', href: '/events' }}
      headerActions={
        canManageEvents || bookingUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            {bookingUrl && (
              <Button
                variant="secondary"
                onClick={handleOpenBookingUrl}
                leftIcon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
              >
                Open booking link
              </Button>
            )}
            {canManageEvents && (
              <Button
                variant="primary"
                onClick={() => router.push(`/events/${event.id}/edit`)}
                leftIcon={<PencilSquareIcon className="h-4 w-4" />}
              >
                Edit event
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <div className="space-y-6">
        <Card padding="lg">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant} size="sm">
                  {statusLabel}
                </Badge>
                {event.category?.name && (
                  <Badge variant="secondary" size="sm">
                    {event.category.name}
                  </Badge>
                )}
                <Badge variant={event.is_free || !event.price ? 'info' : 'secondary'} size="sm">
                  {priceLabel}
                </Badge>
                {bookingUrl && (
                  <Badge variant="info" size="sm" title={bookingUrl}>
                    booking_url set
                  </Badge>
                )}
              </div>

              {event.short_description && (
                <p className="text-sm text-gray-600">{event.short_description}</p>
              )}

              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {event.performer_name && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Performer</dt>
                    <dd className="mt-1 text-sm text-gray-900">{event.performer_name}</dd>
                  </div>
                )}
                {event.doors_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Doors</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.doors_time)}</dd>
                  </div>
                )}
                {event.last_entry_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last entry</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.last_entry_time)}</dd>
                  </div>
                )}
                {event.end_time && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ends</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatTime12Hour(event.end_time)}</dd>
                  </div>
                )}
                {event.slug && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Slug</dt>
                    <dd className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-mono text-sm text-gray-900 break-all">{event.slug}</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        onClick={() => handleCopyToClipboard(event.slug || '', 'Slug')}
                      >
                        Copy
                      </Button>
                    </dd>
                  </div>
                )}
                {event.brief?.trim() && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Event brief</dt>
                    <dd className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-gray-600">{event.brief.trim().length.toLocaleString()} chars</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                        onClick={() => handleCopyToClipboard(event.brief?.trim() ?? '', 'Event brief')}
                      >
                        Copy brief
                      </Button>
                    </dd>
                  </div>
                )}
              </dl>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Booking URL</p>
                    {bookingUrl ? (
                      <>
                        <p className="mt-1 font-mono text-sm text-blue-700 break-all">{bookingUrl}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Bookings are handled externally — this app does not take event or table bookings.
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-gray-600">
                        No booking URL set. Add one in “Edit event” if you want a link out to your booking provider or website.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {bookingUrl && (
                      <>
                        <Button
                          size="xs"
                          variant="secondary"
                          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" />}
                          onClick={() => handleCopyToClipboard(bookingUrl, 'Booking URL')}
                        >
                          Copy
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          leftIcon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
                          onClick={handleOpenBookingUrl}
                        >
                          Open
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {event.hero_image_url && (
              <div className="w-full shrink-0 lg:w-56">
                <img
                  src={event.hero_image_url}
                  alt={`${event.name} artwork`}
                  className="aspect-square w-full rounded-lg border border-gray-200 bg-white object-cover"
                  loading="lazy"
                />
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <EventMarketingLinksCard
              links={marketingLinks}
              loading={marketingLoading}
              error={marketingError}
              onRegenerate={canManageEvents ? handleRegenerateMarketingLinks : undefined}
            />

            <EventPromotionContentCard
              eventId={event.id}
              eventName={event.name}
              initialTicketUrl={bookingUrl}
              brief={event.brief}
              marketingLinks={marketingLinks}
              facebookName={event.facebook_event_name ?? null}
              facebookDescription={event.facebook_event_description ?? null}
              googleTitle={event.gbp_event_title ?? null}
              googleDescription={event.gbp_event_description ?? null}
              opentableTitle={event.opentable_experience_title ?? null}
              opentableDescription={event.opentable_experience_description ?? null}
            />
          </div>

          <div className="space-y-6">
            <EventChecklistCard eventId={event.id} eventName={event.name} />

            {canManageEvents && (
              <Card
                padding="lg"
                className="border border-red-200 bg-red-50/40"
              >
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Danger zone</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Deleting an event cannot be undone.
                    </p>
                  </div>

                  <Button
                    variant="danger"
                    loading={isDeletingEvent}
                    disabled={isDeletingEvent}
                    onClick={handleDeleteEvent}
                    leftIcon={<TrashIcon className="h-4 w-4" />}
                  >
                    Delete event
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
