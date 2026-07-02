import { notFound, redirect } from 'next/navigation'
import { getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getEventById, getEventBookings, getEvents } from '@/app/actions/events'
import { getEventTicketTypes } from '@/app/actions/eventTicketTypes'
import { eventTicketTypesEnabled, type EventTicketTypeRow } from '@/lib/events/ticket-types'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { getEventMarketingLinks } from '@/app/actions/event-marketing-links'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'
import { getEventMarketingMessages } from '@/app/actions/event-marketing-messages'
import type { EventMarketingMessage } from '@/app/actions/event-marketing-messages'
import type { EventBookingRow } from '@/app/actions/events'
import type { Event } from '@/types/database'
import EventDetailClient from './EventDetailClient'

export const dynamic = 'force-dynamic'

// AI SEO generation (generateEventSeoContent, opened from EventDrawer) runs to a ~90s budget; raise past Vercel's 15s default so the function isn't killed mid-generation.
export const maxDuration = 100

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function EventDetailPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params)
  const eventId = resolvedParams?.id

  if (!eventId) {
    notFound()
  }

  const errors: string[] = []

  let canView = false
  let canEdit = false
  let canDelete = false
  let canManage = false

  const permissionsResult = await getCurrentUserModuleActions('events')

  if ('error' in permissionsResult) {
    if (permissionsResult.error === 'Not authenticated') {
      redirect('/login')
    }

    console.error('Unable to verify events permissions', permissionsResult.error)
    errors.push('We could not verify your access to events; some actions may be limited.')
  } else {
    const actions = new Set(permissionsResult.actions)
    canView = actions.has('view')
    canEdit = actions.has('edit')
    canDelete = actions.has('delete')
    canManage = actions.has('manage')
  }

  if (!canView && errors.length === 0) {
    redirect('/unauthorized')
  }

  // Fetch event data
  let eventData = null
  const eventResult = await getEventById(eventId)

  if (!eventResult || eventResult.error) {
    const message = eventResult?.error ?? 'Failed to load event details.'

    if (message.toLowerCase().includes('permission')) {
      redirect('/unauthorized')
    }

    if (message.toLowerCase().includes('not found')) {
      notFound()
    }

    errors.push(message)
  } else {
    eventData = eventResult.data ?? null
  }

  // Fetch bookings (non-fatal)
  let bookings: EventBookingRow[] = []
  if (eventData) {
    try {
      const bookingsResult = await getEventBookings(eventId)
      if (bookingsResult.data) {
        bookings = bookingsResult.data
      }
    } catch {
      // Non-fatal: page still renders, bookings table will be empty
    }
  }

  // Fetch marketing links (non-fatal)
  let marketingLinks: EventMarketingLink[] = []
  if (eventData) {
    try {
      const linksResult = await getEventMarketingLinks(eventId)
      if (linksResult.links) {
        marketingLinks = linksResult.links
      }
    } catch {
      // Non-fatal: page still renders, marketing section will be empty
    }
  }

  // Fetch sent marketing messages (non-fatal)
  let marketingMessages: EventMarketingMessage[] = []
  if (eventData) {
    try {
      const messagesResult = await getEventMarketingMessages(eventId)
      if (messagesResult.messages) {
        marketingMessages = messagesResult.messages
      }
    } catch {
      // Non-fatal: page still renders, marketing messages section will be empty
    }
  }

  // Fetch event categories for the edit drawer (non-fatal)
  const categoriesResult = await getActiveEventCategories()
  const categories = categoriesResult.data ?? []

  let transferEvents: Event[] = []
  if (eventData && canManage) {
    try {
      const transferEventsResult = await getEvents({ status: 'all', page: 1, pageSize: 500 })
      transferEvents = transferEventsResult.data ?? []
    } catch {
      transferEvents = []
    }
  }

  if (!eventData && errors.length === 0) {
    errors.push('We could not load this event.')
  }

  const initialError = errors.length > 0 ? errors.join(' ') : null

  const ticketTypesEnabled = eventTicketTypesEnabled()
  let ticketTypes: EventTicketTypeRow[] = []
  if (ticketTypesEnabled && canView && eventData) {
    const ticketTypesResult = await getEventTicketTypes(eventId)
    if (ticketTypesResult.data) {
      ticketTypes = ticketTypesResult.data
    }
  }

  return (
    <EventDetailClient
      event={eventData}
      bookings={bookings}
      marketingLinks={marketingLinks}
      marketingMessages={marketingMessages}
      categories={categories}
      transferEvents={transferEvents}
      permissions={{ canEdit, canDelete, canManage }}
      ticketTypesEnabled={ticketTypesEnabled}
      initialTicketTypes={ticketTypes}
      initialError={initialError}
    />
  )
}
