import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanRender, assertCleanText } from '../mocks/emailRenderChecks'

/**
 * Every text and email whose link comes from getAppUrl() (src/lib/env.ts), rendered with fixture
 * data the way the guest or manager receives it. The app URL is given a trailing slash on purpose:
 * each link must still come out as one clean absolute URL on the app's own host, and nothing may
 * read undefined, NaN, Invalid Date or localhost.
 */

// Set before any import, so env.ts validates this value rather than the suite default.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.test/'
})

const APP_URL = 'https://management.example.test'

vi.mock('@/lib/guest/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest/tokens')>()),
  createGuestToken: vi.fn(async () => ({ rawToken: 'guest-token', hashedToken: 'guest-token-hash' })),
  generateGuestToken: vi.fn(() => 'capture-token'),
}))

vi.mock('@/lib/twilio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/twilio')>()),
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/email/emailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/emailService')>()),
  sendEmail: vi.fn(),
}))

// Guest emails shorten their links. Record what each short link would point at instead of
// writing one, so the long URL a guest lands on can be checked too.
vi.mock('@/services/short-links', () => ({
  ShortLinkService: { createShortLinkInternal: vi.fn() },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getAppUrl } from '@/lib/env'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { ShortLinkService } from '@/services/short-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createEventManageToken } from '@/lib/events/manage-booking'
import {
  createEventPaymentToken,
  sendEventBookingSeatUpdateSms,
  sendEventPaymentConfirmationSms,
  sendEventPaymentRetrySms,
} from '@/lib/events/event-payments'
import { sendWaitlistOfferSms } from '@/lib/events/waitlist-offers'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentLinkEmail,
  sendEventTicketTransferredEmail,
} from '@/lib/email/event-ticket-emails'
import { createBookingConfirmToken, createTableManageToken } from '@/lib/table-bookings/manage-booking'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import { sendEmailCaptureSms } from '@/lib/sms/email-capture'
import { requestOpenShift } from '@/app/actions/rota'

type Db = Parameters<typeof createEventManageToken>[0]
type Row = Record<string, unknown>

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'order', 'limit',
]

/**
 * A Supabase stand-in. Every read of a table answers with that table's fixture row (as a list of
 * one for list reads) and every write succeeds. Filters are ignored: each case seeds only the rows
 * its sender reads.
 */
function fixtureDb(tables: Record<string, Row | null>, rpcs: Record<string, unknown> = {}): Db {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from(table: string) {
      const row = tables[table] ?? null
      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: row, error: null }),
        single: async () => ({ data: row, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
  } as unknown as Db
}

function sentText(): string {
  const calls = vi.mocked(sendSMS).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][1] as string
}

function sentEmail(): { subject: string; html: string; text: string } {
  const calls = vi.mocked(sendEmail).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0] as { subject: string; html: string; text: string }
}

/** The long URL behind each short link the guest was sent. */
function shortLinkDestinations(): string[] {
  return vi.mocked(ShortLinkService.createShortLinkInternal).mock.calls.map(
    ([input]) => (input as { destination_url: string }).destination_url
  )
}

/** A link on the app's own host: never localhost, never a doubled slash after the host. */
function expectAppLink(text: string, path: string): void {
  expect(text).toContain(`${APP_URL}${path}`)
  expect(text).not.toMatch(/localhost|management\.example\.test\/\//)
}

const NOW = new Date('2026-10-01T10:00:00.000Z')
const HOLD_EXPIRES_AT = '2026-10-02T10:00:00.000Z'
const TABLE_START = '2026-10-04T12:00:00.000Z'
const BOOKING_ID = '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70'
const SHIFT_ID = '9b1d2c3e-4f50-4a6b-8c7d-0e1f2a3b4c5d'

/** Quiz Night on Wednesday 7 October 2026: arrive from 6:30pm for 7pm, £10 a seat online. */
const EVENT: Row = {
  id: 'event-1',
  name: 'Quiz Night',
  event_type: 'quiz',
  start_datetime: '2026-10-07T18:00:00.000Z',
  date: '2026-10-07',
  time: '19:00:00',
  doors_time: '18:30:00',
  booking_url: null,
  booking_mode: 'table',
  payment_mode: 'prepaid',
  price: 10,
  price_per_seat: 10,
  is_free: false,
  online_discount_type: null,
  online_discount_value: null,
  online_discount_ends_at: null,
  promo_sms_enabled: true,
  category: { name: 'Quiz Night', slug: 'quiz-night' },
}

const CUSTOMER: Row = {
  id: 'customer-1',
  first_name: 'Pat',
  mobile_number: '+447700900123',
  sms_status: 'active',
  email: 'pat@example.com',
  email_status: 'active',
  email_deactivated_at: null,
}

function eventBooking(status: 'pending_payment' | 'confirmed'): Row {
  return {
    id: BOOKING_ID,
    customer_id: 'customer-1',
    event_id: 'event-1',
    seats: 2,
    status,
    hold_expires_at: HOLD_EXPIRES_AT,
    event_seating_type: 'seated',
    attendee_names: [],
    customers: CUSTOMER,
    events: EVENT,
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1', messageId: 'message-1' } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
  vi.mocked(ShortLinkService.createShortLinkInternal).mockResolvedValue({
    short_code: 'abc123',
    full_url: 'https://l.the-anchor.pub/abc123',
  } as never)
})

describe('guest links built from the app URL', () => {
  it('puts every guest link on the app URL when the caller passes none', async () => {
    const db = fixtureDb({})

    const links = [
      (await createEventManageToken(db, { customerId: 'customer-1', bookingId: BOOKING_ID, eventStartIso: EVENT.start_datetime as string })).url,
      (await createEventPaymentToken(db, { customerId: 'customer-1', bookingId: BOOKING_ID, holdExpiresAt: HOLD_EXPIRES_AT })).url,
      (await createTableManageToken(db, { customerId: 'customer-1', tableBookingId: 'table-1', bookingStartIso: TABLE_START })).url,
      (await createBookingConfirmToken(db, { customerId: 'customer-1', tableBookingId: 'table-1', bookingStartIso: TABLE_START })).url,
      (await createSundayPreorderToken(db, { customerId: 'customer-1', tableBookingId: 'table-1', bookingStartIso: TABLE_START })).url,
      (await createTablePaymentToken(db, { customerId: 'customer-1', tableBookingId: 'table-1', holdExpiresAt: HOLD_EXPIRES_AT })).url,
    ]

    expect(links).toEqual([
      `${APP_URL}/g/guest-token/manage-booking`,
      `${APP_URL}/g/guest-token/event-payment`,
      `${APP_URL}/g/guest-token/table-manage`,
      `${APP_URL}/g/guest-token/confirm-booking`,
      `${APP_URL}/g/guest-token/sunday-preorder`,
      `${APP_URL}/g/guest-token/table-payment`,
    ])
  })
})

describe('texts carrying an app link', () => {
  it('email capture ask', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({}, {
        get_email_capture_audience: [
          { customer_id: 'customer-1', first_name: 'Pat', phone_number: '+447700900123', last_activity_on: '2026-08-01' },
        ],
      }) as never
    )

    const result = await sendEmailCaptureSms({ maxRecipients: 1, dryRun: false })

    expect(result.sent).toBe(1)
    const body = sentText()
    expectAppLink(body, '/g/capture-token/email-capture')
    assertCleanText(body)
  })

  it('event payment retry, as the payment reminder cron sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('pending_payment'), customers: CUSTOMER, events: EVENT })

    await sendEventPaymentRetrySms(db, { bookingId: BOOKING_ID, appBaseUrl: getAppUrl() })

    const body = sentText()
    expectAppLink(body, '/g/guest-token/event-payment')
    assertCleanText(body)
  })

  it('event payment confirmation, as the staff payment action sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('confirmed'), customers: CUSTOMER })

    await sendEventPaymentConfirmationSms(db, {
      bookingId: BOOKING_ID,
      eventName: 'Quiz Night',
      seats: 2,
      appBaseUrl: getAppUrl(),
    })

    const body = sentText()
    expectAppLink(body, '/g/guest-token/manage-booking')
    assertCleanText(body)
  })

  it('event seat change, as the staff seat update sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('confirmed'), customers: CUSTOMER, events: EVENT })

    await sendEventBookingSeatUpdateSms(db, {
      bookingId: BOOKING_ID,
      eventName: 'Quiz Night',
      oldSeats: 2,
      newSeats: 4,
      appBaseUrl: getAppUrl(),
    })

    const body = sentText()
    expectAppLink(body, '/g/guest-token/manage-booking')
    assertCleanText(body)
  })

  it('waitlist offer, as the waitlist cron sends it', async () => {
    const db = fixtureDb({ customers: CUSTOMER, events: EVENT, waitlist_offers: { id: 'offer-1' } })

    await sendWaitlistOfferSms(
      db,
      {
        state: 'offered',
        waitlist_offer_id: 'offer-1',
        waitlist_entry_id: 'entry-1',
        event_id: 'event-1',
        customer_id: 'customer-1',
        requested_seats: 2,
        event_start_datetime: EVENT.start_datetime as string,
      },
      getAppUrl()
    )

    const body = sentText()
    expectAppLink(body, '/g/guest-token/waitlist-offer')
    assertCleanText(body)
  })
})

describe('emails carrying an app link', () => {
  it('event payment reminder, as the payment reminder cron sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('pending_payment'), email_messages: null })
    const token = await createEventPaymentToken(db, {
      customerId: 'customer-1',
      bookingId: BOOKING_ID,
      holdExpiresAt: HOLD_EXPIRES_AT,
      appBaseUrl: getAppUrl(),
    })

    await sendEventPaymentLinkEmail(db, {
      bookingId: BOOKING_ID,
      paymentLink: token.url,
      holdExpiresAt: HOLD_EXPIRES_AT,
      reminder: true,
    })

    expect(shortLinkDestinations()).toEqual([`${APP_URL}/g/guest-token/event-payment`])
    const email = sentEmail()
    expect(email.html).toContain('https://l.the-anchor.pub/abc123')
    assertCleanRender(email)
  })

  it('event payment confirmation, as the staff payment action sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('confirmed'), email_messages: null })

    await sendEventPaymentConfirmationEmail(db, {
      bookingId: BOOKING_ID,
      amount: 20,
      currency: 'GBP',
      appBaseUrl: getAppUrl(),
    })

    expect(shortLinkDestinations()).toEqual([`${APP_URL}/g/guest-token/manage-booking`])
    const email = sentEmail()
    expect(email.html).toContain('https://l.the-anchor.pub/abc123')
    assertCleanRender(email)
  })

  it('event ticket transfer, as the staff transfer sends it', async () => {
    const db = fixtureDb({ bookings: eventBooking('confirmed'), email_messages: null })

    await sendEventTicketTransferredEmail(db, {
      bookingId: BOOKING_ID,
      fromEventName: 'Quiz Night',
      toEventName: 'Quiz Night',
      fromEventStartIso: '2026-09-16T18:00:00.000Z',
      eventStartIso: EVENT.start_datetime as string,
      appBaseUrl: getAppUrl(),
    })

    expect(shortLinkDestinations()).toEqual([`${APP_URL}/g/guest-token/manage-booking`])
    const email = sentEmail()
    expect(email.html).toContain('https://l.the-anchor.pub/abc123')
    assertCleanRender(email)
  })

  it('open shift request to the rota manager', async () => {
    const shift: Row = {
      id: SHIFT_ID,
      employee_id: null,
      shift_date: '2026-10-03',
      start_time: '17:00:00',
      end_time: '23:00:00',
      unpaid_break_minutes: 0,
      department: 'bar',
      is_overnight: false,
      name: 'Evening bar',
      is_open_shift: true,
      status: 'scheduled',
      employees: null,
    }
    vi.mocked(createClient).mockResolvedValue(
      fixtureDb({
        employees: {
          employee_id: 'employee-1',
          first_name: 'Sam',
          last_name: 'Taylor',
          preferred_name: null,
          email_address: 'sam@example.com',
        },
      }) as never
    )
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        rota_published_shifts: shift,
        rota_open_shift_requests: {
          id: 'request-1',
          shift_id: SHIFT_ID,
          employee_id: 'employee-1',
          note: 'Happy to cover',
          status: 'pending',
          requested_at: '2026-10-01T10:00:00.000Z',
        },
        system_settings: { value: 'manager@example.com' },
      }) as never
    )

    const result = await requestOpenShift({ shiftId: SHIFT_ID, note: 'Happy to cover' })

    expect(result.success).toBe(true)
    const email = sentEmail()
    expectAppLink(email.html, '/api/rota/open-shift-requests/approve?token=')
    expectAppLink(email.html, `/rota?week=2026-10-03&amp;shift=${SHIFT_ID}`)
    expect(email.html).not.toMatch(/undefined|Invalid Date|NaN/)
  })
})
