import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The payment reminder for a phone, bar or text booking: email first, a text only when no email
 * goes (BK-167, D14), never a text that quiet hours would hold until the seats are gone (BK-213),
 * and one claim per booking and stage.
 */

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  claims: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}))

function chain(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Record<string, unknown> | null = null
  const result = () => {
    if (table === 'bookings') return { data: state.rows, error: null }
    if (op === 'insert') {
      const clash = state.claims.some((row) => row.event_booking_id === payload?.event_booking_id && row.stage === payload?.stage && row.channel === payload?.channel)
      if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      state.claims.push(payload!)
      return { data: { id: `reminder-${state.claims.length}` }, error: null }
    }
    if (op === 'update') state.updates.push(payload!)
    return { data: null, error: null }
  }
  const self: any = {
    select: () => self, eq: () => self, in: () => self, not: () => self, gt: () => self, lte: () => self, order: () => self, limit: () => self,
    insert: (value: Record<string, unknown>) => { op = 'insert'; payload = value; return self },
    update: (value: Record<string, unknown>) => { op = 'update'; payload = value; return self },
    maybeSingle: () => Promise.resolve(result()),
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
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
vi.mock('@/lib/events/event-payments', () => ({
  createEventPaymentToken: vi.fn().mockResolvedValue({ url: 'https://management.example.test/g/t/event-payment' }),
  sendEventPaymentRetrySms: vi.fn().mockResolvedValue({ success: true, code: null, logFailure: false }),
}))
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventPaymentLinkEmail: vi.fn() }))

import { GET } from '@/app/api/cron/event-payment-reminders/route'
import { sendEventPaymentRetrySms } from '@/lib/events/event-payments'
import { sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'

async function run() {
  const response = await (GET as unknown as (request: NextRequest) => Promise<Response>)(new NextRequest('http://localhost/api/cron/event-payment-reminders'))
  return response.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  state.rows = []
  state.claims = []
  state.updates = []
  vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: true, messageId: 'email-1' })
})

afterEach(() => vi.useRealTimers())

describe('event payment reminders', () => {
  it('emails the reminder and sends no text to a guest with an email', async () => {
    vi.setSystemTime(new Date('2026-11-20T13:15:00.000Z'))
    state.rows = [{ id: 'booking-1', customer_id: 'customer-1', hold_expires_at: '2026-11-20T15:00:00.000Z', source: 'admin' }]

    const body = await run()

    expect(body).toMatchObject({ sent: 1, failed: 0 })
    expect(sendEventPaymentLinkEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: 'booking-1', reminder: true }))
    expect(sendEventPaymentRetrySms).not.toHaveBeenCalled()
    expect(state.claims).toEqual([expect.objectContaining({ event_booking_id: 'booking-1', stage: 'payment_due_2h', channel: 'email' })])
    expect(state.updates[0]).toMatchObject({ message_id: 'email-1', metadata: expect.objectContaining({ sent_channel: 'email', sms_sent: false }) })

    await run()
    expect(sendEventPaymentLinkEmail).toHaveBeenCalledTimes(1)
  })

  it('texts a guest with no usable email', async () => {
    vi.setSystemTime(new Date('2026-11-20T13:15:00.000Z'))
    state.rows = [{ id: 'booking-1', customer_id: 'customer-1', hold_expires_at: '2026-11-20T15:00:00.000Z', source: 'sms_reply' }]
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: false, skipped: true })

    await run()

    expect(sendEventPaymentRetrySms).toHaveBeenCalledTimes(1)
  })

  it('sends no text at 05:00 for a hold ending at 07:00, and records why', async () => {
    vi.setSystemTime(new Date('2026-11-20T05:00:00.000Z'))
    state.rows = [{ id: 'booking-1', customer_id: 'customer-1', hold_expires_at: '2026-11-20T07:00:00.000Z', source: 'admin' }]
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: false, skipped: true })

    await run()

    expect(sendEventPaymentRetrySms).not.toHaveBeenCalled()
    expect(state.updates[0]).toMatchObject({ metadata: expect.objectContaining({ text_skipped_reason: 'quiet_hours_until_hold_end' }) })
  })

  it('sends the 2-hour reminder before 21:00 for a hold ending at 07:00', async () => {
    vi.setSystemTime(new Date('2026-11-19T20:40:00.000Z'))
    state.rows = [{ id: 'booking-1', customer_id: 'customer-1', hold_expires_at: '2026-11-20T07:00:00.000Z', source: 'admin' }]
    vi.mocked(sendEventPaymentLinkEmail).mockResolvedValue({ success: false, skipped: true })

    await run()

    expect(state.claims[0]).toMatchObject({ stage: 'payment_due_2h' })
    expect(sendEventPaymentRetrySms).toHaveBeenCalledTimes(1)
  })
})
