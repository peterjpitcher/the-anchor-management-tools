import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-116 (customer bookings review of 24 October 2026): event hold expiry, the event PayPal
 * check, event payment reminders, waitlist offers, the private hire deposit check, private hire
 * hold expiry and the job queue wrote a log line when they failed and told nobody, and left no
 * run record for the dashboard or a daily check to read. Each now records its run and emails the
 * alert inbox when it fails.
 */

const { reportCronFailure, processJobs } = vi.hoisted(() => ({
  reportCronFailure: vi.fn(async () => undefined),
  processJobs: vi.fn(async () => undefined),
}))

vi.mock('@/lib/cron/alerting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cron/alerting')>()),
  reportCronFailure,
}))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { processJobs } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET as eventBookingHolds } from '@/app/api/cron/event-booking-holds/route'
import { GET as eventPayPalReconciliation } from '@/app/api/cron/event-paypal-reconciliation/route'
import { GET as eventPaymentReminders } from '@/app/api/cron/event-payment-reminders/route'
import { GET as eventWaitlistOffers } from '@/app/api/cron/event-waitlist-offers/route'
import { GET as privateDepositReconciliation } from '@/app/api/cron/paypal-deposit-reconciliation/route'
import { GET as privateExpireHolds } from '@/app/api/cron/private-bookings-expire-holds/route'
import { GET as jobQueueGet, POST as jobQueuePost } from '@/app/api/jobs/process/route'

let db: FakeDb

function request(path: string, method = 'GET'): NextRequest {
  return new NextRequest(`https://management.example${path}`, { method, headers: { authorization: 'Bearer secret' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
})

const FAILING_ROUTES = [
  { jobName: 'event-booking-holds', path: '/api/cron/event-booking-holds', handler: eventBookingHolds, table: 'bookings', operation: 'select' as const },
  { jobName: 'event-paypal-reconciliation', path: '/api/cron/event-paypal-reconciliation', handler: eventPayPalReconciliation, table: 'payments', operation: 'select' as const },
  { jobName: 'event-payment-reminders', path: '/api/cron/event-payment-reminders', handler: eventPaymentReminders, table: 'bookings', operation: 'select' as const },
  { jobName: 'event-waitlist-offers', path: '/api/cron/event-waitlist-offers', handler: eventWaitlistOffers, table: 'waitlist_entries', operation: 'select' as const },
  { jobName: 'paypal-deposit-reconciliation', path: '/api/cron/paypal-deposit-reconciliation', handler: privateDepositReconciliation, table: 'private_bookings', operation: 'select' as const },
  { jobName: 'private-bookings-expire-holds', path: '/api/cron/private-bookings-expire-holds', handler: privateExpireHolds, table: 'private_bookings', operation: 'select' as const },
]

describe('booking crons record failed runs and alert', () => {
  it.each(FAILING_ROUTES.map((route) => [route.jobName, route] as const))(
    '%s: a failed run is recorded and emailed',
    async (_name, route) => {
      db.failNext({ table: route.table, operation: route.operation, message: 'relation does not exist' })

      const response = await route.handler(request(route.path))

      expect(response.status).toBe(500)
      const rows = db.rows('cron_job_runs')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ job_name: route.jobName, status: 'failed' })
      expect(reportCronFailure).toHaveBeenCalledTimes(1)
      expect(reportCronFailure).toHaveBeenCalledWith(route.jobName, expect.any(Error), expect.objectContaining({ httpStatus: 500 }))
    },
  )

  it('records a quiet successful run without an alert', async () => {
    const response = await eventPaymentReminders(request('/api/cron/event-payment-reminders'))

    expect(response.status).toBe(200)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'event-payment-reminders', status: 'completed', result: expect.objectContaining({ checked: 0, itemFailures: 0 }) }),
    ])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })
})

describe('job queue', () => {
  it('records an hourly heartbeat for a run, and nothing for a health check', async () => {
    await jobQueueGet(request('/api/jobs/process?process=false'))
    expect(db.rows('cron_job_runs')).toHaveLength(0)

    const response = await jobQueuePost(request('/api/jobs/process', 'POST'))

    expect(response.status).toBe(200)
    expect(processJobs).toHaveBeenCalledTimes(1)
    expect(db.rows('cron_job_runs')).toEqual([
      expect.objectContaining({ job_name: 'job-queue', status: 'completed', run_key: expect.stringMatching(/^hour:/) }),
    ])
  })

  it('records and emails a run that throws', async () => {
    processJobs.mockRejectedValueOnce(new Error('jobs table missing'))

    const response = await jobQueueGet(request('/api/jobs/process?process=true&batch=30'))

    expect(response.status).toBe(500)
    expect(db.rows('cron_job_runs')).toEqual([expect.objectContaining({ job_name: 'job-queue', status: 'failed' })])
    expect(reportCronFailure).toHaveBeenCalledWith('job-queue', expect.any(Error), expect.objectContaining({ httpStatus: 500 }))
  })
})
