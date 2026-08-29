import { describe, expect, it } from 'vitest'
import {
  balanceDueToEntry,
  employeeBirthdayToEntry,
  eventToEntry,
  parkingToEntry,
  privateBookingToEntry,
  specialHoursToEntry,
} from '../adapters'

describe('calendar adapter colours', () => {
  it('uses item type colours rather than old or category colours', () => {
    const event = eventToEntry({
      id: 'event-1',
      name: 'Quiz',
      date: '2026-08-28',
      time: '19:00',
      daysUntil: 0,
      bookedSeatsCount: 10,
      category: { id: 'category-1', name: 'Quiz', color: '#EC4899' },
      heroImageUrl: null,
      posterImageUrl: null,
      eventStatus: 'scheduled',
      bookingUrl: null,
      checklist: {
        completed: 0,
        total: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        nextTask: null,
        outstanding: [],
      },
      statusBadge: { label: 'Scheduled', tone: 'success' },
    })
    const privateBooking = privateBookingToEntry({
      id: 'booking-1',
      customer_name: 'Guest',
      event_date: '2026-08-28',
      start_time: '19:00',
      end_time: '22:00',
      end_time_next_day: false,
      status: 'confirmed',
      event_type: null,
      guest_count: 20,
    })
    const balance = balanceDueToEntry({
      id: 'balance-1',
      customer_name: 'Guest',
      balance_due_date: '2026-08-28',
      event_date: '2026-09-01',
      status: 'confirmed',
      total_amount: 100,
    })
    const birthday = employeeBirthdayToEntry({
      employee_id: 'employee-1',
      employee_name: 'Sam',
      occurrence_date: '2026-08-28',
      turning_age: null,
      job_title: null,
    })
    const specialHours = specialHoursToEntry({
      id: 'hours-1',
      date: '2026-08-28',
      opens: null,
      closes: null,
      is_closed: true,
      is_kitchen_closed: true,
      note: null,
    })
    const parking = parkingToEntry({
      id: 'parking-1',
      reference: 'P1',
      customer_first_name: 'Alex',
      customer_last_name: null,
      vehicle_registration: null,
      start_at: '2026-08-28T12:00:00Z',
      end_at: '2026-08-28T14:00:00Z',
      status: 'confirmed',
      payment_status: 'paid',
    })

    expect(event.color).toBe('#1E3A8A')
    expect(privateBooking.color).toBe('#9333EA')
    expect(balance.color).toBe('#F97316')
    expect(birthday.color).toBe('#FACC15')
    expect(specialHours.color).toBe('#111827')
    expect(parking.color).toBe('#16A34A')
  })
})
