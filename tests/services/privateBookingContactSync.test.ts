// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/** BK-163: upcoming hires keep the old phone and email after the customer's change, until staff say. */

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))

import {
  contactPhoneDiffersNote,
  copyCustomerContactToBookings,
  findUpcomingBookingsWithOldContact,
} from '@/services/private-bookings/contact-sync'

const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let db: FakeDb

function hire(id: string, extra: Record<string, unknown> = {}) {
  return { id, customer_id: CUSTOMER, status: 'confirmed', event_date: '2026-12-05', date_tbd: false, contact_phone: '+447700900111', contact_email: 'old@example.com', ...extra }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'))
  db = createFakeDb({
    customers: [{ id: CUSTOMER, mobile_e164: '+447700900999', mobile_number: '07700900999', email: 'new@example.com' }],
    private_bookings: [
      hire('upcoming'),
      hire('other-number', { contact_phone: '+447700900555', contact_email: 'someone@example.com' }),
      hire('past', { event_date: '2026-10-01' }),
      hire('cancelled', { status: 'cancelled' }),
    ],
    private_booking_audit: [],
  })
  state.client = db.client
})

afterEach(() => {
  vi.useRealTimers()
})

describe('private booking contact details after a customer change', () => {
  it('finds only open hires still on the old details, with the fields that match', async () => {
    expect(await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'OLD@example.com' },
      { phone: '+447700900999', email: 'new@example.com' },
    )).toEqual([{ bookingId: 'upcoming', fields: ['contact_phone', 'contact_email'] }])
  })

  it('finds nothing when neither changed', async () => {
    expect(await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'old@example.com' },
      { phone: '+447700900111', email: 'old@example.com' },
    )).toEqual([])
  })

  it('includes a hire whose date is still to be confirmed, whatever its placeholder date', async () => {
    db.rows('private_bookings').push(hire('undated', { event_date: '2026-10-01', date_tbd: true }))
    const offers = await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: null },
      { phone: '+447700900999', email: null },
    )
    expect(offers.map((offer) => offer.bookingId).sort()).toEqual(['undated', 'upcoming'])
  })

  it('a phone-only change offers, and changes, the phone only: the organiser email stays', async () => {
    db.rows('private_bookings').push(hire('organiser', { contact_email: 'organiser@example.com' }))
    const offers = await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'old@example.com' },
      { phone: '+447700900999', email: 'old@example.com' },
    )
    expect(offers).toEqual([
      { bookingId: 'upcoming', fields: ['contact_phone'] },
      { bookingId: 'organiser', fields: ['contact_phone'] },
    ])

    await copyCustomerContactToBookings({ customerId: CUSTOMER, offers, performedBy: 'user-1' })

    const rows = Object.fromEntries(db.rows('private_bookings').map((row) => [row.id, row]))
    expect(rows.organiser).toMatchObject({ contact_phone: '+447700900999', contact_email: 'organiser@example.com' })
  })

  it('an email-only change offers, and changes, the email only: a booking-specific phone stays', async () => {
    db.rows('private_bookings').push(hire('own-phone', { contact_phone: '+447700900777' }))
    const offers = await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'old@example.com' },
      { phone: '07700900111', email: 'new@example.com' },
    )
    expect(offers).toContainEqual({ bookingId: 'own-phone', fields: ['contact_email'] })

    await copyCustomerContactToBookings({ customerId: CUSTOMER, offers, performedBy: 'user-1' })

    const rows = Object.fromEntries(db.rows('private_bookings').map((row) => [row.id, row]))
    expect(rows['own-phone']).toMatchObject({ contact_phone: '+447700900777', contact_email: 'new@example.com' })
  })

  it('copies a cleared email onto the chosen hires, as no email', async () => {
    db.rows('customers')[0].email = null
    const offers = await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '+447700900999', email: 'old@example.com' },
      { phone: '+447700900999', email: null },
    )
    expect(offers).toEqual([{ bookingId: 'upcoming', fields: ['contact_email'] }])

    expect(await copyCustomerContactToBookings({ customerId: CUSTOMER, offers, performedBy: 'user-1' })).toEqual({ updated: 1 })

    const rows = Object.fromEntries(db.rows('private_bookings').map((row) => [row.id, row]))
    expect(rows.upcoming).toMatchObject({ contact_phone: '+447700900111', contact_email: null })
    expect(db.rows('private_booking_audit').map((row) => [row.field_name, row.old_value, row.new_value])).toEqual([
      ['contact_email', 'old@example.com', ''],
    ])
  })

  it('copies only the offered fields of the offered, open, upcoming hires, with an audit row per field', async () => {
    expect(await copyCustomerContactToBookings({
      customerId: CUSTOMER,
      offers: [
        { bookingId: 'upcoming', fields: ['contact_phone', 'contact_email'] },
        { bookingId: 'past', fields: ['contact_phone'] },
      ],
      performedBy: 'user-1',
    })).toEqual({ updated: 1 })
    const rows = Object.fromEntries(db.rows('private_bookings').map((row) => [row.id, row]))
    expect(rows.upcoming).toMatchObject({ contact_phone: '+447700900999', contact_email: 'new@example.com' })
    expect(rows.past).toMatchObject({ contact_phone: '+447700900111' })
    expect(db.rows('private_booking_audit').map((row) => [row.booking_id, row.field_name, row.old_value, row.new_value])).toEqual([
      ['upcoming', 'contact_phone', '+447700900111', '+447700900999'],
      ['upcoming', 'contact_email', 'old@example.com', 'new@example.com'],
    ])
  })

  it('notes a booking whose contact phone is not the customer mobile', async () => {
    db = createFakeDb({
      customers: [{ id: CUSTOMER, mobile_e164: '+447700900999', mobile_number: null }],
      private_bookings: [{ ...hire('upcoming'), customer: { mobile_e164: '+447700900999', mobile_number: null } }],
    })
    state.client = db.client
    expect(await contactPhoneDiffersNote('upcoming')).toContain('not the mobile on the customer record')
  })
})
