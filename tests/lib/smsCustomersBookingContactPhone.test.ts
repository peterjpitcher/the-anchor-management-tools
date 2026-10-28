// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { resolveCustomerIdForSms } from '@/lib/sms/customers'

/**
 * BK-163: a private booking's texts go to its contact phone. When that is not the linked
 * customer's mobile, every deposit, balance and final-details text used to be refused with no
 * visible error. The contact phone is now treated as checked, and the consent that counts is that
 * number's own: whoever holds it.
 */

const BOOKER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PARTNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function booking(contactPhone: string) {
  return {
    id: 'booking-1',
    customer_id: BOOKER,
    contact_phone: contactPhone,
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_email: 'alex@example.com',
  }
}

const booker = { id: BOOKER, first_name: 'Alex', last_name: 'Smith', email: 'alex@example.com', mobile_e164: '+447700900111', mobile_number: '+447700900111' }

describe('resolving the customer for a private booking text', () => {
  it('uses the booking customer when the contact phone is their mobile', async () => {
    const db = createFakeDb({ private_bookings: [booking('07700900111')], customers: [booker] })
    expect(await resolveCustomerIdForSms(db.client as never, { bookingId: 'booking-1', customerId: BOOKER, to: '07700900111' }))
      .toEqual({ customerId: BOOKER })
  })

  it("texts the booking's number under the customer who holds it when it is not the booker's", async () => {
    const partner = { id: PARTNER, first_name: 'Jo', last_name: 'Smith', email: null, mobile_e164: '+447700900222', mobile_number: '+447700900222' }
    const db = createFakeDb({ private_bookings: [booking('07700900222')], customers: [booker, partner] })

    expect(await resolveCustomerIdForSms(db.client as never, { bookingId: 'booking-1', customerId: BOOKER, to: '07700900222' }))
      .toEqual({ customerId: PARTNER })
    // The booking keeps its customer.
    expect(db.rows('private_bookings')[0].customer_id).toBe(BOOKER)
  })

  it("records the number as a customer when nobody holds it yet, without the booker's email", async () => {
    const db = createFakeDb({ private_bookings: [booking('07700900333')], customers: [booker] })

    const result = await resolveCustomerIdForSms(db.client as never, { bookingId: 'booking-1', customerId: BOOKER, to: '07700900333' })

    expect(result.resolutionError).toBeUndefined()
    expect(result.customerId).not.toBe(BOOKER)
    const created = db.rows('customers').find((row) => row.id === result.customerId)
    expect(created).toMatchObject({ mobile_e164: '+447700900333' })
    expect(created?.email ?? null).toBeNull()
  })

  it('still refuses a destination that is not the booking contact phone', async () => {
    const db = createFakeDb({ private_bookings: [booking('07700900222')], customers: [booker] })
    expect(await resolveCustomerIdForSms(db.client as never, { bookingId: 'booking-1', to: '07700900999' }))
      .toEqual({ customerId: null, resolutionError: 'booking_phone_mismatch' })
  })
})
