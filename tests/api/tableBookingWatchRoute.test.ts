import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

/**
 * The hourly table booking watch route: it refuses a caller without the cron secret, answers 200
 * when its checks ran (whether or not an alert went), and answers with an error when a check could
 * not be made, so the run is recorded as failed and the failure is emailed like any other job's.
 */

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportCronFailure: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/table-bookings/booking-watch', () => ({ runTableBookingWatch: vi.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/table-booking-watch/route'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTableBookingWatch } from '@/lib/table-bookings/booking-watch'

function request() {
  return new NextRequest('http://localhost/api/cron/table-booking-watch')
}

let db: ReturnType<typeof createFakeDb>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authorizeCronRequest).mockReturnValue({ authorized: true } as never)
  db = createFakeDb({ cron_job_runs: [] })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
})

describe('GET /api/cron/table-booking-watch', () => {
  it('refuses a caller without the cron secret and records nothing', async () => {
    vi.mocked(authorizeCronRequest).mockReturnValue({ authorized: false, reason: 'Unauthorized' } as never)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(runTableBookingWatch).not.toHaveBeenCalled()
    expect(db.rows('cron_job_runs')).toHaveLength(0)
  })

  it('answers 200 and records a completed run when the checks ran', async () => {
    vi.mocked(runTableBookingWatch).mockResolvedValue([
      { kind: 'quiet_bookings', alert: 'sent' },
      { kind: 'website_silent', alert: 'not_needed' },
      { kind: 'booking_api_errors', alert: 'already_sent' },
    ])
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, alertsSent: 1, checksFailed: 0 })
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'table-booking-watch', status: 'completed' }),
    ])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('fails the run, and says which check, when one could not be made', async () => {
    vi.mocked(runTableBookingWatch).mockResolvedValue([
      { kind: 'quiet_bookings', alert: 'failed', error: 'Could not read the latest website booking: timeout' },
      { kind: 'website_silent', alert: 'not_needed' },
      { kind: 'booking_api_errors', alert: 'not_needed' },
    ])
    const response = await GET(request())
    expect(response.status).toBe(502)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({
        job_name: 'table-booking-watch',
        status: 'failed',
        error_message: expect.stringContaining('quiet_bookings: Could not read the latest website booking'),
      }),
    ])
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })
})
