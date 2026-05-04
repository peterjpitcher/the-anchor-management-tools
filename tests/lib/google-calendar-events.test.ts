import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const {
  eventsUpdate,
  eventsInsert,
  eventsDelete,
  getOAuth2ClientMock,
  warn,
} = vi.hoisted(() => ({
  eventsUpdate: vi.fn(),
  eventsInsert: vi.fn(),
  eventsDelete: vi.fn(),
  getOAuth2ClientMock: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        update: eventsUpdate,
        insert: eventsInsert,
        delete: eventsDelete,
      },
    })),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getOAuth2Client: getOAuth2ClientMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import {
  PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
  aggregatePubOpsEventCalendarBookings,
  buildPubOpsEventCalendarEntry,
  generatePubOpsEventCalendarEventId,
  syncPubOpsEventCalendarByEventId,
  type PubOpsEventCalendarBookingRow,
  type PubOpsEventCalendarEventRow,
} from '@/lib/google-calendar-events'

const originalGoogleServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID
const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const originalGoogleRefreshToken = process.env.GOOGLE_REFRESH_TOKEN
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

const baseEvent: PubOpsEventCalendarEventRow = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Quiz Night',
  date: '2026-06-15',
  time: '19:00:00',
  start_datetime: null,
  end_time: '21:30:00',
  duration_minutes: null,
  short_description: 'A weekly pub quiz with prizes.',
  booking_url: 'https://www.the-anchor.pub/whats-on/quiz-night',
  capacity: 50,
  event_status: 'scheduled',
  booking_mode: 'general',
  payment_mode: 'prepaid',
}

const now = new Date('2026-06-10T12:00:00.000Z')

function makeSupabaseMock(input: {
  event?: PubOpsEventCalendarEventRow | null
  eventError?: { message: string } | null
  bookings?: PubOpsEventCalendarBookingRow[]
  bookingsError?: { message: string } | null
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: input.event ?? null,
                error: input.eventError ?? null,
              }),
            }),
          }),
        }
      }

      if (table === 'bookings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: input.bookings ?? [],
              error: input.bookingsError ?? null,
            }),
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('google calendar event booking aggregate helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{"type":"service_account"}'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.the-anchor.pub'
    getOAuth2ClientMock.mockResolvedValue({ auth: true })
    eventsUpdate.mockResolvedValue({ data: { id: 'updated-event-id' } })
    eventsInsert.mockResolvedValue({ data: { id: 'created-event-id' } })
    eventsDelete.mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    restoreEnv('GOOGLE_SERVICE_ACCOUNT_KEY', originalGoogleServiceAccountKey)
    restoreEnv('GOOGLE_CLIENT_ID', originalGoogleClientId)
    restoreEnv('GOOGLE_CLIENT_SECRET', originalGoogleClientSecret)
    restoreEnv('GOOGLE_REFRESH_TOKEN', originalGoogleRefreshToken)
    restoreEnv('NEXT_PUBLIC_APP_URL', originalAppUrl)
  })

  it('generates deterministic Google-safe event ids from Anchor event ids', () => {
    const first = generatePubOpsEventCalendarEventId(baseEvent.id)
    const second = generatePubOpsEventCalendarEventId(baseEvent.id)
    const other = generatePubOpsEventCalendarEventId('550e8400-e29b-41d4-a716-446655440002')

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it('aggregates confirmed and active pending-payment seats while excluding cancelled, expired, and reminder rows', () => {
    const aggregate = aggregatePubOpsEventCalendarBookings([
      { id: 'booking-1', seats: 2, status: 'confirmed', is_reminder_only: false },
      { id: 'booking-2', seats: 3, status: 'pending_payment', is_reminder_only: false, hold_expires_at: '2026-06-10T13:00:00.000Z' },
      { id: 'booking-3', seats: 5, status: 'pending_payment', is_reminder_only: false, hold_expires_at: '2026-06-10T11:00:00.000Z' },
      { id: 'booking-4', seats: 7, status: 'cancelled', is_reminder_only: false },
      { id: 'booking-5', seats: 11, status: 'confirmed', is_reminder_only: true },
      { id: 'booking-6', seats: 13, status: 'visited_waiting_for_review', is_reminder_only: false },
    ], now)

    expect(aggregate).toEqual({
      confirmedSeats: 2,
      pendingPaymentSeats: 3,
      totalActiveSeats: 5,
      activeBookingCount: 2,
    })
  })

  it('builds an aggregate calendar event with booking links and seat totals', () => {
    const entry = buildPubOpsEventCalendarEntry({
      event: baseEvent,
      bookings: [
        { id: 'booking-1', seats: 2, status: 'confirmed', is_reminder_only: false },
        { id: 'booking-2', seats: 3, status: 'pending_payment', is_reminder_only: false, hold_expires_at: '2026-06-10T13:00:00.000Z' },
      ],
      appBaseUrl: 'https://app.the-anchor.pub',
      now,
    })

    expect(entry.shouldDelete).toBe(false)
    if (entry.shouldDelete) throw new Error('Expected active calendar entry')

    expect(entry.requestBody.id).toBe(generatePubOpsEventCalendarEventId(baseEvent.id))
    expect(entry.requestBody.summary).toBe('Quiz Night - 5 seats booked')
    expect(entry.requestBody.description).toContain('Details:\nA weekly pub quiz with prizes.')
    expect(entry.requestBody.description).toContain('Confirmed seats: 2')
    expect(entry.requestBody.description).toContain('Pending payment held seats: 3')
    expect(entry.requestBody.description).toContain('Total active seats: 5')
    expect(entry.requestBody.description).toContain('Public booking link: https://www.the-anchor.pub/whats-on/quiz-night')
    expect(entry.requestBody.description).toContain(`Admin event link: https://app.the-anchor.pub/events/${baseEvent.id}`)
    expect(entry.requestBody.extendedProperties.private).toEqual({
      source: 'anchor_event_booking_aggregate',
      anchorEventId: baseEvent.id,
    })
  })

  it('marks the entry for deletion when there are no active seats', () => {
    const entry = buildPubOpsEventCalendarEntry({
      event: baseEvent,
      bookings: [
        { id: 'booking-1', seats: 2, status: 'cancelled', is_reminder_only: false },
        { id: 'booking-2', seats: 3, status: 'confirmed', is_reminder_only: true },
      ],
      now,
    })

    expect(entry).toMatchObject({
      shouldDelete: true,
      reason: 'no_active_seats',
      aggregate: {
        totalActiveSeats: 0,
      },
    })
  })

  it('updates an existing Pub Ops aggregate calendar event', async () => {
    const supabase = makeSupabaseMock({
      event: baseEvent,
      bookings: [{ id: 'booking-1', seats: 2, status: 'confirmed', is_reminder_only: false }],
    })

    const result = await syncPubOpsEventCalendarByEventId(supabase as any, baseEvent.id)

    expect(result.state).toBe('updated')
    expect(eventsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: generatePubOpsEventCalendarEventId(baseEvent.id),
      requestBody: expect.objectContaining({
        summary: 'Quiz Night - 2 seats booked',
      }),
    }))
    expect(eventsInsert).not.toHaveBeenCalled()
  })

  it('creates the deterministic event when update returns not found', async () => {
    eventsUpdate.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    const supabase = makeSupabaseMock({
      event: baseEvent,
      bookings: [{ id: 'booking-1', seats: 2, status: 'confirmed', is_reminder_only: false }],
    })

    const result = await syncPubOpsEventCalendarByEventId(supabase as any, baseEvent.id)

    expect(result.state).toBe('created')
    expect(eventsInsert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      requestBody: expect.objectContaining({
        id: generatePubOpsEventCalendarEventId(baseEvent.id),
      }),
    }))
  })

  it('deletes the deterministic event when active seats reach zero', async () => {
    const supabase = makeSupabaseMock({
      event: baseEvent,
      bookings: [{ id: 'booking-1', seats: 2, status: 'cancelled', is_reminder_only: false }],
    })

    const result = await syncPubOpsEventCalendarByEventId(supabase as any, baseEvent.id)

    expect(result.state).toBe('deleted')
    expect(eventsDelete).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: generatePubOpsEventCalendarEventId(baseEvent.id),
    }))
  })

  it('skips without querying Google when calendar auth is not configured', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN
    const supabase = makeSupabaseMock({ event: baseEvent })

    const result = await syncPubOpsEventCalendarByEventId(supabase as any, baseEvent.id)

    expect(result).toMatchObject({
      state: 'skipped',
      reason: 'calendar_not_configured',
    })
    expect(getOAuth2ClientMock).not.toHaveBeenCalled()
    expect(eventsUpdate).not.toHaveBeenCalled()
  })

  it('returns failed instead of throwing when Google auth fails', async () => {
    getOAuth2ClientMock.mockRejectedValueOnce(new Error('auth failed'))
    const supabase = makeSupabaseMock({ event: baseEvent })

    const result = await syncPubOpsEventCalendarByEventId(supabase as any, baseEvent.id)

    expect(result).toMatchObject({
      state: 'failed',
      reason: 'auth failed',
    })
    expect(warn).toHaveBeenCalled()
  })
})
