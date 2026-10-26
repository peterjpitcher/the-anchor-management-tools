'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { isValidIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadDayHours } from '@/lib/business-hours/day-hours'
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

/** Whether the pub or the kitchen is shut on a date (review BK-076). */
export interface DateHoursNotice {
  /** False when no hours apply to the date: unknown, not closed. */
  known: boolean
  closed: boolean
  kitchenClosed: boolean
}

export interface EventNightNotice {
  date: string
  hires: EventNightHire[]
  /** The saved event's ticket sales are stopped by a whole-pub hire (owner decision D24). */
  ticketSalesStopped: boolean
  /** null when the hours could not be read. */
  hours: DateHoursNotice | null
}

async function readDateHours(date: string, admin: ReturnType<typeof createAdminClient>): Promise<DateHoursNotice | null> {
  try {
    const day = (await loadDayHours(date, date, admin)).get(date)
    return day ? { known: day.known, closed: day.closed, kitchenClosed: day.kitchenClosed } : null
  } catch (error) {
    logger.error('Could not read the hours for a date', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { date },
    })
    return null
  }
}

/**
 * Whether the pub or kitchen is shut on a date, for the private booking forms (review BK-076, owner
 * decision D24): a hire on a closed day is warned about, not refused.
 */
export async function getDateHoursNotice(date: string): Promise<{ success?: boolean; error?: string; data?: DateHoursNotice | null }> {
  const canView = await checkUserPermission('private_bookings', 'view')
    || await checkUserPermission('events', 'view')
  if (!canView) return { error: 'Insufficient permissions' }
  if (!isValidIsoDate(date)) return { error: 'Choose a date' }
  return { success: true, data: await readDateHours(date, createAdminClient()) }
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
    const [hires, hours] = await Promise.all([loadPrivateHiresOnDate(date, admin), readDateHours(date, admin)])
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
        hours,
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
