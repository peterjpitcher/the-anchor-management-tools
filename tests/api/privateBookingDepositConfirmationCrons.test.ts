import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, depositConfirmation: true }))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) =>
    key === 'private_booking_deposit_confirmation' ? state.depositConfirmation : false
  ),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendPrivateBookingOutcomeEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/sms/review-once', () => ({
  getFirstVisitReviewEligibleCandidateKeys: vi.fn(async () => new Set()),
  reviewVisitCandidateKey: vi.fn(() => 'key'),
}))

vi.mock('@/lib/events/review-link', () => ({
  getGoogleReviewLink: vi.fn(async () => 'https://g.page/r/test'),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'sms' })),
}))

import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { logger } from '@/lib/logger'
import { GET as runMonitorRoute } from '@/app/api/cron/private-booking-monitor/route'
import { GET as runExpireHoldsRoute } from '@/app/api/cron/private-bookings-expire-holds/route'

const mockedSend = sendPrivateBookingMessage as unknown as Mock

// 10:00 in London on Sunday 20 September 2026. A hold expiring on the evening of the 25th is in
// the 7-day reminder window; one that expired on the 19th has lapsed.
const NOW = new Date('2026-09-20T09:00:00.000Z')

function draft(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: null,
    hold_expiry: '2026-09-25T22:30:00.000Z',
    event_date: '2026-10-31',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    internal_notes: null,
    date_tbd: false,
    calendar_event_id: null,
    ...overrides,
  }
}

function seed(bookings: Record<string, unknown>[]) {
  state.db = createFakeSupabase(
    {
      cron_job_runs: [],
      messages: [],
      private_bookings: bookings,
      private_bookings_with_details: [],
      private_booking_sms_queue: [],
      private_booking_send_idempotency: [],
      customers: [{ id: 'customer-1', mobile_number: '+447700900123' }],
    },
    {
      unique: {
        cron_job_runs: (row) => `${row.job_name}:${row.run_key}`,
        private_booking_send_idempotency: (row) => row.idempotency_key,
      },
    }
  )
}

function remindedBookingIds(): string[] {
  return mockedSend.mock.calls
    .map(([input]) => input.sms)
    .filter((sms) => String(sms.trigger_type).startsWith('deposit_reminder_'))
    .map((sms) => sms.booking_id)
}

describe('deposit reminders and hold expiry for a deposit still to be confirmed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    state.depositConfirmation = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('the monitor reminds only the confirmed deposit, and never states an unconfirmed amount', async () => {
    seed([
      draft('unconfirmed', { deposit_confirmed_at: null, deposit_amount: 400 }),
      draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z' }),
    ])

    const response = await runMonitorRoute(new Request('http://localhost/api/cron/private-booking-monitor'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(remindedBookingIds()).toEqual(['confirmed'])
    expect(body.stats.remindersSent).toBe(1)
    for (const [input] of mockedSend.mock.calls) {
      expect(input.sms.message_body).not.toContain('£400')
    }
  })

  it('with the flag off the monitor reminds every live hold, exactly as today', async () => {
    state.depositConfirmation = false
    seed([draft('unconfirmed', { deposit_confirmed_at: null }), draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])

    await runMonitorRoute(new Request('http://localhost/api/cron/private-booking-monitor'))

    expect(remindedBookingIds().sort()).toEqual(['confirmed', 'unconfirmed'])
  })

  it('if the reminder query fails with the flag on, nothing is sent and the failure is logged', async () => {
    seed([draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z' })])
    state.db.failures.push({ table: 'private_bookings', op: 'select', error: { code: '42703', message: 'column private_bookings.deposit_confirmed_at does not exist' } })

    const response = await runMonitorRoute(new Request('http://localhost/api/cron/private-booking-monitor'))

    expect(response.status).toBe(200)
    expect(remindedBookingIds()).toEqual([])
    expect(logger.error).toHaveBeenCalledWith(
      'Private booking monitor: deposit reminder query failed with deposit confirmation on',
      expect.objectContaining({ metadata: expect.objectContaining({ code: '42703' }) })
    )
  })

  it('an unconfirmed hold never expires by itself, so its guest gets no hold-lapsed message', async () => {
    seed([
      draft('unconfirmed', { deposit_confirmed_at: null, hold_expiry: '2026-09-19T22:30:00.000Z' }),
      draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z', hold_expiry: '2026-09-19T22:30:00.000Z' }),
    ])

    const response = await runExpireHoldsRoute(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)
    const body = await response.json()

    expect(body.cancelled).toBe(1)
    const rows = Object.fromEntries(state.db.tables.private_bookings.map((row: any) => [row.id, row]))
    expect(rows.unconfirmed.status).toBe('draft')
    expect(rows.confirmed.status).toBe('cancelled')
    const lapsed = mockedSend.mock.calls.map(([input]) => input.sms).filter((sms) => sms.trigger_type === 'booking_expired')
    expect(lapsed.map((sms) => sms.booking_id)).toEqual(['confirmed'])
  })

  it('with the flag off every lapsed hold expires, exactly as today', async () => {
    state.depositConfirmation = false
    seed([
      draft('unconfirmed', { deposit_confirmed_at: null, hold_expiry: '2026-09-19T22:30:00.000Z' }),
      draft('confirmed', { deposit_confirmed_at: '2026-09-11T10:00:00.000Z', hold_expiry: '2026-09-19T22:30:00.000Z' }),
    ])

    const response = await runExpireHoldsRoute(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)
    const body = await response.json()

    expect(body.cancelled).toBe(2)
    expect(state.db.tables.private_bookings.every((row: any) => row.status === 'cancelled')).toBe(true)
  })
})
