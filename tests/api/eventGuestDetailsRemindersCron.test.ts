import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * BK-132, owner decision D5: bookings still missing guest details are reminded once, 3 days
 * before the night, email first; the manager gets the list the day before. The ledger row is
 * claimed before anything is sent, and a message the email log could not check gives its claim
 * back for tomorrow.
 */

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  ledger: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  deletes: 0,
}))

function chain(table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Record<string, unknown> | null = null
  const result = () => {
    if (table === 'events') return { data: state.events, error: null }
    if (table === 'bookings') return { data: state.bookings, error: null }
    if (op === 'insert') {
      const clash = state.ledger.some((row) =>
        row.kind === payload?.kind && (payload?.kind === 'manager_list' ? row.event_id === payload?.event_id : row.event_booking_id === payload?.event_booking_id))
      if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      const row = { id: `ledger-${state.ledger.length + 1}`, ...payload }
      state.ledger.push(row)
      state.inserts.push(row)
      return { data: { id: row.id }, error: null }
    }
    if (op === 'delete') {
      state.deletes += 1
      return { data: null, error: null }
    }
    return { data: op === 'select' ? state.ledger : null, error: null }
  }
  const self: any = {
    select: () => self, gte: () => self, lt: () => self, in: () => self, eq: () => self,
    insert: (value: Record<string, unknown>) => { op = 'insert'; payload = value; return self },
    update: () => { op = 'update'; return self },
    delete: () => { op = 'delete'; return self },
    maybeSingle: () => Promise.resolve(result()),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return self
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => chain(table) }) }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: () => ({ authorized: true }) }))
vi.mock('@/lib/cron/run-recorder', () => ({ withCronRun: (_name: string, handler: unknown) => handler }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/notifications/delivery-ledger', () => ({
  createNotificationDelivery: vi.fn().mockResolvedValue('delivery-1'),
  recordNotificationAttempt: vi.fn(),
  updateNotificationDelivery: vi.fn(),
}))
const flags = vi.hoisted(() => ({ on: true }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => flags.on) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'manager-1' }) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true, sid: 'SM1' }) }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn().mockResolvedValue({ url: 'https://management.example.test/g/t/manage-booking' }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventGuestDetailsReminderEmail: vi.fn() }))

import { GET } from '@/app/api/cron/event-guest-details-reminders/route'
import { sendEventGuestDetailsReminderEmail } from '@/lib/email/event-ticket-emails'
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

const QUESTION = { id: 'q-diet', label: 'Dietary needs', type: 'text', required: true }

function event(id: string, startIso: string) {
  return { id, name: 'Tasting Night', start_datetime: startIso, date: null, time: null, event_status: 'scheduled', collect_guest_details: true, payment_mode: 'prepaid', booking_questions: [QUESTION], booking_cutoff_at: null as string | null }
}

function booking(id: string, eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    id, event_id: eventId, seats: 2, status: 'confirmed', source: 'admin', attendees: [], created_at: '2026-11-01T10:00:00.000Z', is_reminder_only: false,
    customer: { id: `customer-${id}`, first_name: 'Pat', last_name: 'Smith', mobile_number: '+447700900123', sms_status: 'active' },
    ...overrides,
  }
}

async function run() {
  const response = await (GET as unknown as (request: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/cron/event-guest-details-reminders'))
  return response.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Wednesday 18 November 2026, 10:00 London.
  vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'))
  flags.on = true
  state.events = [event('event-sat', '2026-11-21T19:00:00.000Z')]
  state.bookings = [booking('booking-1', 'event-sat')]
  state.ledger = []
  state.inserts = []
  state.deletes = 0
  vi.mocked(sendEventGuestDetailsReminderEmail).mockResolvedValue({ success: true, messageId: 'email-1' })
})

afterEach(() => vi.useRealTimers())

describe('event guest details reminders cron', () => {
  it('emails the booker once, 3 days before, and sends no text', async () => {
    const body = await run()

    expect(body.result).toMatchObject({ remindersSent: 1, managerLists: 0 })
    expect(sendEventGuestDetailsReminderEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: 'booking-1', missingCount: 2 }))
    expect(sendSMS).not.toHaveBeenCalled()
    expect(state.inserts).toEqual([expect.objectContaining({ kind: 'booker_reminder', event_booking_id: 'booking-1' })])

    vi.mocked(sendEventGuestDetailsReminderEmail).mockClear()
    await run()
    expect(sendEventGuestDetailsReminderEmail).not.toHaveBeenCalled()
  })

  it('texts a booker with no usable email', async () => {
    vi.mocked(sendEventGuestDetailsReminderEmail).mockResolvedValue({ success: false, skipped: true })

    await run()

    expect(sendSMS).toHaveBeenCalledTimes(1)
    const [, text] = vi.mocked(sendSMS).mock.calls[0]
    expect(text).toContain('2 tickets still need a guest name or answers for Tasting Night on Sat 21 Nov at 7pm')
  })

  it('gives the claim back when the email log could not be checked, and sends no text', async () => {
    vi.mocked(sendEventGuestDetailsReminderEmail).mockResolvedValue({ success: false, skipped: true, deferred: true })

    const body = await run()

    expect(body.result.remindersDeferred).toBe(1)
    expect(state.deletes).toBe(1)
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('leaves complete bookings, walk-ins and the flag-off case alone', async () => {
    state.bookings = [
      booking('booking-done', 'event-sat', { attendees: [
        { id: 'g1', name: 'Pat', ticket_type_id: null, answers: [{ question_id: 'q-diet', label: 'Dietary needs', type: 'text', value: 'None' }] },
        { id: 'g2', name: 'Sam', ticket_type_id: null, answers: [{ question_id: 'q-diet', label: 'Dietary needs', type: 'text', value: 'Vegan' }] },
      ] }),
      booking('booking-walk-in', 'event-sat', { source: 'walk-in' }),
    ]
    await run()
    expect(sendEventGuestDetailsReminderEmail).not.toHaveBeenCalled()

    state.bookings = [booking('booking-1', 'event-sat')]
    flags.on = false
    await run()
    expect(sendEventGuestDetailsReminderEmail).not.toHaveBeenCalled()
  })

  it('reminds while online changes are still open before the sales cutoff', async () => {
    state.events = [{ ...event('event-sat', '2026-11-21T19:00:00.000Z'), booking_cutoff_at: '2026-11-20T12:00:00.000Z' }]

    const body = await run()

    expect(body.result.remindersSent).toBe(1)
    expect(body.result.closedForEdits).toEqual([])
  })

  it('sends nothing and claims nothing once the sales cutoff has passed, and lists the booking for staff', async () => {
    state.events = [{ ...event('event-sat', '2026-11-21T19:00:00.000Z'), booking_cutoff_at: '2026-11-18T09:00:00.000Z' }]

    const body = await run()

    expect(sendEventGuestDetailsReminderEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
    expect(state.inserts).toEqual([])
    expect(body.result.closedForEdits).toEqual(['booking-1'])
  })

  it('emails the manager the list the day before, once', async () => {
    state.events = [event('event-thu', '2026-11-19T19:00:00.000Z')]
    state.bookings = [booking('booking-2', 'event-thu')]
    state.ledger = [{ id: 'ledger-0', kind: 'booker_reminder', event_id: 'event-thu', event_booking_id: 'booking-2' }]

    const body = await run()

    expect(body.result.managerLists).toBe(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'manager@the-anchor.pub',
      subject: expect.stringContaining('Guest details missing for Tasting Night'),
    }))
    const html = vi.mocked(sendEmail).mock.calls[0][0].html as string
    expect(html).toContain('BOOKING-: Pat Smith, 2 tickets incomplete')
    expect(html).not.toContain('+447700900123')

    vi.mocked(sendEmail).mockClear()
    await run()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
