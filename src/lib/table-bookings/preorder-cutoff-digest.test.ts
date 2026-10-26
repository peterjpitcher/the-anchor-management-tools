import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
// logAuditEvent is reached through preorder-alerts' module graph only; never called here.
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { createFakeSupabase } from '../../../tests/helpers/fakeSupabase'
import { assertCleanRender, expectedLongDate } from '../../../tests/mocks/emailRenderChecks'
import { formatDateFull } from '@/lib/dateUtils'
import { PREORDER_MANAGER_EMAIL } from './preorder-alerts'
import { buildTableBookingPreorderChoicesEmail } from './guest-emails'
import { datesLockedRecently, sendPreorderCutoffDigests } from './preorder-cutoff-digest'

/**
 * BK-149: when a date's pre-order form locks at noon, the kitchen is emailed that date's order
 * (dish and tier totals plus anything still incomplete) and, while the flag is on, each booker gets
 * a copy of their choices. Once each, with no guest names or dietary notes in either.
 */

const NAME = 'Fixture Seat Name'
const NOTE = 'Fixture dietary note'
// 3 November 2026, just after noon: the form for 10 November locks now.
const NOW = new Date('2026-11-03T12:00:30.000Z')

function day() {
  return createFakeSupabase(
    {
      booking_periods: [{ id: 'p-1', preorder_cutoff_days: 7 }],
      table_bookings: [
        {
          id: 'b-1', booking_reference: 'TB-FIX1', booking_date: '2026-11-10', booking_time: '19:00:00',
          start_datetime: '2026-11-10T19:00:00.000Z', party_size: 4, status: 'confirmed', customer_id: 'cust-1',
          booking_type: 'christmas', booking_period_id: 'p-1', booking_period_name: 'Christmas dinner 2026',
          booking_period_answer: true, booking_period_requires_preorder: true, christmas_course_counts: [3, 2, 1, 1],
          allergies: [],
        },
        {
          id: 'b-2', booking_reference: 'TB-FIX2', booking_date: '2026-11-10', booking_time: '20:00:00',
          start_datetime: '2026-11-10T20:00:00.000Z', party_size: 4, status: 'confirmed', customer_id: 'cust-2',
          booking_type: 'christmas', booking_period_id: 'p-1', booking_period_name: 'Christmas dinner 2026',
          booking_period_answer: true, booking_period_requires_preorder: false, christmas_course_counts: [1, 1, 1, 1],
          allergies: [],
        },
      ],
      booking_preorder_covers: [
        { id: 'c-1', table_booking_id: 'b-1', ordinal: 1, guest_name: NAME, dietary_note: NOTE, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
        { id: 'c-2', table_booking_id: 'b-1', ordinal: 2, guest_name: null, dietary_note: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
        { id: 'c-3', table_booking_id: 'b-1', ordinal: 3, guest_name: null, dietary_note: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
        { id: 'c-4', table_booking_id: 'b-1', ordinal: 4, guest_name: null, dietary_note: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      ],
      booking_preorder_selections: [
        { id: 's-1', cover_id: 'c-1', course: 'starter', menu_item_id: 'i-starter', item_name: 'Fixture starter', price_gbp: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
        { id: 's-2', cover_id: 'c-1', course: 'main', menu_item_id: 'i-main', item_name: 'Fixture main', price_gbp: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
        { id: 's-3', cover_id: 'c-2', course: 'main', menu_item_id: 'i-main', item_name: 'Fixture main', price_gbp: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      ],
      booking_period_menu_items: [
        { id: 'i-starter', is_active: true },
        { id: 'i-main', is_active: true },
      ],
      customers: [
        { id: 'cust-1', first_name: 'Alex', email: 'alex@example.com', email_status: 'valid', email_deactivated_at: null },
        { id: 'cust-2', first_name: 'Sam', email: null, email_status: null, email_deactivated_at: null },
      ],
      system_settings: [],
    },
    { unique: { idempotency_keys: (row) => row.key } },
  )
}

function sentEmails() {
  return mocks.sendEmail.mock.calls.map((call) => call[0] as { to: string; subject: string; html: string; text: string })
}

describe('datesLockedRecently', () => {
  it('names the date whose form locked today, and yesterday as a catch-up', () => {
    expect(datesLockedRecently({ todayIso: '2026-11-03', cutoffDays: [7], now: NOW })).toEqual(['2026-11-09', '2026-11-10'])
  })

  it('leaves out a date whose form has not locked yet', () => {
    // An hour before noon on 3 November, 10 November is still open.
    const before = new Date('2026-11-03T11:00:00.000Z')
    expect(datesLockedRecently({ todayIso: '2026-11-03', cutoffDays: [7], now: before })).toEqual(['2026-11-09'])
  })
})

describe('sendPreorderCutoffDigests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendEmail.mockResolvedValue({ success: true })
  })

  it('emails the kitchen the order for the date that locked, once', async () => {
    const db = day()

    const first = await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: false, now: NOW })
    const second = await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: false, now: NOW })

    expect(first).toEqual({ kitchenEmails: 1, choiceCopies: 0, failed: 0 })
    expect(second).toEqual({ kitchenEmails: 0, choiceCopies: 0, failed: 0 })
    const [kitchen] = sentEmails()
    expect(kitchen.to).toBe(PREORDER_MANAGER_EMAIL)
    expect(kitchen.subject).toBe(`Kitchen order: food choices for ${formatDateFull('2026-11-10')}`)
    expect(kitchen.text).toContain('Christmas guests: 8 (1 on 3 courses, 1 on 2 courses, 6 on 1 course choosing on the day).')
    expect(kitchen.text).toContain('Main: Fixture main x2')
    expect(kitchen.text).toContain('Starter: Fixture starter x1')
    // b-1 is incomplete: seat 1 owes a dessert, seat 2 a starter or a dessert.
    expect(kitchen.text).toContain('TB-FIX1 (party of 4): Seat 1 (3 courses) needs a dessert. Seat 2 (2 courses) needs a starter or a dessert.')
    for (const value of [kitchen.html, kitchen.text]) {
      expect(value).not.toContain(NAME)
      expect(value).not.toContain(NOTE)
      expect(value).not.toMatch(/undefined|NaN|Invalid Date/)
    }
  })

  it('sends each booker with a usable address a copy of their choices while the flag is on, once', async () => {
    const db = day()

    const first = await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: true, now: NOW })
    await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: true, now: NOW })

    // b-2 is all 1 course, so it owes no pre-order and gets no copy; b-1's booker has an address.
    expect(first.choiceCopies).toBe(1)
    const copies = sentEmails().filter((email) => email.to === 'alex@example.com')
    expect(copies).toHaveLength(1)
    const [copy] = copies
    assertCleanRender(copy)
    expect(copy.subject).toBe(`Your Christmas dinner 2026 food choices for ${expectedLongDate('2026-11-10')}`)
    expect(copy.text).toContain('Seat 1, 3 courses: Starter: Fixture starter. Main: Fixture main.')
    expect(copy.text).toContain('Seat 3, 1 course: chosen on the day.')
    expect(copy.text).toContain('Some choices are still missing.')
    expect(copy.html).not.toContain(NAME)
    expect(copy.html).not.toContain(NOTE)
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ commType: 'table_booking_preorder_copy', idempotencyKey: 'preorder:choices-copy:b-1' }),
    )
  })

  it('sends no booker copy while the flag is off', async () => {
    await sendPreorderCutoffDigests(day() as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: false, now: NOW })

    expect(sentEmails().some((email) => email.to === 'alex@example.com')).toBe(false)
  })

  it('lets the next run try again when the kitchen email fails', async () => {
    const db = day()
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' })

    const first = await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: false, now: NOW })
    const second = await sendPreorderCutoffDigests(db as never, { todayIso: '2026-11-03', cutoffDays: [7], choicesCopyEnabled: false, now: NOW })

    expect(first.failed).toBe(1)
    expect(second.kitchenEmails).toBe(1)
  })
})

describe('buildTableBookingPreorderChoicesEmail', () => {
  it('renders cleanly with every kind of seat', () => {
    const email = buildTableBookingPreorderChoicesEmail({
      firstName: 'Alex',
      bookingReference: 'TB-FIX1',
      bookingDate: '2026-12-12',
      bookingTime: '19:30:00',
      partySize: 4,
      periodName: 'Christmas dinner 2026',
      complete: true,
      addonNote: 'Add-ons are extras on top of your meal. You pay for them on your bill at the pub on the day, not now.',
      seats: [
        { ordinal: 1, courseCount: 3, courses: [{ courseLabel: 'Starter', itemName: 'Soup' }, { courseLabel: 'Main', itemName: 'Turkey' }, { courseLabel: 'Dessert', itemName: 'Pudding' }], addons: ['Cheeseboard'] },
        { ordinal: 2, courseCount: 2, courses: [{ courseLabel: 'Main', itemName: 'Beef', withdrawn: true }, { courseLabel: 'Dessert', itemName: 'Pudding' }], addons: [] },
        { ordinal: 3, courseCount: 1, courses: [], addons: [] },
        { ordinal: 4, courseCount: null, courses: [{ courseLabel: 'Main', itemName: 'Nut roast' }], addons: [] },
      ],
    })

    assertCleanRender(email)
    expect(email.text).toContain(`Hi Alex, here is a copy of the food choices for your booking at The Anchor on ${expectedLongDate('2026-12-12')} at 7:30pm (reference TB-FIX1).`)
    expect(email.text).toContain('Seat 1, 3 courses: Starter: Soup. Main: Turkey. Dessert: Pudding. Add-ons: Cheeseboard.')
    expect(email.text).toContain('Seat 2, 2 courses: Main: Beef (no longer on the menu, please ring us to choose again). Dessert: Pudding.')
    expect(email.text).toContain('Seat 3, 1 course: chosen on the day.')
    expect(email.text).toContain('Seat 4: Main: Nut roast.')
    expect(email.text).toContain('You pay for them on your bill at the pub on the day, not now.')
    expect(email.text).not.toContain('Some choices are still missing')
  })
})
