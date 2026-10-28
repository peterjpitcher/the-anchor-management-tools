import { buildEventArrivalLine } from '@/lib/events/event-when'

/**
 * The day-before event reminder, by text and by email (BK-086, customer bookings review of
 * 24 October 2026; owner decision D14: email first, text only when there is no usable email).
 *
 * It used to say "Your N seats are ready" on every night, including shared-seating nights where the
 * confirmation says there is no reserved table, and never said to bring cash on pay-on-the-night
 * events or what time to arrive. The wording now follows the booking: seats only when a table is
 * held, places on shared or general nights, tickets for standing.
 *
 * Plain ASCII punctuation only: the text stays in GSM-7.
 */

export type EventReminderDayWord = 'today' | 'tomorrow'

export type EventReminderInput = {
  firstName: string
  eventName: string
  /** "Wed 16 Sept, 7:30 pm" for the text; the email passes its own long form. */
  eventDateText: string
  reminderDay: EventReminderDayWord
  seats: number
  /** events.booking_mode: table, communal, general or mixed. Missing reads as table. */
  bookingMode?: string | null
  /** bookings.event_seating_type: seated or standing. */
  seatingType?: string | null
  /** events.payment_mode: free, cash_only or prepaid. */
  paymentMode?: string | null
  /** The price per person on the night, used only when the night is cash only. */
  doorPricePerSeat?: number | null
  /** events.doors_time, e.g. "18:30:00". */
  doorsTime?: string | null
  eventStartIso?: string | null
}

/** "£5" or "£7.50": no pence on a whole-pound price, as the venue writes them. Null for zero. */
export function formatReminderPrice(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  const whole = Math.round(amount * 100) % 100 === 0
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** What the guest holds, in words that match the night. */
export function buildReminderPlaceLine(input: Pick<EventReminderInput, 'seats' | 'bookingMode' | 'seatingType'>): string {
  const seats = Math.max(1, Math.floor(Number(input.seats) || 1))
  if (input.seatingType === 'standing') {
    return seats === 1 ? 'Your standing ticket is booked.' : `Your ${seats} standing tickets are booked.`
  }
  if (input.bookingMode === 'communal') {
    const places = seats === 1 ? 'Your place is booked.' : `Your ${seats} places are booked.`
    return `${places} Seating is shared on the night.`
  }
  if (input.bookingMode === 'general') {
    return seats === 1 ? 'Your place is booked.' : `Your ${seats} places are booked.`
  }
  return seats === 1 ? 'Your seat is ready.' : `Your ${seats} seats are ready.`
}

/** "Bring cash: £5 each." on a pay-on-the-night event with a price, otherwise null. */
export function buildReminderCashLine(input: Pick<EventReminderInput, 'paymentMode' | 'doorPricePerSeat'>): string | null {
  if (input.paymentMode !== 'cash_only') return null
  const price = formatReminderPrice(input.doorPricePerSeat)
  return price ? `Bring cash: ${price} each.` : 'Bring cash to pay on the night.'
}

/** The text body, before the manage link and the reply instruction are added. */
export function buildEventReminderSms(input: EventReminderInput): string {
  const arrival = buildEventArrivalLine({ doorsTime: input.doorsTime, startIso: input.eventStartIso })
  const comeEarly = input.reminderDay === 'tomorrow'
    ? 'Come a bit early tomorrow if you fancy a drink.'
    : 'Come a bit early if you fancy a drink.'
  const parts = [
    `The Anchor: ${input.firstName}, ${input.eventName} is ${input.reminderDay}, ${input.eventDateText}.`,
    buildReminderPlaceLine(input),
    buildReminderCashLine(input),
    arrival ?? comeEarly,
  ]
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}

/** The email's paragraphs, after the greeting. */
export function buildEventReminderEmailLines(input: EventReminderInput): string[] {
  const arrival = buildEventArrivalLine({ doorsTime: input.doorsTime, startIso: input.eventStartIso })
  const lines = [
    `Just a reminder that ${input.eventName} is ${input.reminderDay}, ${input.eventDateText}.`,
    buildReminderPlaceLine(input),
    buildReminderCashLine(input),
    arrival ?? 'Come a bit early if you fancy a drink beforehand.',
  ]
  return lines.filter((line): line is string => Boolean(line))
}
