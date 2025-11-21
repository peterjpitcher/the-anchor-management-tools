import { ReminderType } from '@/app/actions/event-sms-scheduler'
import { formatTime12Hour } from '@/lib/dateUtils'
import { smsTemplates } from '@/lib/smsTemplates';

export type ReminderRow = {
  id: string
  reminder_type: ReminderType
  scheduled_for: string
  target_phone: string | null
  event_id: string | null
  booking: {
    id: string
    seats: number | null
    customer: {
      id: string
      first_name: string
      last_name: string | null
      mobile_number: string | null
      sms_opt_in: boolean | null
    } | null
    event: {
      id: string
      name: string
      date: string
      time: string
    } | null
  } | null
}

export function normalizeReminderRow(raw: any): ReminderRow {
  const bookingRecord = Array.isArray(raw?.booking) ? raw.booking[0] : raw?.booking
  const customerRecord = Array.isArray(bookingRecord?.customer) ? bookingRecord.customer[0] : bookingRecord?.customer
  const eventRecord = Array.isArray(bookingRecord?.event) ? bookingRecord.event[0] : bookingRecord?.event

  return {
    id: raw?.id,
    reminder_type: raw?.reminder_type,
    scheduled_for: raw?.scheduled_for,
    target_phone: raw?.target_phone ?? null,
    event_id: raw?.event_id ?? null,
    booking: bookingRecord
      ? {
          id: bookingRecord.id,
          seats: bookingRecord.seats ?? null,
          customer: customerRecord
            ? {
                id: customerRecord.id,
                first_name: customerRecord.first_name,
                last_name: customerRecord.last_name ?? null,
                mobile_number: customerRecord.mobile_number ?? null,
                sms_opt_in: customerRecord.sms_opt_in ?? null
              }
            : null,
          event: eventRecord
            ? {
                id: eventRecord.id,
                name: eventRecord.name,
                date: eventRecord.date,
                time: eventRecord.time
              }
            : null
        }
      : null
  }
}

export function buildReminderTemplate(reminder: ReminderRow): string {
  const booking = reminder.booking
  if (!booking?.event || !booking.customer) {
    return ''
  }

  const eventDate = booking.event.date
  const common = {
    firstName: booking.customer.first_name,
    eventName: booking.event.name,
    eventDate,
    eventTime: booking.event.time ? formatTime12Hour(booking.event.time) : 'TBC',
    seats: booking.seats || 0
  }

  switch (reminder.reminder_type) {
    case 'booking_confirmation':
      return smsTemplates.bookingConfirmationNew({
        ...common,
        seats: common.seats || 0
      })
    case 'booked_1_month':
      return smsTemplates.bookedOneMonth(common)
    case 'booked_1_week':
      return smsTemplates.bookedOneWeek(common)
    case 'booked_1_day':
      return smsTemplates.bookedOneDay(common)
    case 'reminder_invite_1_month':
      return smsTemplates.reminderInviteOneMonth(common)
    case 'reminder_invite_1_week':
      return smsTemplates.reminderInviteOneWeek(common)
    case 'reminder_invite_1_day':
      return smsTemplates.reminderInviteOneDay(common)
    case 'no_seats_2_weeks':
      return smsTemplates.noSeats2Weeks(common)
    case 'no_seats_1_week':
      return smsTemplates.noSeats1Week(common)
    case 'no_seats_day_before':
      return smsTemplates.noSeatsDayBefore(common)
    default:
      return ''
  }
}
