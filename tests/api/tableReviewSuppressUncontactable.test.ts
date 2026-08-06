import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

// The two review helpers are network-shaped and irrelevant here: this test is
// about the branch that runs BEFORE either of them can matter.
vi.mock('@/lib/sms/review-once', () => ({
  hasCustomerReviewed: vi.fn().mockResolvedValue(new Set<string>()),
  getFirstVisitReviewEligibleCandidateKeys: vi
    .fn()
    .mockResolvedValue(new Set<string>(['table:booking-uncontactable'])),
  reviewVisitCandidateKey: (candidate: { channel: string; bookingId: string }) =>
    `${candidate.channel}:${candidate.bookingId}`,
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { sendEmail } from '@/lib/email/emailService'
import { GET } from '@/app/api/cron/event-guest-engagement/route'

/**
 * A guest with neither a usable email nor an active mobile cannot be asked for a
 * review. The sweep used to `skipped++` and move on without flagging the
 * booking, so it stayed `confirmed` and eligible: re-read every fifteen minutes
 * until it aged out of the seven-day window, then stuck at `confirmed` forever.
 * 187 of the 221 permanently unreviewed bookings on record got there that way.
 *
 * The booking below sits eight hours in the past, so it is comfortably past the
 * four-hour delay and well inside the seven-day window. It is eligible in every
 * respect except that there is nobody to send to.
 */
function buildSupabase(options: { capture: { update?: Record<string, unknown> } }) {
  const bookingStartIso = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()

  // The sweep touches a dozen tables with a dozen different builder shapes, and
  // none of them matter to this test. Rather than hand-model each one, this is a
  // chain that accepts any method in any order and resolves to "nothing" the
  // moment it is awaited, at whatever depth that happens.
  const emptyChain = (final: unknown = { data: [], error: null }) => {
    const proxy: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then') {
            return (resolve: (value: unknown) => void) => resolve(final)
          }
          return () => proxy
        },
      }
    )
    return proxy
  }

  const theBooking = {
    id: 'booking-uncontactable',
    customer_id: 'customer-uncontactable',
    status: 'confirmed',
    booking_type: 'regular',
    start_datetime: bookingStartIso,
    review_sms_sent_at: null,
    review_suppressed_at: null,
    customer: {
      id: 'customer-uncontactable',
      first_name: 'Sam',
      // Nothing to reach them on, which is the whole point of the test.
      mobile_number: null,
      email: null,
      sms_status: 'inactive',
      email_status: null,
      email_deactivated_at: null,
    },
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'cron_job_runs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  })),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
            })),
          })),
          update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        }
      }

      if (table === 'table_bookings') {
        const readChain = emptyChain({ data: [theBooking], error: null, count: 0 })
        return {
          select: () => readChain,
          update: vi.fn((payload: Record<string, unknown>) => {
            options.capture.update = payload
            return emptyChain({ data: null, error: null })
          }),
        }
      }

      // Every other table this sweep touches has nothing to contribute here.
      // The shape covers both the row queries and the count queries, so one
      // chain serves the lot.
      return emptyChain({ data: [], error: null, count: 0 })
    }),
  }
}

describe('table review sweep: guests with no contactable channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function run() {
    const capture: { update?: Record<string, unknown> } = {}
    const supabase = buildSupabase({ capture })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const request: any = new Request('http://localhost/api/cron/event-guest-engagement')
    request.nextUrl = new URL('http://localhost')

    const response = await GET(request)
    return { response, payload: await response.json(), capture, supabase }
  }

  it('flags the booking as review-suppressed so it stops being re-read forever', async () => {
    const { response, capture } = await run()

    expect(response.status).toBe(200)
    expect(capture.update).toBeDefined()
    expect(capture.update).toHaveProperty('review_suppressed_at')
    expect(capture.update?.review_suppressed_at).toEqual(expect.any(String))
  })

  it('sends the guest nothing, because there is nothing to send to', async () => {
    await run()

    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
