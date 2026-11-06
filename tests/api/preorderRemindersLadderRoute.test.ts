import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The pre-order cron route around the reminder ladder: which bookings go to the ladder and which
 * stay on the first release's rule, that the window reaches the ladder's first rung, that guest
 * addresses are purged, and that a failed message is reported rather than only logged. What the
 * ladder sends, and when, is tested in src/lib/table-bookings/preorder-ladder.test.ts.
 */

const authorizeCronRequest = vi.fn((_request: unknown) => ({ authorized: true as boolean, reason: undefined as string | undefined }))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: (request: unknown) => authorizeCronRequest(request) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: vi.fn(async () => ({ success: true })) } }))
vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(async () => ({ url: 'https://management.example.com/g/tok-1/table-manage' })),
}))
vi.mock('@/lib/guest/guest-short-link', () => ({
  buildGuestShortLink: vi.fn(async () => ({ url: 'https://l.the-anchor.pub/food1', shortened: true })),
}))
vi.mock('@/lib/table-bookings/preorder-cutoff-digest', () => ({
  sendPreorderCutoffDigests: vi.fn(async () => ({ kitchenEmails: 0, choiceCopies: 0, failed: 0 })),
}))
vi.mock('@/lib/table-bookings/preorder', () => ({
  PREORDER_BOOKER_REMINDER_DAYS: 10,
  isPreorderEnabled: vi.fn(async () => true),
  decideLegacyPreorderChases: vi.fn(() => []),
  describePreorderGaps: vi.fn(() => ''),
  getPreorderCompleteness: vi.fn(() => ({ complete: false })),
  getPreorderCutoff: vi.fn(() => ({ closed: false, closesAt: null })),
  loadPreorderOrder: vi.fn(async () => ({ requiresPreorder: true })),
}))
vi.mock('@/lib/table-bookings/preorder-ladder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/table-bookings/preorder-ladder')>('@/lib/table-bookings/preorder-ladder')
  return {
    emptyLadderResult: actual.emptyLadderResult,
    runPreorderLadder: vi.fn(async () => actual.emptyLadderResult()),
    purgeGuestInviteEmails: vi.fn(async () => 0),
  }
})

import { createAdminClient } from '@/lib/supabase/admin'
import { reportCronFailure } from '@/lib/cron/alerting'
import { decideLegacyPreorderChases } from '@/lib/table-bookings/preorder'
import { emptyLadderResult, purgeGuestInviteEmails, runPreorderLadder } from '@/lib/table-bookings/preorder-ladder'
import { GET } from '@/app/api/cron/preorder-reminders/route'
import { argsOf, createRecordingSupabase } from '../mocks/recordingSupabase'

const LADDER_BOOKING = {
  id: 'xmas-ladder', booking_reference: 'TB-LADDER', booking_date: '2026-12-12', booking_time: '19:00:00',
  start_datetime: '2026-12-12T19:00:00.000Z', party_size: 2, customer_id: 'cust-1', booking_period_id: 'period-xmas',
  booking_period_name: 'Christmas 2026', christmas_course_counts: [0, 2], created_at: '2026-11-01T10:00:00.000Z',
}
const LEGACY_BOOKING = { ...LADDER_BOOKING, id: 'old-legacy', booking_reference: 'TB-LEGACY', christmas_course_counts: null }
const LEDGER = [
  { table_booking_id: 'xmas-ladder', kind: 'guest_reminder', cover_id: 'cover-2', sent_at: '2026-12-04T12:00:10Z' },
  { table_booking_id: 'xmas-ladder', kind: 'booker_21d', cover_id: null, sent_at: '2026-11-21T12:00:10Z' },
]

function buildDb() {
  const db = createRecordingSupabase({
    tables: {
      booking_periods: () => ({ data: [{ id: 'period-xmas', preorder_cutoff_days: 7 }], error: null }),
      table_bookings: () => ({ data: [LADDER_BOOKING, LEGACY_BOOKING], error: null }),
      booking_preorder_reminders: () => ({ data: LEDGER, error: null }),
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return db
}

async function runSweep() {
  const response = await GET(new Request('http://localhost/api/cron/preorder-reminders') as never)
  return { status: response.status, body: await response.json() }
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  authorizeCronRequest.mockReturnValue({ authorized: true, reason: undefined })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-21T12:00:30Z'))
})

describe('the pre-order cron route', () => {
  it('refuses a request without the cron secret', async () => {
    authorizeCronRequest.mockReturnValue({ authorized: false, reason: 'Unauthorized' })
    buildDb()

    const { status } = await runSweep()

    expect(status).toBe(401)
    expect(runPreorderLadder).not.toHaveBeenCalled()
  })

  it('sends a booking with tiers to the ladder, and keeps one without on the legacy rule', async () => {
    const db = buildDb()

    const { body } = await runSweep()

    expect(body.success).toBe(true)
    const [, input] = vi.mocked(runPreorderLadder).mock.calls[0]
    expect(input.bookings.map((booking) => booking.id)).toEqual(['xmas-ladder'])
    expect(input.ledger).toEqual(LEDGER)
    expect(input.now.toISOString()).toBe('2026-11-21T12:00:30.000Z')
    expect(Array.from(input.cutoffByPeriod.entries())).toEqual([['period-xmas', 7]])
    // The legacy rule is asked about the legacy booking only.
    expect(vi.mocked(decideLegacyPreorderChases)).toHaveBeenCalledTimes(1)
    // The window reaches the ladder's first rung, 21 days out, and the ledger read names the seat.
    const bookingQuery = db.queries.find((query) => query.table === 'table_bookings')!
    expect(argsOf(bookingQuery, 'lte')[0]).toEqual(['booking_date', '2026-12-12'])
    expect(bookingQuery.calls.find((call) => call.method === 'select')?.args[0]).toContain('created_at')
    const ledgerQuery = db.queries.find((query) => query.table === 'booking_preorder_reminders')!
    expect(ledgerQuery.calls.find((call) => call.method === 'select')?.args[0]).toBe('table_booking_id, kind, cover_id, sent_at')
  })

  it('clears guest addresses after their booking, every run', async () => {
    vi.mocked(purgeGuestInviteEmails).mockResolvedValueOnce(3)
    buildDb()

    const { body } = await runSweep()

    expect(purgeGuestInviteEmails).toHaveBeenCalledWith(expect.anything(), '2026-11-21')
    expect(body.result.inviteEmailsCleared).toBe(3)
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('reports a ladder message that did not go, with the reference and never an address', async () => {
    vi.mocked(runPreorderLadder).mockResolvedValueOnce({
      ...emptyLadderResult(),
      failed: 1,
      failures: [{ bookingId: 'xmas-ladder', reference: 'TB-LADDER', kind: 'booker_21d', outcome: 'failed', error: 'email: provider down' }],
    })
    buildDb()

    const { body } = await runSweep()

    expect(body.result.ladder.failed).toBe(1)
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
    const [name, error, context] = vi.mocked(reportCronFailure).mock.calls[0]
    expect(name).toBe('preorder-reminders')
    expect(String((error as Error).message)).toContain('1 ladder message(s) not sent')
    expect(context).toEqual({
      failures: [{ reference: 'TB-LADDER', kind: 'booker_21d', outcome: 'failed', error: 'email: provider down' }],
    })
  })

  it('reports a purge that failed', async () => {
    vi.mocked(purgeGuestInviteEmails).mockRejectedValueOnce(new Error('db down'))
    buildDb()

    const { body } = await runSweep()

    expect(body.result.inviteEmailsCleared).toBeNull()
    expect(String((vi.mocked(reportCronFailure).mock.calls[0][1] as Error).message)).toContain('guest invite emails not cleared')
  })

  it('reports a sweep that could not start, as before', async () => {
    const db = createRecordingSupabase({
      tables: { booking_periods: () => ({ data: null, error: { message: 'db down' } }) },
    })
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const { status } = await runSweep()

    expect(status).toBe(500)
    expect(reportCronFailure).toHaveBeenCalledWith('preorder-reminders', expect.anything())
  })
})
