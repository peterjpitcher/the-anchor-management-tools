import { createAdminClient } from '@/lib/supabase/server'
import { getActiveParkingRate } from '@/lib/parking/repository'
import type { ParkingAvailabilitySlot, ParkingCapacityCheckResult, ParkingBookingStatus } from '@/types/parking'

export async function checkParkingCapacity(
  startIso: string,
  endIso: string,
  options: { ignoreBookingId?: string } = {}
): Promise<ParkingCapacityCheckResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('check_parking_capacity', {
    p_start: startIso,
    p_end: endIso,
    p_ignore_booking: options.ignoreBookingId ?? null
  })

  if (error) {
    throw new Error(`Failed to check parking capacity: ${error.message}`)
  }

  const result = Array.isArray(data) ? data[0] : data

  if (!result) {
    return { remaining: 0, capacity: 0, active: 0 }
  }

  return {
    remaining: result.remaining ?? 0,
    capacity: result.capacity ?? 0,
    active: result.active ?? 0
  }
}

const DEFAULT_CAPACITY = 10
const ACTIVE_BOOKING_STATUSES: ParkingBookingStatus[] = ['pending_payment', 'confirmed']

type AvailabilityGranularity = 'hour' | 'day'

type BookingInterval = {
  start_at: string
  end_at: string
}

type NormalizedInterval = {
  startMs: number
  endMs: number
}

type SlotBoundary = {
  start: Date
  end: Date
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

function generateSlotBoundaries(start: Date, end: Date, granularity: AvailabilityGranularity): SlotBoundary[] {
  const slots: SlotBoundary[] = []

  if (granularity === 'hour') {
    const cursor = new Date(start)
    cursor.setUTCMinutes(0, 0, 0)

    while (cursor <= end) {
      const slotStart = new Date(cursor)
      const slotEnd = new Date(cursor)
      slotEnd.setUTCHours(slotEnd.getUTCHours() + 1)

      slots.push({ start: slotStart, end: slotEnd })
      cursor.setUTCHours(cursor.getUTCHours() + 1)
    }

    return slots
  }

  const cursor = startOfDay(start)
  while (cursor <= end) {
    const slotStart = startOfDay(cursor)
    const slotEnd = endOfDay(cursor)

    slots.push({ start: slotStart, end: slotEnd })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return slots
}

function normalizeIntervals(bookings: BookingInterval[]): NormalizedInterval[] {
  return bookings
    .map(({ start_at, end_at }) => {
      const startMs = new Date(start_at).getTime()
      const endMs = new Date(end_at).getTime()

      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return null
      }

      return { startMs, endMs }
    })
    .filter((value): value is NormalizedInterval => value !== null)
}

function overlaps(slotStart: number, slotEnd: number, interval: NormalizedInterval): boolean {
  return interval.startMs <= slotEnd && interval.endMs >= slotStart
}

export function buildParkingAvailabilitySlots(
  startDate: Date,
  endDate: Date,
  granularity: AvailabilityGranularity,
  bookings: BookingInterval[],
  capacity: number
): ParkingAvailabilitySlot[] {
  const slotBoundaries = generateSlotBoundaries(startDate, endDate, granularity)
  const normalizedBookings = normalizeIntervals(bookings)

  return slotBoundaries.map(({ start, end }) => {
    const slotStartMs = start.getTime()
    const slotEndMs = end.getTime()

    const reserved = normalizedBookings.reduce((count, interval) => {
      return overlaps(slotStartMs, slotEndMs, interval) ? count + 1 : count
    }, 0)

    const remaining = capacity - reserved

    return {
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      reserved,
      remaining,
      capacity
    }
  })
}

export async function getParkingAvailabilitySlots(
  startDate: Date,
  endDate: Date,
  granularity: AvailabilityGranularity
): Promise<ParkingAvailabilitySlot[]> {
  const supabase = createAdminClient()

  const [activeRate, bookingsResponse] = await Promise.all([
    getActiveParkingRate(supabase),
    supabase
      .from('parking_bookings')
      .select('start_at,end_at')
      .in('status', ACTIVE_BOOKING_STATUSES as string[])
      .lte('start_at', endDate.toISOString())
      .gte('end_at', startDate.toISOString())
  ])

  if (bookingsResponse.error) {
    throw new Error(`Failed to load parking bookings for availability: ${bookingsResponse.error.message}`)
  }

  const capacity = activeRate?.capacity_override ?? DEFAULT_CAPACITY
  const bookings = (bookingsResponse.data ?? []) as BookingInterval[]

  return buildParkingAvailabilitySlots(startDate, endDate, granularity, bookings, capacity)
}
