'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { isValidIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadEventsClosedByWholePubHire,
  loadPrivateHiresOnDate,
} from '@/services/private-bookings/night-clashes'

/** A private hire as the event form shows it: no customer name, which events staff may not see. */
interface EventNightHire {
  id: string
  status: string
  startTime: string | null
  endTime: string | null
  guestCount: number | null
  roomNames: string[]
  wholePub: boolean
  holdsRoom: boolean
}

export interface EventNightNotice {
  date: string
  hires: EventNightHire[]
  /** The saved event's ticket sales are stopped by a whole-pub hire (owner decision D24). */
  ticketSalesStopped: boolean
}

/**
 * What the event form and page show about the night (review BK-071, owner decision D24): private
 * hires on the date, so an event is not planned onto a hired room unawares, and whether a
 * whole-pub hire has stopped this event's ticket sales. A warning only; nothing is refused here.
 */
export async function getEventNightNotice(
  date: string,
  eventId?: string | null,
): Promise<{ success?: boolean; error?: string; data?: EventNightNotice }> {
  const canView = await checkUserPermission('events', 'view')
  if (!canView) return { error: 'Insufficient permissions' }
  // A server action can be called with anything; only a real date reaches the queries.
  if (!isValidIsoDate(date)) return { error: 'Choose a date' }

  try {
    const admin = createAdminClient()
    const hires = await loadPrivateHiresOnDate(date, admin)
    let ticketSalesStopped = false
    if (eventId) {
      const closed = await loadEventsClosedByWholePubHire([eventId], admin)
      ticketSalesStopped = (closed.get(eventId) ?? []).length > 0
    }
    return {
      success: true,
      data: {
        date,
        hires: hires.map((hire) => ({
          id: hire.id,
          status: hire.status,
          startTime: hire.startTime,
          endTime: hire.endTime,
          guestCount: hire.guestCount,
          roomNames: hire.roomNames,
          wholePub: hire.wholePub,
          holdsRoom: hire.holdsRoom,
        })),
        ticketSalesStopped,
      },
    }
  } catch (error) {
    logger.error('Could not load the private hires for an event night', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { date, eventId: eventId ?? null },
    })
    return { error: 'Could not check private hires on this date.' }
  }
}
