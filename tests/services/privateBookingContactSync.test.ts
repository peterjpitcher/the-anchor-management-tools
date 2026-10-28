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
  return { id, customer_id: CUSTOMER, status: 'confirmed', event_date: '2026-12-05', contact_phone: '+447700900111', contact_email: 'old@example.com', ...extra }
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
  it('finds only upcoming open hires that still carry the old phone or email', async () => {
    expect(await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'OLD@example.com' },
      { phone: '+447700900999', email: 'new@example.com' },
    )).toEqual(['upcoming'])
  })

  it('finds nothing when neither changed', async () => {
    expect(await findUpcomingBookingsWithOldContact(
      CUSTOMER,
      { phone: '07700900111', email: 'old@example.com' },
      { phone: '+447700900111', email: 'old@example.com' },
    )).toEqual([])
  })

  it('copies the new details onto the chosen hires only, with an audit row per field', async () => {
    expect(await copyCustomerContactToBookings({ customerId: CUSTOMER, bookingIds: ['upcoming', 'past'], performedBy: 'user-1' }))
      .toEqual({ updated: 1 })
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
