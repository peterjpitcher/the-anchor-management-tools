import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * BK-030 and BK-031, customer bookings review of 24 October 2026.
 *
 * The printed booking sheets included bookings whose payment hold had lapsed and labelled them
 * "Paid online" on a prepaid night, the guest list PDF showed confirmed bookings only, and the
 * event page counted something else again: three answers to "who is coming tonight". All three
 * now use isOnDoorList, and the sheets read the payments ledger for the payment line.
 */

const captured = vi.hoisted(() => ({ sheets: [] as Array<Record<string, unknown>>, groups: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'staff-1', email: 'staff@example.com' } } })) } })),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: vi.fn(async () => Buffer.from('%PDF')) }))
vi.mock('@/lib/pdf/anchor-logo', () => ({ getAnchorLogoDataUri: () => undefined, ANCHOR_LOGO_ASPECT_RATIO: 2 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readFile = vi.fn(async () => Buffer.from('png'))
  return { ...actual, readFile, default: { ...actual, readFile } }
})
vi.mock('@/lib/event-booking-sheet-template', () => ({
  generateEventBookingSheetsHTML: vi.fn((sheets: Array<Record<string, unknown>>) => { captured.sheets = sheets; return '<html></html>' }),
}))
vi.mock('@/lib/events/guest-list-pdf', () => ({
  generateEventGuestListPdf: vi.fn(async (_header: unknown, groups: Array<Record<string, unknown>>) => { captured.groups = groups; return Buffer.from('%PDF') }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET as bookingSheets } from '@/app/api/events/[id]/booking-sheets/route'
import { GET as guestList } from '@/app/api/events/[id]/guest-list/route'
import { isOnDoorList } from '@/lib/events/door-list'
import { FakeDb } from '../lib/insights/helpers/fake-db'

const EVENT_ID = 'e0000000-0000-4000-8000-000000000001'
const customer = (first: string) => ({ first_name: first, last_name: 'Guest', mobile_number: '+447700900000' })
const booking = (id: string, first: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, event_id: EVENT_ID, seats: 2, status, notes: null, attendee_names: null, attendees: [], is_reminder_only: false,
  event_seating_type: 'seated', created_at: `2026-10-0${id.slice(-1)}T10:00:00Z`, customer: customer(first), ...extra,
})

const BOOKINGS = [
  booking('b1', 'Paid', 'confirmed'),
  booking('b2', 'Waiting', 'pending_payment'),
  booking('b3', 'Lapsed', 'expired'),
  booking('b4', 'Cancelled', 'cancelled'),
  booking('b5', 'Afterwards', 'completed'),
  booking('b6', 'Reminder', 'confirmed', { is_reminder_only: true }),
]

function setup() {
  const db = new FakeDb({
    events: [{
      id: EVENT_ID, name: 'Tasting night', date: '2099-11-20', time: '19:00', slug: 'tasting', performer_name: null, performer_type: null,
      payment_mode: 'prepaid', is_free: false, price: 45, price_per_seat: 45, online_discount_type: null, online_discount_value: null,
      online_discount_ends_at: null, booking_mode: 'communal',
    }],
    bookings: BOOKINGS,
    payments: [
      { event_booking_id: 'b1', charge_type: 'prepaid_event', status: 'succeeded', payment_method: 'paypal', amount: 90 },
      { event_booking_id: 'b3', charge_type: 'prepaid_event', status: 'failed', payment_method: 'paypal', amount: 90 },
      { event_booking_id: 'b5', charge_type: 'prepaid_event', status: 'succeeded', payment_method: 'cash', amount: 90 },
    ],
    table_bookings: [],
    booking_table_assignments: [],
    event_communal_seat_allocations: [],
    menu_dishes_with_costs: [],
  })
  vi.mocked(createAdminClient).mockReturnValue(db.asDb() as never)
}

const context = { params: Promise.resolve({ id: EVENT_ID }) }
const request = (path: string) => new NextRequest(`https://management.orangejelly.co.uk/api/events/${EVENT_ID}/${path}`)

beforeEach(() => {
  vi.clearAllMocks()
  captured.sheets = []
  captured.groups = []
  setup()
})

describe('event door lists', () => {
  it('leaves a lapsed payment hold off the booking sheets instead of printing it as paid', async () => {
    expect((await bookingSheets(request('booking-sheets'), context)).status).toBe(200)
    const names = captured.sheets.map((sheet) => sheet.customerName)
    expect(names).not.toContain('Lapsed Guest')
    expect(names).not.toContain('Cancelled Guest')
  })

  it('takes the payment line from the payments ledger', async () => {
    await bookingSheets(request('booking-sheets'), context)
    const byName = Object.fromEntries(captured.sheets.map((sheet) => [sheet.customerName, sheet.paymentMethod]))
    expect(byName).toEqual({
      'Paid Guest': 'Paid online',
      'Waiting Guest': 'Not paid yet: £90.00 due',
      'Afterwards Guest': 'Paid in cash',
    })
  })

  it('agrees with the guest list and the event page on who is coming', async () => {
    await bookingSheets(request('booking-sheets'), context)
    expect((await guestList(request('guest-list'), context)).status).toBe(200)
    const sheetNames = captured.sheets.map((sheet) => sheet.customerName).sort()
    const listNames = captured.groups.map((group) => group.bookerName).sort()
    const pageNames = BOOKINGS.filter(isOnDoorList).map((row) => `${row.customer.first_name} ${row.customer.last_name}`).sort()
    expect(sheetNames).toEqual(['Afterwards Guest', 'Paid Guest', 'Waiting Guest'])
    expect(listNames).toEqual(sheetNames)
    expect(pageNames).toEqual(sheetNames)
  })

  it('tells the door which guest-list booking still has money to take', async () => {
    await guestList(request('guest-list'), context)
    const notes = Object.fromEntries(captured.groups.map((group) => [group.bookerName, group.paymentNote]))
    expect(notes).toEqual({ 'Paid Guest': null, 'Waiting Guest': 'Not paid yet: £90.00 due', 'Afterwards Guest': null })
  })
})

// Owner decision D9 (BK-027, BK-036): a price change applies to new sales only, so a guest who
// booked a pay-on-the-door night at £10 is charged £10 on the door sheet after the price rises.
describe('door sheet price for a pay-on-the-door booking', () => {
  it('charges the price the guest booked at, not the price the ticket costs now', async () => {
    const db = new FakeDb({
      events: [{
        id: EVENT_ID, name: 'Quiz night', date: '2099-11-20', time: '19:00', slug: 'quiz', performer_name: null, performer_type: null,
        payment_mode: 'cash_only', is_free: false, price: 12, price_per_seat: 12, online_discount_type: null, online_discount_value: null,
        online_discount_ends_at: null, booking_mode: 'general',
      }],
      bookings: [booking('b1', 'Early', 'confirmed'), booking('b2', 'Legacy', 'confirmed')],
      booking_items: [{ id: 'i1', booking_id: 'b1', ticket_type_id: 't1', quantity: 2, unit_price: 10, attendee_names: [], ticket_type: { name: 'Standard', sort_order: 0 } }],
      payments: [],
      table_bookings: [],
      booking_table_assignments: [],
      event_communal_seat_allocations: [],
      menu_dishes_with_costs: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(db.asDb() as never)
    await bookingSheets(request('booking-sheets'), context)
    const byName = Object.fromEntries(captured.sheets.map((sheet) => [sheet.customerName, [sheet.price, sheet.priceNote]]))
    expect(byName['Early Guest']).toEqual(['£20.00', 'Event price: £10.00 per person · 2 guests'])
    // A booking with no line falls back to the event price, as before.
    expect(byName['Legacy Guest']).toEqual(['£24.00', 'Event price: £12.00 per person · 2 guests'])
  })
})
