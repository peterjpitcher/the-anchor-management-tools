import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { assertCleanRender, expectedLongDate } from '../mocks/emailRenderChecks'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn().mockResolvedValue({
    rawToken: 'manage-token',
    url: 'https://management.orangejelly.co.uk/g/manage-token/manage-booking',
    expiresAt: '2026-07-19T19:00:00.000Z',
  }),
}))

const loadBookingItemsWithTypesMock = vi.hoisted(() => vi.fn())
const getDefaultTicketTypeIdMock = vi.hoisted(() => vi.fn())
const bookingItemsAreMultiTypeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/events/ticket-type-queries', () => ({
  loadBookingItemsWithTypes: loadBookingItemsWithTypesMock,
  getDefaultTicketTypeId: getDefaultTicketTypeIdMock,
  bookingItemsAreMultiType: bookingItemsAreMultiTypeMock,
}))

const { warn } = vi.hoisted(() => ({
  warn: vi.fn(),
}))

// Without this the guest manage link is shortened for real, createShortLinkInternal
// throws on the test's Supabase stub, and the fail-open helper hands back the long
// URL. Every assertion below would still pass while proving nothing about what the
// guest receives.
const createShortLinkInternalMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { sendEmail } from '@/lib/email/emailService'
import { sendEventReminderEmail } from '@/lib/email/event-ticket-emails'

/**
 * The day-before reminder by email (BK-086, owner decision D14: email first). Rendered with
 * fixture data for every kind of night and checked for broken values.
 */

type EventFixture = Record<string, unknown>

/** A quiz night: cash on the night, a table booking, arrival 6:30pm, 7pm start, British Summer Time. */
const QUIZ_EVENT: EventFixture = {
  id: 'event-quiz',
  name: 'Quiz Night',
  event_type: 'quiz',
  start_datetime: '2026-09-16T18:00:00.000Z',
  date: '2026-09-16',
  time: '19:00:00',
  doors_time: '18:30:00',
  booking_url: 'https://www.the-anchor.pub/events/quiz-night',
  booking_mode: 'table',
  payment_mode: 'cash_only',
  price: 3,
  price_per_seat: 3,
  is_free: false,
  online_discount_type: null,
  online_discount_value: null,
  online_discount_ends_at: null,
  category: { name: 'Quiz Night', slug: 'quiz-night' },
}

/** Cash bingo: communal seating, and the two rules that always travel together. */
const CASH_BINGO_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-bingo',
  name: 'Cash Bingo',
  event_type: 'cash_bingo',
  price: 10,
  price_per_seat: 10,
  booking_mode: 'communal',
  category: { name: 'Cash Bingo', slug: 'cash-bingo' },
}

/** Karaoke on 18 September: free, communal, arrive from 7pm for an 8pm start. */
const KARAOKE_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-karaoke',
  name: 'Karaoke Night',
  event_type: 'karaoke',
  start_datetime: '2026-09-18T19:00:00.000Z',
  date: '2026-09-18',
  time: '20:00:00',
  doors_time: '19:00:00',
  booking_mode: 'communal',
  payment_mode: 'free',
  price: 0,
  price_per_seat: null,
  is_free: true,
  category: { name: 'Karaoke', slug: 'karaoke' },
}

/** The tasting night on 20 November: prepaid, and on a GMT date. */
const TASTING_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-tasting',
  name: 'Tinsel and Tipples Christmas Tasting Night',
  event_type: 'tasting',
  start_datetime: '2026-11-20T19:00:00.000Z',
  date: '2026-11-20',
  time: '19:00:00',
  doors_time: '18:30:00',
  booking_mode: 'general',
  payment_mode: 'prepaid',
  price: 45,
  price_per_seat: 45,
  is_free: false,
  online_discount_type: 'fixed',
  online_discount_value: 5,
  category: { name: 'Tasting Night', slug: 'tasting-night' },
}

/** A party that starts a quarter of an hour after midnight, which is the case date maths breaks on. */
const AFTER_MIDNIGHT_EVENT: EventFixture = {
  ...QUIZ_EVENT,
  id: 'event-late',
  name: 'Halloween Party',
  event_type: 'party',
  start_datetime: '2026-11-01T00:15:00.000Z',
  date: '2026-11-01',
  time: '00:15:00',
  doors_time: '23:30:00',
  booking_mode: 'general',
  payment_mode: 'free',
  price: 0,
  price_per_seat: null,
  is_free: true,
  category: { name: 'Party Night', slug: 'party-night' },
}

function buildSupabase(options?: {
  booking?: Record<string, unknown> | null
  event?: EventFixture
  customer?: Record<string, unknown>
  existingConfirmation?: Record<string, unknown> | null
}) {
  const defaultBooking = {
    id: '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70',
    customer_id: 'customer-1',
    seats: 2,
    status: 'confirmed',
    event_seating_type: 'seated',
    attendee_names: [],
    customers: {
      id: 'customer-1',
      first_name: 'Pat',
      email: 'pat@example.com',
      email_status: 'active',
      email_deactivated_at: null,
      ...(options?.customer ?? {}),
    },
    events: options?.event ?? QUIZ_EVENT,
  }

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.booking === null
      ? null
      : { ...defaultBooking, ...(options?.booking ?? {}) },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const emailMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.existingConfirmation ?? null,
    error: null,
  })
  const emailLimit = vi.fn().mockReturnValue({ maybeSingle: emailMaybeSingle })
  const emailContains = vi.fn().mockReturnValue({ limit: emailLimit })
  const emailIn = vi.fn().mockReturnValue({ limit: emailLimit, contains: emailContains })
  const emailEqCommType = vi.fn().mockReturnValue({ in: emailIn })
  const emailEqBooking = vi.fn().mockReturnValue({ eq: emailEqCommType })
  const emailSelect = vi.fn().mockReturnValue({ eq: emailEqBooking })

  return {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: bookingSelect }
      }
      if (table === 'email_messages') {
        return { select: emailSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    emailMaybeSingle,
  }
}

function lastSend(): { subject: string; html: string; text: string; metadata: Record<string, unknown>; commType?: string } {
  const calls = (sendEmail as unknown as Mock).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

const QUIZ_WHEN = `${expectedLongDate('2026-09-16')} at 7pm`

const BOOKING_ID = '3f2a9c1b-0d44-4a1e-9d3f-2b6c8a1e4f70'

describe('day-before reminder email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendEmail as unknown as Mock).mockResolvedValue({ success: true, messageId: 'email-1' })
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'mng123',
      full_url: 'https://l.the-anchor.pub/mng123',
      already_exists: false,
    })
    loadBookingItemsWithTypesMock.mockResolvedValue(new Map())
    getDefaultTicketTypeIdMock.mockResolvedValue('type-default')
    bookingItemsAreMultiTypeMock.mockReturnValue(false)
  })

  afterEach(() => {
    delete process.env.EVENT_TICKET_TYPES_ENABLED
  })

  it('reminds a quiz table booking: seats, cash on the night, arrival time', async () => {
    const result = await sendEventReminderEmail(buildSupabase() as any, { bookingId: BOOKING_ID, reminderDay: 'tomorrow' })

    expect(result.success).toBe(true)
    const email = lastSend()
    assertCleanRender(email)
    expect(email.commType).toBe('event_reminder_1d')
    expect(email.subject).toBe('Tomorrow: Quiz Night')
    expect(email.text).toContain(`Just a reminder that Quiz Night is tomorrow, ${QUIZ_WHEN}.`)
    expect(email.text).toContain('Your 2 seats are ready.')
    expect(email.text).toContain('Bring cash: £3 each.')
    expect(email.text).toContain('Arrive from 6:30pm for a 7pm start.')
    expect(email.text).toContain('View your booking here: https://l.the-anchor.pub/mng123')
  })

  it('never promises seats on a shared-seating night', async () => {
    await sendEventReminderEmail(buildSupabase({ event: KARAOKE_EVENT }) as any, { bookingId: BOOKING_ID, reminderDay: 'today' })

    const email = lastSend()
    assertCleanRender(email)
    expect(email.subject).toBe('Today: Karaoke Night')
    expect(email.text).toContain('Your 2 places are booked. Seating is shared on the night.')
    expect(email.text).not.toMatch(/seats are ready/)
    expect(email.text).not.toMatch(/Bring cash/)
  })

  it('names standing tickets as tickets', async () => {
    await sendEventReminderEmail(
      buildSupabase({ event: { ...QUIZ_EVENT, booking_mode: 'mixed' }, booking: { event_seating_type: 'standing', seats: 1 } }) as any,
      { bookingId: BOOKING_ID, reminderDay: 'tomorrow' }
    )

    const email = lastSend()
    assertCleanRender(email)
    expect(email.text).toContain('Your standing ticket is booked.')
  })

  it('renders a prepaid night on a GMT date without a cash line', async () => {
    await sendEventReminderEmail(buildSupabase({ event: TASTING_EVENT }) as any, { bookingId: BOOKING_ID, reminderDay: 'tomorrow' })

    const email = lastSend()
    assertCleanRender(email)
    expect(email.text).toContain(`${expectedLongDate('2026-11-20')} at 7pm`)
    expect(email.text).not.toMatch(/Bring cash/)
  })

  it('reminds a cash bingo night with its price per person', async () => {
    await sendEventReminderEmail(buildSupabase({ event: CASH_BINGO_EVENT }) as any, { bookingId: BOOKING_ID, reminderDay: 'tomorrow' })

    const email = lastSend()
    assertCleanRender(email)
    expect(email.text).toContain('Bring cash: £10 each.')
    expect(email.text).toContain('Seating is shared on the night.')
  })

  it('dates an event a quarter of an hour after midnight by its London day', async () => {
    await sendEventReminderEmail(buildSupabase({ event: AFTER_MIDNIGHT_EVENT }) as any, { bookingId: BOOKING_ID, reminderDay: 'tomorrow' })

    const email = lastSend()
    assertCleanRender(email)
    expect(email.text).toContain(expectedLongDate('2026-11-01'))
  })

  it('reports skipped, so the cron texts instead, when the guest has no usable email', async () => {
    const result = await sendEventReminderEmail(
      buildSupabase({ customer: { email: null } }) as any,
      { bookingId: BOOKING_ID, reminderDay: 'tomorrow' }
    )

    expect(result).toEqual({ success: false, skipped: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not remind a booking that is no longer confirmed', async () => {
    const result = await sendEventReminderEmail(
      buildSupabase({ booking: { status: 'cancelled' } }) as any,
      { bookingId: BOOKING_ID, reminderDay: 'tomorrow' }
    )

    expect(result.success).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends once: a reminder already emailed is not sent again', async () => {
    const result = await sendEventReminderEmail(
      buildSupabase({ existingConfirmation: { id: 'email-earlier' } }) as any,
      { bookingId: BOOKING_ID, reminderDay: 'tomorrow' }
    )

    expect(result).toEqual({ success: true, skipped: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
