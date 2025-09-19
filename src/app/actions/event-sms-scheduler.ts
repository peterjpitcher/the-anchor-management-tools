'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage } from '@/lib/validation'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { subMonths, subWeeks, subDays, isAfter } from 'date-fns'
import { processScheduledEventReminders } from './sms-event-reminders'

const LONDON_TZ = 'Europe/London'
const DEFAULT_SEND_HOUR = 10

export type ReminderType =
  | 'booking_confirmation'
  | 'booked_1_month'
  | 'booked_1_week'
  | 'booked_1_day'
  | 'reminder_invite_1_month'
  | 'reminder_invite_1_week'
  | 'reminder_invite_1_day'

export interface BookingReminderContext {
  bookingId: string
  event: {
    id: string
    name: string
    date: string
    time: string
  }
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
  }
  seats: number | null
}

interface ScheduleCandidate {
  reminder_type: ReminderType
  scheduled_for: Date
}

interface ScheduleResult {
  success: true
  scheduled: number
  createdReminderIds: string[]
  dueNowReminderIds: string[]
  skippedTypes: ReminderType[]
}

interface ScheduleFailure {
  success: false
  error: string
}

type ScheduleBookingRemindersResult = ScheduleResult | ScheduleFailure

function toUtc(date: Date): Date {
  return fromZonedTime(date, LONDON_TZ)
}

function buildEventDate(context: BookingReminderContext): Date {
  // Interpret the stored event date/time in the London timezone
  const eventDateTimeString = `${context.event.date}T${context.event.time}`
  return fromZonedTime(eventDateTimeString, LONDON_TZ)
}

function buildReminderSchedule(
  context: BookingReminderContext,
  now: Date
): ScheduleCandidate[] {
  const hasSeats = (context.seats || 0) > 0
  const candidates: ScheduleCandidate[] = []
  const eventUtc = buildEventDate(context)
  const eventLocal = toZonedTime(eventUtc, LONDON_TZ)

  const seedLocal = (date: Date) => {
    const clone = new Date(date)
    clone.setHours(DEFAULT_SEND_HOUR, 0, 0, 0)
    return clone
  }

  const pushIfFuture = (type: ReminderType, localDate: Date) => {
    const scheduledUtc = toUtc(localDate)
    if (isAfter(scheduledUtc, now)) {
      candidates.push({ reminder_type: type, scheduled_for: scheduledUtc })
    }
  }

  if (hasSeats) {
    // Immediate confirmation is always queued even if event is same day
    candidates.push({ reminder_type: 'booking_confirmation', scheduled_for: now })

    const monthLocal = seedLocal(subMonths(eventLocal, 1))
    pushIfFuture('booked_1_month', monthLocal)

    const weekLocal = seedLocal(subWeeks(eventLocal, 1))
    pushIfFuture('booked_1_week', weekLocal)

    const dayLocal = seedLocal(subDays(eventLocal, 1))
    pushIfFuture('booked_1_day', dayLocal)
  } else {
    const monthLocal = seedLocal(subMonths(eventLocal, 1))
    pushIfFuture('reminder_invite_1_month', monthLocal)

    const weekLocal = seedLocal(subWeeks(eventLocal, 1))
    pushIfFuture('reminder_invite_1_week', weekLocal)

    const dayLocal = seedLocal(subDays(eventLocal, 1))
    pushIfFuture('reminder_invite_1_day', dayLocal)
  }

  return candidates
}

async function fetchBookingReminderContext(bookingId: string): Promise<BookingReminderContext | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      seats,
      event:events(id, name, date, time),
      customer:customers(id, first_name, last_name, mobile_number, sms_opt_in)
    `)
    .eq('id', bookingId)
    .single()

  if (error) {
    logger.error('Failed to load booking context for reminders', {
      error: error as Error,
      metadata: { bookingId }
    })
    return null
  }

  const eventRecord = Array.isArray(data?.event) ? data.event[0] : data?.event
  const customerRecord = Array.isArray(data?.customer) ? data.customer[0] : data?.customer

  if (!eventRecord || !customerRecord) {
    logger.warn('Incomplete booking context for reminders', {
      metadata: { bookingId }
    })
    return null
  }

  return {
    bookingId,
    event: {
      id: eventRecord.id,
      name: eventRecord.name,
      date: eventRecord.date,
      time: eventRecord.time
    },
    customer: {
      id: customerRecord.id,
      first_name: customerRecord.first_name,
      last_name: customerRecord.last_name,
      mobile_number: customerRecord.mobile_number,
      sms_opt_in: customerRecord.sms_opt_in
    },
    seats: data.seats,
  }
}

export async function scheduleBookingReminders(
  bookingId: string,
  options?: { context?: BookingReminderContext; now?: Date }
): Promise<ScheduleBookingRemindersResult> {
  const now = options?.now ?? new Date()
  const context = options?.context ?? await fetchBookingReminderContext(bookingId)

  if (!context) {
    return { success: false, error: 'Missing booking context for reminders' }
  }

  if (!context.customer.mobile_number) {
    return { success: false, error: 'Customer has no mobile number' }
  }

  if (context.customer.sms_opt_in === false) {
    return { success: false, error: 'Customer opted out of SMS reminders' }
  }

  let normalizedPhone: string
  try {
    normalizedPhone = formatPhoneForStorage(context.customer.mobile_number)
  } catch (error) {
    logger.error('Failed to normalize phone number for reminder scheduling', {
      error: error as Error,
      metadata: { bookingId, mobile_number: context.customer.mobile_number }
    })
    return { success: false, error: 'Invalid mobile number for reminders' }
  }

  const supabase = createAdminClient()
  const candidates = buildReminderSchedule(context, now)

  if (candidates.length === 0) {
    logger.info('No reminders to schedule (all cadence points are in the past)', {
      metadata: { bookingId }
    })
    return {
      success: true,
      scheduled: 0,
      createdReminderIds: [],
      dueNowReminderIds: [],
      skippedTypes: []
    }
  }

  const { data: existingRows } = await supabase
    .from('booking_reminders')
    .select('id, reminder_type, status, scheduled_for')
    .eq('booking_id', bookingId)

  const existingMap = new Map<string, { id: string; status: string; scheduled_for: string }>()
  existingRows?.forEach(row => existingMap.set(row.reminder_type, row))

  const toInsert: Array<{ reminder_type: ReminderType; scheduled_for: string }> = []
  const toUpdate: Array<{ id: string; scheduled_for: string }> = []
  const skippedTypes: ReminderType[] = []

  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.reminder_type)
    const iso = candidate.scheduled_for.toISOString()

    if (!existing) {
      toInsert.push({ reminder_type: candidate.reminder_type, scheduled_for: iso })
      continue
    }

    if (existing.status === 'sent') {
      skippedTypes.push(candidate.reminder_type)
      continue
    }

    if (existing.status === 'pending' && existing.scheduled_for !== iso) {
      toUpdate.push({ id: existing.id, scheduled_for: iso })
      continue
    }

    skippedTypes.push(candidate.reminder_type)
  }

  const createdReminderIds: string[] = []
  const dueNowReminderIds: string[] = []

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('booking_reminders')
      .insert(
        toInsert.map(item => ({
          booking_id: bookingId,
          event_id: context.event.id,
          target_phone: normalizedPhone,
          reminder_type: item.reminder_type,
          scheduled_for: item.scheduled_for,
          status: 'pending'
        }))
      )
      .select('id, scheduled_for')

    if (error) {
      logger.error('Failed to insert booking reminders', {
        error: error as Error,
        metadata: { bookingId, inserts: toInsert }
      })
      return { success: false, error: 'Failed to insert reminders' }
    }

    for (const row of data || []) {
      createdReminderIds.push(row.id)
      if (new Date(row.scheduled_for) <= now) {
        dueNowReminderIds.push(row.id)
      }
    }
  }

  if (toUpdate.length > 0) {
    for (const item of toUpdate) {
      const { data, error } = await supabase
        .from('booking_reminders')
        .update({
          scheduled_for: item.scheduled_for,
          status: 'pending',
          event_id: context.event.id,
          target_phone: normalizedPhone
        })
        .eq('id', item.id)
        .select('id, scheduled_for')
        .single()

      if (error) {
        logger.error('Failed to update booking reminder', {
          error: error as Error,
          metadata: { bookingId, updateId: item.id, scheduled_for: item.scheduled_for }
        })
        return { success: false, error: 'Failed to update reminders' }
      }

      if (data && new Date(data.scheduled_for) <= now) {
        dueNowReminderIds.push(data.id)
      }
    }
  }

  const scheduledCount = createdReminderIds.length + toUpdate.length

  logger.info('Booking reminders scheduled', {
    metadata: {
      bookingId,
      created: createdReminderIds.length,
      updated: toUpdate.length,
      skippedTypes
    }
  })

  return {
    success: true,
    scheduled: scheduledCount,
    createdReminderIds,
    dueNowReminderIds,
    skippedTypes
  }
}

export async function scheduleAndProcessBookingReminders(
  bookingId: string,
  options?: { context?: BookingReminderContext; now?: Date }
) {
  const scheduleResult = await scheduleBookingReminders(bookingId, options)

  if (!scheduleResult.success) {
    return scheduleResult
  }

  if (scheduleResult.dueNowReminderIds.length > 0) {
    await processScheduledEventReminders({ reminderIds: scheduleResult.dueNowReminderIds })
  }

  return scheduleResult
}

export async function cancelBookingReminders(
  bookingId: string,
  reminderTypes?: ReminderType[]
) {
  const supabase = createAdminClient()

  try {
    let query = supabase
      .from('booking_reminders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('booking_id', bookingId)
      .eq('status', 'pending')

    if (reminderTypes && reminderTypes.length > 0) {
      query = query.in('reminder_type', reminderTypes)
    }

    const { error, count } = await query.select('id')

    if (error) {
      logger.error('Failed to cancel reminders', {
        error: error as Error,
        metadata: { bookingId, reminderTypes }
      })
      return { error: 'Failed to cancel reminders' }
    }

    logger.info('Reminders cancelled', {
      metadata: { bookingId, cancelled: count }
    })

    return { success: true, cancelled: count || 0 }
  } catch (error) {
    logger.error('Error cancelling reminders', {
      error: error as Error,
      metadata: { bookingId }
    })
    return { error: 'Failed to cancel reminders' }
  }
}

export async function addAttendeesWithScheduledSMS(
  eventId: string,
  customerIds: string[]
) {
  try {
    const supabase = createAdminClient()

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, time')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return { error: 'Event not found' }
    }

    const uniqueCustomerIds = Array.from(new Set(customerIds))

    const { data: existingBookings, error: checkError } = await supabase
      .from('bookings')
      .select('customer_id')
      .eq('event_id', eventId)

    if (checkError) {
      return { error: 'Failed to check existing bookings' }
    }

    const existingCustomerIds = new Set(existingBookings?.map(b => b.customer_id) || [])
    const customersToAdd = uniqueCustomerIds.filter(id => !existingCustomerIds.has(id))

    if (customersToAdd.length === 0) {
      return {
        success: false,
        error: 'All selected customers already have bookings for this event'
      }
    }

    const newBookings = customersToAdd.map(customerId => ({
      event_id: eventId,
      customer_id: customerId,
      seats: 0,
      booking_source: 'bulk_add',
      notes: 'Added via bulk add'
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('bookings')
      .insert(newBookings)
      .select('id')

    if (insertError || !inserted) {
      return { error: 'Failed to create bookings' }
    }

    let scheduledCount = 0
    for (const booking of inserted) {
      const result = await scheduleBookingReminders(booking.id)
      if (result.success) {
        scheduledCount += result.scheduled
        if (result.dueNowReminderIds.length > 0) {
          await processScheduledEventReminders({ reminderIds: result.dueNowReminderIds })
        }
      }
    }

    return {
      success: true,
      added: inserted.length,
      remindersScheduled: scheduledCount,
      skipped: uniqueCustomerIds.length - inserted.length
    }
  } catch (error) {
    logger.error('Error in addAttendeesWithScheduledSMS', {
      error: error as Error,
      metadata: { eventId, customerCount: customerIds.length }
    })
    return { error: 'Failed to add attendees' }
  }
}
