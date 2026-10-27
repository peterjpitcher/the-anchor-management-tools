import { formatTime12Hour } from '@/lib/dateUtils'
import type { TableBookingSheetData } from '@/lib/table-booking-sheet-template'
import type { DayLoadHire } from '@/services/day-load'

/**
 * Private hires on the kitchen's booking sheets (review BK-075). Spec decision D-4 left them off the
 * print sheets, so the kitchen could prepare a Saturday without the buffet on its sheet; the owner
 * approved putting them on (customer bookings review of 24 October 2026). Each hire prints as its
 * own page, in time order with the table bookings, on the same layout: rooms where the table goes,
 * guests where the party size goes, and the catering and kitchen covers as its requirements.
 */
export function privateHireSheet(hire: DayLoadHire, bookingDate: string, generatedAt: string): TableBookingSheetData {
  const start = hire.startTime ? formatTime12Hour(hire.startTime) : 'Time not set'
  const requirements = [
    ...hire.catering,
    ...(hire.kitchen
      ? [`Kitchen: ${hire.kitchen.covers} ${hire.kitchen.covers === 1 ? 'cover' : 'covers'} at ${formatTime12Hour(hire.kitchen.foodTime)}`]
      : []),
  ]
  return {
    bookingRef: `PB-${hire.id.slice(0, 8).toUpperCase()}`,
    customerName: hire.customerName,
    bookingDate,
    startTime: hire.endTime ? `${start} to ${formatTime12Hour(hire.endTime)}` : start,
    partySize: hire.guestCount ? String(hire.guestCount) : 'Not set',
    tableLabel: hire.roomNames.length > 0 ? `Private hire: ${hire.roomNames.join(' and ')}` : 'Private hire: no room booked',
    status: hire.status === 'confirmed' ? 'Private hire, confirmed' : hire.holdsRoom ? 'Private hire, held' : 'Private hire, not confirmed',
    requirements: requirements.length > 0 ? requirements : ['No catering booked'],
    generatedAt,
  }
}

/** Printed when the hires could not be read, so a missing buffet is never a silent gap. */
export function privateHiresNotLoadedSheet(bookingDate: string, generatedAt: string): TableBookingSheetData {
  return {
    bookingRef: 'Private hires',
    customerName: 'Private hires could not be loaded',
    bookingDate,
    startTime: 'Check before service',
    partySize: 'Unknown',
    tableLabel: 'Private hire',
    status: 'Not checked',
    requirements: ['Check the private bookings diary for this date: any hire and its catering is missing from these sheets.'],
    generatedAt,
  }
}

/** The sort key a hire sheet takes among the table bookings ("19:30"; no time sorts first). */
export function privateHireSortTime(hire: Pick<DayLoadHire, 'startTime'>): string {
  return hire.startTime ?? ''
}
