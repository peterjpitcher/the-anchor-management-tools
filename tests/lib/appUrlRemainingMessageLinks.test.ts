import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanRender, assertCleanText } from '../mocks/emailRenderChecks'

/**
 * The remaining messages whose links, or App URL rows, now come from getAppUrl() (src/lib/env.ts),
 * rendered with fixture data through the real code and captured at the transport. The app URL is
 * given a trailing slash on purpose: every link must still come out as one clean absolute URL on
 * the app's own host, and nothing may read undefined, NaN, Invalid Date, null, a zero amount or
 * localhost.
 */

// Set before any import, so env.ts validates this value rather than the suite default.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.test/'
})

const APP_URL = 'https://management.example.test'

// A fixed guest token, so every guest link can be checked exactly.
vi.mock('@/lib/guest/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest/tokens')>()),
  createGuestToken: vi.fn(),
}))

vi.mock('@/lib/twilio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/twilio')>()),
  sendSMS: vi.fn(),
}))

// A full stand-in rather than a partial one: loading the real module reaches cron/alerting through
// Microsoft Graph, which would then hold the real sendEmail instead of this one.
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

// Guest emails shorten their links. Record what each short link would point at instead of
// writing one, so the long URL a guest lands on can be checked too.
vi.mock('@/services/short-links', () => ({
  ShortLinkService: { createShortLinkInternal: vi.fn() },
}))

// A new event booking also updates the Pub Ops Google calendar, which is not a message.
vi.mock('@/lib/google-calendar-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/google-calendar-events')>()),
  syncPubOpsEventCalendarByEventId: vi.fn(async () => ({ state: 'skipped' })),
}))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getAppUrl } from '@/lib/env'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { createGuestToken } from '@/lib/guest/tokens'
import { ShortLinkService } from '@/services/short-links'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { generateBookingToken, verifyBookingToken } from '@/lib/private-bookings/booking-token'
import {
  buildBookingConfirmedMessageEmail,
  buildDepositReminderEmail,
  buildHoldExtendedEmail,
  buildPrivateBookingCreatedEmail,
  sendBookingConfirmationEmail,
} from '@/lib/email/private-booking-emails'
import { loadPrivateBookingMessageContext } from '@/lib/private-bookings/message-context'
import { renderPrivateBookingMessage, type CatalogueBooking } from '@/lib/private-bookings/message-catalogue'
import {
  PRIVATE_BOOKINGS_MANAGER_EMAIL,
  sendManagerPrivateBookingCreatedEmail,
  sendPrivateBookingOutcomeEmail,
} from '@/lib/private-bookings/manager-notifications'
import { dispatchEventRescheduleNotifications } from '@/lib/events/reschedule-notifications'
import { GET as runRotaUnfilledUrgent } from '@/app/api/cron/rota-unfilled-urgent/route'
import {
  buildHolidayDecisionEmailHtml,
  buildHolidaySubmittedEmailHtml,
  buildOpenShiftRequestManagerEmailHtml,
  buildRotaChangeEmailHtml,
  buildShiftAutoAcceptWarningEmailHtml,
  buildShiftRejectedManagerEmailHtml,
  buildStaffRotaEmailHtml,
  type PortalShiftEmailSummary,
  type ShiftSummary,
} from '@/lib/rota/email-templates'
import { reportCronFailure } from '@/lib/cron/alerting'
import { sendBillingRunAlert } from '@/lib/oj-projects/billing-alerts'
import { handleReplyToBook } from '@/lib/sms/reply-to-book'
import { EventBookingService } from '@/services/event-bookings'

type Db = ReturnType<typeof createAdminClient>
type Row = Record<string, unknown>
/** A table's fixture: its rows, or a function of the selected columns for a table read two ways. */
type Seed = Row | Row[] | null | ((columns: string) => Row | Row[] | null)
type SentEmail = { to: unknown; subject: string; text?: string; html?: string }
type EmailParts = { subject: string; text?: string; html?: string }

const CHAIN_METHODS = [
  'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte', 'or', 'contains', 'order', 'limit',
]

/**
 * A Supabase stand-in. A list read of a table answers with its fixture rows, a single read with
 * the first of them, and every write succeeds. Filters are ignored: each case seeds only the rows
 * its sender reads.
 */
function fixtureDb(tables: Record<string, Seed>, rpcs: Record<string, unknown> = {}): Db {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from(table: string) {
      let columns = ''
      const rows = (): Row[] => {
        const seed = tables[table] ?? null
        const value = typeof seed === 'function' ? seed(columns) : seed
        return value === null ? [] : Array.isArray(value) ? value : [value]
      }
      const builder: Record<string, unknown> = {
        select: (selected?: string) => {
          columns = selected ?? ''
          return builder
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      }
      for (const method of CHAIN_METHODS) builder[method] = () => builder
      return builder
    },
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
  } as unknown as Db
}

function cronRequest(path: string): Request {
  return new Request(`http://cron.internal${path}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
}

function sentEmails(): SentEmail[] {
  return vi.mocked(sendEmail).mock.calls.map(([options]) => options as SentEmail)
}

function onlyEmail(): SentEmail {
  const emails = sentEmails()
  expect(emails).toHaveLength(1)
  return emails[0]
}

function sentTexts(): Array<{ to: string; body: string }> {
  return vi.mocked(sendSMS).mock.calls.map(([to, body]) => ({ to: to as string, body: body as string }))
}

/** The long URL behind each short link the guest was sent. */
function shortLinkDestinations(): string[] {
  return vi.mocked(ShortLinkService.createShortLinkInternal).mock.calls.map(
    ([input]) => (input as { destination_url: string }).destination_url
  )
}

/** Every distinct link on the app's own host, in the order each first appears. */
function appLinksIn(body: string): string[] {
  const links = body.match(/https?:\/\/[^\s"'<>]+/g) ?? []
  return [...new Set(links.filter((link) => link.startsWith(APP_URL)))]
}

function expectNoBadLinks(body: string): void {
  expect(body).not.toMatch(/localhost|undefined|management\.example\.test\/\//)
}

/** No broken values or banned dashes anywhere, and no link off the app's host or with a doubled slash. */
function expectCleanEmail(email: EmailParts): void {
  assertCleanText(email.subject)
  for (const body of [email.text, email.html]) {
    if (body === undefined) continue
    assertCleanText(body)
    expectNoBadLinks(body)
  }
}

// Thursday 1 October 2026, 11am in London.
const NOW = new Date('2026-10-01T10:00:00.000Z')


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
  booking_mode: 'general',
  payment_mode: 'prepaid',
  price: 10,
  price_per_seat: 10,
  is_free: false,
  online_discount_type: null,
  online_discount_value: null,
  online_discount_ends_at: null,
  category: { name: 'Quiz Night', slug: 'quiz-night' },
}

const CUSTOMER: Row = {
  id: 'customer-1',
  first_name: 'Pat',
  last_name: 'Taylor',
  mobile_number: '+447700900123',
  mobile_e164: '+447700900123',
  sms_status: 'active',
  email: 'pat@example.com',
  email_status: 'active',
  email_deactivated_at: null,
}

function eventBooking(id: string, event: Row): Row {
  return {
    id,
    customer_id: 'customer-1',
    event_id: 'event-1',
    seats: 2,
    status: 'confirmed',
    event_seating_type: 'seated',
    attendee_names: [],
    customers: CUSTOMER,
    events: event,
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
  vi.stubEnv('PRIVATE_BOOKING_TOKEN_SECRET', 'fixture-private-booking-secret')
  vi.stubEnv('NEXT_PUBLIC_CONTACT_PHONE_NUMBER', '01753 682707')
  vi.mocked(createGuestToken).mockImplementation(async () => ({
    rawToken: 'guest-token',
    hashedToken: 'guest-token-hash',
  }))
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1', messageId: 'message-1' } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' } as never)
  vi.mocked(ShortLinkService.createShortLinkInternal).mockResolvedValue({
    short_code: 'abc123',
    full_url: 'https://l.the-anchor.pub/abc123',
  } as never)
  vi.mocked(logAuditEvent).mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('reads the app URL without its trailing slash', () => {
  expect(getAppUrl()).toBe(APP_URL)
})

describe('private booking guest portal link', () => {
  const BOOKING_ID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'
  const PORTAL_PREFIX = `${APP_URL}/booking-portal/`

  // A birthday party for 40 on Saturday 14 November 2026, 7pm to 11:30pm: a £250 deposit is due by
  // Thursday 8 October, and the event comes to £1,440.
  const BOOKING: CatalogueBooking = {
    id: BOOKING_ID,
    status: 'draft',
    customer_id: 'customer-2',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900456',
    contact_email: 'alex@example.com',
    event_type: 'Birthday party',
    event_date: '2026-11-14',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-10-08T10:00:00.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    balance_due_date: '2026-10-31',
    final_payment_date: null,
    setup_date: null,
    setup_time: null,
  }

  /** The guest's booking page, signed now: the token is fixed while the clock is. */
  function portalLink(): string {
    return `${PORTAL_PREFIX}${generateBookingToken(BOOKING_ID)}`
  }

  /** The body carries exactly one app link, the booking page, and its token opens this booking. */
  function expectPortalLinkOnly(body: string): void {
    expect(appLinksIn(body)).toEqual([portalLink()])
    const token = appLinksIn(body)[0].slice(PORTAL_PREFIX.length)
    expect(verifyBookingToken(token)).toBe(BOOKING_ID)
  }

  // Private booking emails skip assertCleanRender: they end with the SOP small print, not the
  // sign-off (see tests/lib/privateBookingLegacyEmails.fixtures.test.ts).
  it('provisional hold email, sent while the deposit is due', async () => {
    await sendBookingConfirmationEmail({
      id: BOOKING_ID,
      customer_id: 'customer-2',
      contact_email: 'alex@example.com',
      customer_first_name: 'Alex',
      customer_last_name: 'Smith',
      customer_name: 'Alex Smith',
      event_date: '2026-11-14',
      event_type: 'Birthday party',
      start_time: '19:00:00',
      end_time: '23:30:00',
      end_time_next_day: false,
      guest_count: 40,
      deposit_amount: 250,
      total_amount: 1440,
      hold_expiry: '2026-10-08T10:00:00.000Z',
      deposit_paid_date: null,
      deposit_waived: false,
      date_tbd: false,
      internal_notes: null,
    })

    const email = onlyEmail()
    expect(email.to).toBe('alex@example.com')
    expect(email.subject).toContain('Provisional booking hold: Birthday party on')
    expect(email.subject).toContain('14 November 2026')
    expect(email.text).toContain(`Open your booking and pay the deposit: ${portalLink()}`)
    expect(email.text).toContain('Deposit due: £250.00')
    expect(email.html).toContain(`<a href="${portalLink()}"`)
    expectPortalLinkOnly(email.text ?? '')
    expectPortalLinkOnly(email.html ?? '')
    expectCleanEmail(email)
  })

  it('every deposit email that falls back to the booking page carries it', () => {
    const emails = {
      pencilledIn: buildPrivateBookingCreatedEmail({
        booking: BOOKING,
        firstName: 'Alex',
        depositAmount: 250,
        holdExpiry: '8 October 2026',
      }),
      depositReminder: buildDepositReminderEmail({
        booking: BOOKING,
        firstName: 'Alex',
        stage: '3day',
        depositAmount: 250,
        holdExpiry: '8 October 2026',
      }),
      holdExtended: buildHoldExtendedEmail({
        booking: BOOKING,
        firstName: 'Alex',
        newExpiryDate: '15 October 2026',
      }),
      provisionalHold: buildBookingConfirmedMessageEmail({
        booking: BOOKING,
        firstName: 'Alex',
        depositState: 'due',
        depositAmount: 250,
        holdExpiry: BOOKING.hold_expiry,
        totalAmount: 1440,
        now: NOW,
      }),
    }

    for (const email of Object.values(emails)) {
      expect(email.text).toContain(`Pay the deposit by PayPal: ${portalLink()}`)
      expect(email.html).toContain(`<a href="${portalLink()}"`)
      expectPortalLinkOnly(email.text)
      expectPortalLinkOnly(email.html)
      expectCleanEmail(email)
    }
  })

  it('deposit request text and email, as Send Now and the bounce fallback rebuild them', async () => {
    const context = await loadPrivateBookingMessageContext({
      client: fixtureDb({ private_bookings: BOOKING }),
      bookingId: BOOKING_ID,
      triggerType: 'deposit_request',
      now: NOW,
    })

    expect(context?.paymentLink).toBe(portalLink())
    const message = renderPrivateBookingMessage('deposit_request', context!)
    expect(message?.templateKey).toBe('private_booking_deposit_request')

    const text = message!.smsBody
    expect(text).toContain('£250')
    expect(text.endsWith(` ${portalLink()}`)).toBe(true)
    expectPortalLinkOnly(text)
    assertCleanText(text)
    expectNoBadLinks(text)

    const email = message!.email!()
    expect(email.text).toContain(`Pay the deposit by PayPal: ${portalLink()}`)
    expectPortalLinkOnly(email.text)
    expectPortalLinkOnly(email.html)
    expectCleanEmail(email)
  })

  it('deposit reminder email, as Send Now rebuilds it from the booking', async () => {
    const context = await loadPrivateBookingMessageContext({
      client: fixtureDb({ private_bookings: BOOKING }),
      bookingId: BOOKING_ID,
      triggerType: 'deposit_reminder_7day',
      now: NOW,
    })

    const message = renderPrivateBookingMessage('deposit_reminder_7day', context!)
    // The reminder text carries no link; its email version does.
    expect(appLinksIn(message!.smsBody)).toEqual([])
    assertCleanText(message!.smsBody)

    const email = message!.email!()
    expect(email.text).toContain(`Pay the deposit by PayPal: ${portalLink()}`)
    expectPortalLinkOnly(email.text)
    expectPortalLinkOnly(email.html)
    expectCleanEmail(email)
  })
})

describe('private booking manager notifications', () => {
  const BOOKING_ID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

  it('new enquiry email links the booking', async () => {
    const result = await sendManagerPrivateBookingCreatedEmail({
      booking: {
        id: BOOKING_ID,
        booking_reference: 'PB-7F3A2C10',
        customer_name: 'Alex Smith',
        contact_phone: '+447700900456',
        contact_email: 'alex@example.com',
        event_date: '2026-11-14',
        start_time: '19:00:00',
        status: 'draft',
        source: 'website',
        guest_count: 40,
        event_type: 'Birthday party',
        hold_expiry: '2026-10-08T10:00:00.000Z',
        created_at: '2026-10-01T09:45:00.000Z',
      },
      createdVia: 'website',
    })

    expect(result).toEqual({ sent: true })
    const email = onlyEmail()
    const bookingLink = `${APP_URL}/private-bookings/${BOOKING_ID}`
    expect(email.to).toBe(PRIVATE_BOOKINGS_MANAGER_EMAIL)
    expect(email.subject).toBe('New private booking enquiry: PB-7F3A2C10')
    expect(email.text).toContain(`Open booking: ${bookingLink}`)
    expect(email.html).toContain(`<a href="${bookingLink}">${bookingLink}</a>`)
    expect(appLinksIn(email.text ?? '')).toEqual([bookingLink])
    expect(appLinksIn(email.html ?? '')).toEqual([bookingLink])
    expectCleanEmail(email)
  })

  it('post-event outcome email carries one link per outcome', async () => {
    let issued = 0
    vi.mocked(createGuestToken).mockImplementation(async () => {
      issued += 1
      return { rawToken: `outcome-token-${issued}`, hashedToken: `outcome-hash-${issued}` }
    })
    vi.mocked(createAdminClient).mockReturnValue(fixtureDb({ private_bookings: { customer_id: 'customer-2' } }))

    const result = await sendPrivateBookingOutcomeEmail({
      bookingId: BOOKING_ID,
      customerName: 'Alex Smith',
      customerFirstName: 'Alex',
      eventDate: '14 November 2026',
      guestCount: 40,
    })

    expect(result).toEqual({
      success: true,
      tokenIds: ['outcome-hash-1', 'outcome-hash-2', 'outcome-hash-3'],
    })
    const outcomeLinks = [
      `${APP_URL}/api/private-bookings/outcome/went_well/outcome-token-1`,
      `${APP_URL}/api/private-bookings/outcome/issues/outcome-token-2`,
      `${APP_URL}/api/private-bookings/outcome/skip/outcome-token-3`,
    ]
    const email = onlyEmail()
    expect(email.to).toBe(PRIVATE_BOOKINGS_MANAGER_EMAIL)
    expect(email.subject).toContain('14 November 2026')
    expect(email.text).toContain(`Had issues: ${outcomeLinks[1]}`)
    expect(email.text).toContain(`Skip: ${outcomeLinks[2]}`)
    expect(appLinksIn(email.text ?? '')).toEqual(outcomeLinks)
    expect(appLinksIn(email.html ?? '')).toEqual(outcomeLinks)
    expectCleanEmail(email)
  })
})

describe('event reschedule', () => {
  const EVENT_BOOKING_ID = '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70'
  const MANAGE_LINK = `${APP_URL}/g/guest-token/manage-booking`

  it('text and email to a guest whose Quiz Night moved', async () => {
    // Quiz Night on Wednesday 7 October 2026 at 7pm moves to Wednesday 14 October at 7:30pm.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({ bookings: eventBooking(EVENT_BOOKING_ID, EVENT), email_messages: null })
    )

    const result = await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Quiz Night',
      oldDate: '2026-10-07',
      oldTime: '19:00',
      newDate: '2026-10-14',
      newTime: '19:30',
      userId: 'user-1',
    })

    expect(result).toEqual({ bookingsNotified: 1, totalBookingsAffected: 1 })

    const texts = sentTexts()
    expect(texts).toHaveLength(1)
    expect(texts[0].to).toBe('+447700900123')
    expect(texts[0].body).toContain('Quiz Night has moved to')
    expect(texts[0].body).toContain('Your booking for 2 seats is still confirmed.')
    expect(texts[0].body.endsWith(` ${MANAGE_LINK}`)).toBe(true)
    expect(appLinksIn(texts[0].body)).toEqual([MANAGE_LINK])
    assertCleanText(texts[0].body)
    expectNoBadLinks(texts[0].body)

    expect(shortLinkDestinations()).toEqual([MANAGE_LINK])
    const email = onlyEmail()
    expect(email.to).toBe('pat@example.com')
    expect(email.subject).toContain('Event rescheduled: Quiz Night')
    expect(email.text).toContain('View your booking here: https://l.the-anchor.pub/abc123')
    expect(email.html).toContain('https://l.the-anchor.pub/abc123')
    expectNoBadLinks(email.text ?? '')
    expectNoBadLinks(email.html ?? '')
    assertCleanRender(email as { subject: string; html: string; text: string })

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'reschedule',
        additional_info: expect.objectContaining({ bookings_notified: 1 }),
      })
    )
  })
})

describe('rota staff emails', () => {
  it('unfilled urgent shift email links the reassign page', async () => {
    // Friday 2 October has an evening bar shift Sam turned down; Sunday 4 October a lunch shift.
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb({
        rota_shifts: [
          { id: 'shift-1', shift_date: '2026-10-02', start_time: '17:00:00', end_time: '23:00:00', department: 'bar', name: 'Evening bar' },
          { id: 'shift-2', shift_date: '2026-10-04', start_time: '12:00:00', end_time: '18:00:00', department: 'kitchen', name: 'Sunday lunch' },
        ],
        rota_shift_rejections: [
          { shift_id: 'shift-1', employee_id: 'employee-1', rejection_note: 'Away that weekend', rejected_at: '2026-09-30T09:00:00.000Z' },
        ],
        employees: [{ employee_id: 'employee-1', first_name: 'Sam', last_name: 'Taylor', preferred_name: 'Sam' }],
        system_settings: { value: { value: 'rota.manager@example.com' } },
        rota_email_log: null,
      })
    )

    const response = await runRotaUnfilledUrgent(cronRequest('/api/cron/rota-unfilled-urgent'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, action: 'alert_sent', unfilled: 2, soonestInDays: 1 })
    const email = onlyEmail()
    expect(email.to).toBe('rota.manager@example.com')
    expect(email.subject).toBe('2 unfilled shifts this week, soonest tomorrow')
    expect(email.html).toContain(`<a href="${APP_URL}/rota/reassign"`)
    expect(email.html).toContain('turned down by Sam')
    expect(appLinksIn(email.html ?? '')).toEqual([`${APP_URL}/rota/reassign`])
    expectCleanEmail(email)
  })

  const SHIFT: ShiftSummary = {
    date: '2026-10-09',
    startTime: '17:00',
    endTime: '23:00',
    department: 'bar',
    templateName: 'Evening bar',
  }
  const LATER_SHIFT: ShiftSummary = { ...SHIFT, startTime: '18:00' }
  const OPEN_SHIFT: ShiftSummary = {
    date: '2026-10-11',
    startTime: '12:00',
    endTime: '18:00',
    department: 'kitchen',
    templateName: 'Sunday lunch',
  }
  const PORTAL_SHIFT: PortalShiftEmailSummary = {
    employeeName: 'Sam Taylor',
    date: '2026-10-09',
    startTime: '17:00',
    endTime: '23:00',
    department: 'bar',
    templateName: 'Evening bar',
  }

  const TEMPLATES: Array<{ name: string; render: () => string; path: string }> = [
    {
      name: 'weekly rota',
      render: () => buildStaffRotaEmailHtml('Sam', '2026-10-05', '2026-10-11', [SHIFT], [OPEN_SHIFT]),
      path: '/portal/shifts',
    },
    {
      name: 'rota change',
      render: () =>
        buildRotaChangeEmailHtml(
          'Sam',
          '2026-10-05',
          '2026-10-11',
          [
            { type: 'added', after: OPEN_SHIFT },
            { type: 'modified', before: SHIFT, after: LATER_SHIFT },
          ],
          [LATER_SHIFT, OPEN_SHIFT],
          [OPEN_SHIFT]
        ),
      path: '/portal/shifts',
    },
    {
      name: 'holiday request received',
      render: () => buildHolidaySubmittedEmailHtml('Sam', '2026-11-02', '2026-11-06'),
      path: '/portal/leave',
    },
    {
      name: 'holiday request approved',
      render: () => buildHolidayDecisionEmailHtml('Sam', '2026-11-02', '2026-11-06', 'approved', 'Enjoy the break'),
      path: '/portal/leave',
    },
    {
      name: 'shift rejected, to the manager',
      render: () => buildShiftRejectedManagerEmailHtml(PORTAL_SHIFT, 'Away that weekend'),
      path: '/rota',
    },
    {
      name: 'open shift request with no rota link given, to the manager',
      render: () => buildOpenShiftRequestManagerEmailHtml(PORTAL_SHIFT, 'Happy to cover'),
      path: '/rota',
    },
    {
      name: 'shift acceptance reminder',
      render: () => buildShiftAutoAcceptWarningEmailHtml('Sam', [PORTAL_SHIFT]),
      path: '/portal/shifts',
    },
  ]

  it.each(TEMPLATES)('$name template links $path', ({ render, path }) => {
    const html = render()

    expect(html).toContain(`href="${APP_URL}${path}"`)
    expect(appLinksIn(html)).toEqual([`${APP_URL}${path}`])
    expectCleanEmail({ subject: '', html })
  })
})

describe('alert emails that show the app URL', () => {
  const APP_URL_ROW = `<td style="padding:4px 8px;font-weight:bold;">App URL</td><td style="padding:4px 8px;">${APP_URL}</td>`

  it('cron failure alert', async () => {
    vi.stubEnv('CRON_ALERT_EMAIL', 'alerts@example.com')

    await reportCronFailure('parking-notifications', new Error('Twilio request timed out'), { batch: 3, attempted: 12 })

    const email = onlyEmail()
    expect(email.to).toBe('alerts@example.com')
    expect(email.subject).toBe('[CRON FAILURE] parking-notifications - test')
    expect(email.html).toContain(APP_URL_ROW)
    expect(email.html).not.toContain('unknown')
    expect(email.html).not.toContain(`${APP_URL}/`)
    expectCleanEmail(email)
  })

  it('OJ Projects billing run alert', async () => {
    vi.stubEnv('OJ_PROJECTS_BILLING_ALERT_EMAIL', 'billing.alerts@example.com')

    await sendBillingRunAlert({
      period: '2026-09',
      invoice_date: '2026-10-01',
      processed: 3,
      sent: 2,
      skipped: 0,
      failed: 1,
      vendors: [
        { vendor_id: 'vendor-1', vendor_name: 'Acme Events Ltd', status: 'sent', invoice_id: 'invoice-1', invoice_number: 'OJ-2026-0101' },
        { vendor_id: 'vendor-2', vendor_name: 'Riverside Catering', status: 'sent', invoice_id: 'invoice-2', invoice_number: 'OJ-2026-0102' },
        { vendor_id: 'vendor-3', vendor_name: 'Harbour Lights Ltd', status: 'failed', error: 'Invoice email send failed' },
      ],
    })

    const email = onlyEmail()
    expect(email.to).toBe('billing.alerts@example.com')
    expect(email.subject).toBe('OJ Projects Billing Alert: 2026-09, 1 issue')
    expect(email.html).toContain(APP_URL_ROW)
    expect(email.html).toContain('Harbour Lights Ltd')
    expect(email.html).not.toContain('unknown')
    expect(email.html).not.toContain(`${APP_URL}/`)
    expectCleanEmail(email)
  })
})

describe('SMS reply-to-book', () => {
  const REPLY_BOOKING_ID = '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f'
  const MANAGE_LINK = `${APP_URL}/g/guest-token/manage-booking`
  // Pay on the door, as the events promoted for a reply booking are.
  const CASH_EVENT: Row = { ...EVENT, payment_mode: 'cash_only', price: 5, price_per_seat: 5 }

  it('a reply of "2" books the seats and the confirmation text carries the manage link', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fixtureDb(
        {
          sms_promo_context: { id: 'promo-1', customer_id: 'customer-1', event_id: 'event-1', template_key: 'event_cross_promo_14d' },
          events: CASH_EVENT,
          customers: CUSTOMER,
          // The duplicate check reads only ids and must find nothing; the email reads the new booking.
          bookings: (columns) => (columns.includes('customers!inner') ? eventBooking(REPLY_BOOKING_ID, CASH_EVENT) : null),
          email_messages: null,
        },
        {
          get_event_capacity_snapshot_v05: [
            { event_id: 'event-1', seats_remaining: 20, is_full: false, capacity: 40, confirmed_seats: 20, held_seats: 0 },
          ],
          create_event_booking_v06: {
            state: 'confirmed',
            booking_id: REPLY_BOOKING_ID,
            status: 'confirmed',
            payment_mode: 'cash_only',
            event_seating_type: 'seated',
            event_id: 'event-1',
            event_name: 'Quiz Night',
            event_start_datetime: EVENT.start_datetime,
            seats_remaining: 18,
          },
        }
      )
    )
    const createBooking = vi.spyOn(EventBookingService, 'createBooking')

    try {
      const result = await handleReplyToBook('+447700900123', '2', {
        inboundMessageId: 'inbound-1',
        inboundTwilioMessageSid: 'SM-inbound-1',
      })

      expect(result).toEqual({ handled: true })
      expect(createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ appBaseUrl: APP_URL, source: 'sms_reply', seats: 2, shouldSendSms: true })
      )

      const texts = sentTexts()
      expect(texts).toHaveLength(1)
      expect(texts[0].to).toBe('+447700900123')
      expect(texts[0].body).toContain("you're in. 2 seats locked in for Quiz Night")
      expect(texts[0].body.endsWith(` ${MANAGE_LINK}`)).toBe(true)
      expect(appLinksIn(texts[0].body)).toEqual([MANAGE_LINK])
      assertCleanText(texts[0].body)
      expectNoBadLinks(texts[0].body)

      // A guest who booked by text gets the email as well, not instead.
      expect(shortLinkDestinations()).toEqual([MANAGE_LINK])
      const email = onlyEmail()
      expect(email.to).toBe('pat@example.com')
      expect(email.text).toContain('View your booking here: https://l.the-anchor.pub/abc123')
      expectNoBadLinks(email.text ?? '')
      expectNoBadLinks(email.html ?? '')
      assertCleanRender(email as { subject: string; html: string; text: string })
    } finally {
      createBooking.mockRestore()
    }
  })
})
