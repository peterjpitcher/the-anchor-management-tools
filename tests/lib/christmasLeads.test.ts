import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'

/**
 * Unfinished Christmas dinner bookings, "leads" (Christmas funnel spec, owner decisions 5 and 6):
 * saving the website's details step, the resume link, linking a lead to the booking it became,
 * a lapsed Christmas hold becoming a lead, and the opt-out link. Run against the in-memory fake
 * database, with the real phone, token and date helpers.
 */

const { logError, logWarn, logInfo } = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: logWarn, info: logInfo } }))

import { CHRISTMAS_PERIOD, leadsDb } from '../helpers/christmasLeadsDb'
import {
  buildResumeUrl,
  findChristmasBookingHolders,
  issueLapsedHoldLead,
  linkLeadToBooking,
  optOutLeadByToken,
  readResumeLink,
  saveWebsiteLead,
  type WebsiteLeadInput,
} from '@/lib/table-bookings/christmas-leads'

const LEAD_REF = '0b7c6f4e-2f5a-4d7e-9a51-6f1d2c3b4a59'

// 07700 900123 is an Ofcom drama number: it can never belong to a real person.
const INPUT: WebsiteLeadInput = {
  lead_ref: LEAD_REF,
  first_name: 'Sam',
  last_name: 'Example',
  email: 'Sam@Example.com',
  phone: '07700 900123',
  default_country_code: '44',
  booking_date: '2026-12-15',
  booking_time: '12:00',
  party_size: 12,
  follow_up_opt_out: false,
  purpose: 'christmas',
}


const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const RAW_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveWebsiteLead', () => {
  it('saves the details with the phone in E.164 and the email in lower case', async () => {
    const { fake, client } = leadsDb()

    const result = await saveWebsiteLead(client, INPUT, '2026-11-10')

    expect(result).toEqual({ ok: true, leadRef: LEAD_REF })
    expect(fake.rows('table_booking_leads')).toEqual([
      expect.objectContaining({
        lead_ref: LEAD_REF,
        source: 'website',
        booking_period_id: CHRISTMAS_PERIOD.id,
        first_name: 'Sam',
        last_name: 'Example',
        email: 'sam@example.com',
        mobile_e164: '+447700900123',
        booking_date: '2026-12-15',
        booking_time: '12:00',
        party_size: 12,
        follow_up_opt_out: false,
      }),
    ])
  })

  it('updates the same row when the same lead_ref is posted again', async () => {
    const { fake, client } = leadsDb()

    await saveWebsiteLead(client, INPUT, '2026-11-10')
    await saveWebsiteLead(client, { ...INPUT, party_size: 14, follow_up_opt_out: true }, '2026-11-10')

    expect(fake.rows('table_booking_leads')).toHaveLength(1)
    expect(fake.rows('table_booking_leads')[0]).toEqual(expect.objectContaining({ party_size: 14, follow_up_opt_out: true }))
  })

  it('links an existing customer by mobile, and never creates one', async () => {
    const { fake, client } = leadsDb({
      customers: [{ id: 'customer-1', mobile_e164: '+447700900123', email: 'other@example.com', merged_into_customer_id: null }],
    })

    await saveWebsiteLead(client, INPUT, '2026-11-10')

    expect(fake.rows('table_booking_leads')[0].customer_id).toBe('customer-1')
    expect(fake.rows('customers')).toHaveLength(1)
  })

  it.each([
    ['a date that has passed', { booking_date: '2026-11-09' }, 'That date has passed.'],
    ['a date outside the Christmas period', { booking_date: '2026-12-27' }, 'That date is not in the Christmas booking period.'],
    ['a party under the minimum', { party_size: 3 }, 'That party size cannot be booked for Christmas dinner.'],
    ['a party over the maximum', { party_size: 61 }, 'That party size cannot be booked for Christmas dinner.'],
    ['a phone number that cannot be read', { phone: 'not a phone' }, 'That phone number does not look right.'],
  ])('refuses %s, and saves nothing', async (_label, change, message) => {
    const { fake, client } = leadsDb()

    const result = await saveWebsiteLead(client, { ...INPUT, ...change }, '2026-11-10')

    expect(result).toEqual({ ok: false, code: 'VALIDATION_ERROR', message })
    expect(fake.rows('table_booking_leads')).toEqual([])
  })

  it('throws when the database cannot be written, so the route fails closed', async () => {
    const { fake, client } = leadsDb()
    fake.failNext({ table: 'table_booking_leads', operation: 'insert', message: 'connection reset' })

    await expect(saveWebsiteLead(client, INPUT, '2026-11-10')).rejects.toEqual(expect.objectContaining({ message: 'connection reset' }))
  })
})

describe('readResumeLink', () => {
  const lead = {
    id: 'lead-1',
    source: 'website',
    first_name: 'Sam',
    last_name: 'Example',
    email: 'sam@example.com',
    mobile_e164: '+447700900123',
    booking_date: '2026-12-15',
    booking_time: '12:00:00',
    party_size: 12,
    resume_token_hash: sha256(RAW_TOKEN),
    // The end of 15 December, London time (GMT).
    resume_token_expires_at: '2026-12-15T23:59:59.000Z',
  }

  it('gives back the details for a valid token', async () => {
    const { client } = leadsDb({ table_booking_leads: [lead] })

    const result = await readResumeLink(client, RAW_TOKEN, new Date('2026-11-21T10:00:00Z'))

    expect(result).toEqual({
      state: 'ok',
      data: {
        first_name: 'Sam',
        last_name: 'Example',
        email: 'sam@example.com',
        phone: '+447700900123',
        booking_date: '2026-12-15',
        booking_time: '12:00',
        party_size: 12,
        purpose: 'christmas',
      },
    })
  })

  it('answers invalid for a token nobody issued, or one that is not a token at all', async () => {
    const { client } = leadsDb({ table_booking_leads: [lead] })
    const now = new Date('2026-11-21T10:00:00Z')

    expect(await readResumeLink(client, RAW_TOKEN.replace('A', 'B'), now)).toEqual({ state: 'invalid' })
    expect(await readResumeLink(client, 'short', now)).toEqual({ state: 'invalid' })
  })

  it('answers invalid once the chosen date has ended', async () => {
    const { client } = leadsDb({ table_booking_leads: [lead] })

    expect(await readResumeLink(client, RAW_TOKEN, new Date('2026-12-16T00:00:00Z'))).toEqual({ state: 'invalid' })
  })

  it('builds the website link with the token in the fragment, never the query string', () => {
    expect(buildResumeUrl(RAW_TOKEN)).toBe(`https://www.the-anchor.pub/book-table?christmas=1#resume=${RAW_TOKEN}`)
  })
})

describe('linkLeadToBooking', () => {
  it('links the website lead to the booking it became', async () => {
    const { fake, client } = leadsDb({ table_booking_leads: [{ id: 'lead-1', lead_ref: LEAD_REF, source: 'website', table_booking_id: null }] })

    expect(await linkLeadToBooking(client, { leadRef: LEAD_REF, tableBookingId: 'booking-1' })).toBe('linked')
    expect(fake.rows('table_booking_leads')[0].table_booking_id).toBe('booking-1')
  })

  it('answers not_found for a lead_ref with no lead', async () => {
    const { client } = leadsDb()

    expect(await linkLeadToBooking(client, { leadRef: LEAD_REF, tableBookingId: 'booking-1' })).toBe('not_found')
  })

  it('logs a failed link and never throws', async () => {
    const { fake, client } = leadsDb({ table_booking_leads: [{ id: 'lead-1', lead_ref: LEAD_REF, source: 'website' }] })
    fake.failNext({ table: 'table_booking_leads', operation: 'update', message: 'deadlock detected' })

    expect(await linkLeadToBooking(client, { leadRef: LEAD_REF, tableBookingId: 'booking-1' })).toBe('failed')
    expect(logError).toHaveBeenCalledWith(
      'Christmas lead could not be linked to its booking; the booking is unaffected',
      expect.objectContaining({ metadata: expect.objectContaining({ tableBookingId: 'booking-1', message: 'deadlock detected' }) }),
    )
  })
})

describe('issueLapsedHoldLead', () => {
  const customer = { id: 'customer-1', first_name: 'Sam', last_name: 'Example', email: 'sam@example.com', mobile_e164: '+447700900123' }
  const christmasBooking = {
    id: 'booking-1',
    booking_type: 'christmas',
    booking_date: '2026-12-15',
    booking_time: '12:00:00',
    party_size: 12,
    customer_id: 'customer-1',
    contact_email: null,
    booking_period_id: CHRISTMAS_PERIOD.id,
  }

  it('saves a lapsed Christmas hold as a lead and gives back a working Finish my booking link', async () => {
    const { fake, client } = leadsDb({ table_bookings: [christmasBooking], customers: [customer] })
    const now = new Date('2026-11-20T12:00:00Z')

    const result = await issueLapsedHoldLead(client, { tableBookingId: 'booking-1', now })

    expect(result.outcome).toBe('issued')
    expect(result.finishUrl).toBe(buildResumeUrl(result.rawToken as string))
    expect(fake.rows('table_booking_leads')).toEqual([
      expect.objectContaining({
        source: 'lapsed_hold',
        table_booking_id: 'booking-1',
        customer_id: 'customer-1',
        first_name: 'Sam',
        email: 'sam@example.com',
        mobile_e164: '+447700900123',
        booking_date: '2026-12-15',
        booking_time: '12:00',
        party_size: 12,
        resume_token_hash: sha256(result.rawToken as string),
        resume_token_expires_at: '2026-12-15T23:59:59.000Z',
      }),
    ])
    // The link it gives back is one the resume endpoint accepts.
    expect((await readResumeLink(client, result.rawToken as string, now)).state).toBe('ok')
  })

  it('does nothing for a booking that is not a Christmas booking', async () => {
    const { fake, client } = leadsDb({ table_bookings: [{ ...christmasBooking, booking_type: 'regular' }], customers: [customer] })

    const result = await issueLapsedHoldLead(client, { tableBookingId: 'booking-1', now: new Date('2026-11-20T12:00:00Z') })

    expect(result).toEqual({ finishUrl: null, rawToken: null, outcome: 'not_christmas' })
    expect(fake.rows('table_booking_leads')).toEqual([])
  })

  it('saves the lead for staff but gives no link when the date can no longer be booked online', async () => {
    const { fake, client } = leadsDb({ table_bookings: [{ ...christmasBooking, booking_date: '2026-11-25' }], customers: [customer] })

    const result = await issueLapsedHoldLead(client, { tableBookingId: 'booking-1', now: new Date('2026-11-20T12:00:00Z') })

    expect(result).toEqual({ finishUrl: null, rawToken: null, outcome: 'not_bookable_online' })
    expect(fake.rows('table_booking_leads')).toHaveLength(1)
  })

  it('logs a fault and gives no link, never throwing', async () => {
    const { fake, client } = leadsDb({ table_bookings: [christmasBooking], customers: [customer] })
    fake.failNext({ table: 'table_booking_leads', operation: 'insert', message: 'disk full' })

    const result = await issueLapsedHoldLead(client, { tableBookingId: 'booking-1', now: new Date('2026-11-20T12:00:00Z') })

    expect(result).toEqual({ finishUrl: null, rawToken: null, outcome: 'failed' })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logError.mock.calls)).not.toContain('sam@example.com')
  })
})

describe('findChristmasBookingHolders', () => {
  it('finds a live Christmas booking by the customer record or by the email typed for it, and ignores a cancelled one', async () => {
    const { client } = leadsDb({
      customers: [
        { id: 'customer-1', email: 'booked@example.com', mobile_e164: '+447700900001' },
        { id: 'customer-2', email: 'cancelled@example.com', mobile_e164: '+447700900002' },
      ],
      table_bookings: [
        { id: 'b1', customer_id: 'customer-1', contact_email: null, booking_type: 'christmas', status: 'confirmed', booking_date: '2026-12-11' },
        { id: 'b2', customer_id: 'customer-2', contact_email: null, booking_type: 'christmas', status: 'cancelled', booking_date: '2026-12-11' },
        { id: 'b3', customer_id: null, contact_email: 'typed@example.com', booking_type: 'christmas', status: 'pending_payment', booking_date: '2026-12-12' },
        { id: 'b4', customer_id: null, contact_email: 'regular@example.com', booking_type: 'regular', status: 'confirmed', booking_date: '2026-12-12' },
      ],
    })

    const holders = await findChristmasBookingHolders(
      client,
      [
        { email: 'booked@example.com', mobile: null },
        { email: 'cancelled@example.com', mobile: '+447700900002' },
        { email: 'typed@example.com', mobile: null },
        { email: 'regular@example.com', mobile: null },
      ],
      { startsOn: '2026-11-10', endsOn: '2026-12-20' },
    )

    expect(Array.from(holders.emails).sort()).toEqual(['booked@example.com', 'typed@example.com'])
    expect(Array.from(holders.mobiles)).toEqual(['+447700900001'])
  })
})

describe('optOutLeadByToken', () => {
  it('opts out the lead and every other website lead with the same email', async () => {
    const { fake, client } = leadsDb({
      table_booking_leads: [
        { id: 'lead-1', source: 'website', email: 'sam@example.com', opt_out_token_hash: sha256(RAW_TOKEN), follow_up_opt_out: false },
        { id: 'lead-2', source: 'website', email: 'sam@example.com', follow_up_opt_out: false },
        { id: 'lead-3', source: 'website', email: 'other@example.com', follow_up_opt_out: false },
      ],
    })

    expect(await optOutLeadByToken(client, RAW_TOKEN)).toBe('opted_out')
    expect(fake.rows('table_booking_leads').map((row) => [row.id, row.follow_up_opt_out])).toEqual([
      ['lead-1', true],
      ['lead-2', true],
      ['lead-3', false],
    ])
  })

  it('answers not_found for a token nobody issued, and changes nothing', async () => {
    const { fake, client } = leadsDb({ table_booking_leads: [{ id: 'lead-1', source: 'website', email: 'sam@example.com', follow_up_opt_out: false }] })

    expect(await optOutLeadByToken(client, RAW_TOKEN)).toBe('not_found')
    expect(fake.writes.filter((write) => write.ids.length > 0)).toEqual([])
  })
})
