import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The table-booking review ask is email-first, and only `sendSMS` rewrites URLs
 * at send time (src/lib/twilio.ts). So the email went out carrying the raw
 * 81-character `/r/<43-char token>` URL while the SMS fallback carried a short
 * one. A real guest received exactly that on 2026-09-06.
 *
 * This test drives the cron end to end and asserts on what actually lands in the
 * guest's inbox: the short link, and no trace of the long one.
 */

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
  sendSMS: vi.fn().mockResolvedValue({ success: true, sid: 'SM1' }),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

const createShortLinkInternalMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/short-links', () => ({
  ShortLinkService: {
    createShortLinkInternal: createShortLinkInternalMock,
  },
}))

vi.mock('@/lib/sms/review-once', () => ({
  hasCustomerReviewed: vi.fn().mockResolvedValue(new Set<string>()),
  getFirstVisitReviewEligibleCandidateKeys: vi
    .fn()
    .mockResolvedValue(new Set<string>(['table:booking-emailable'])),
  reviewVisitCandidateKey: (candidate: { channel: string; bookingId: string }) =>
    `${candidate.channel}:${candidate.bookingId}`,
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { GET } from '@/app/api/cron/event-guest-engagement/route'

const SHORT_URL = 'https://l.the-anchor.pub/rev123'

function buildSupabase() {
  const bookingStartIso = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()

  // Same permissive chain as tableReviewSuppressUncontactable.test.ts: the sweep
  // touches a dozen tables with a dozen builder shapes and none of them matter
  // to what the guest receives.
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
    id: 'booking-emailable',
    customer_id: 'customer-emailable',
    status: 'confirmed',
    booking_type: 'regular',
    start_datetime: bookingStartIso,
    review_sms_sent_at: null,
    review_suppressed_at: null,
    customer: {
      id: 'customer-emailable',
      first_name: 'Philippa',
      mobile_number: null,
      email: 'philippa@example.com',
      sms_status: 'inactive',
      email_status: 'active',
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
          update: vi.fn(() => emptyChain({ data: null, error: null })),
        }
      }

      return emptyChain({ data: [], error: null, count: 0 })
    }),
  }
}

async function run() {
  ;(createAdminClient as unknown as vi.Mock).mockReturnValue(buildSupabase())

  const request: any = new Request('http://localhost/api/cron/event-guest-engagement')
  request.nextUrl = new URL('http://localhost')

  const response = await GET(request)
  return { response, payload: await response.json() }
}

function reviewEmailCall() {
  return (sendEmail as unknown as vi.Mock).mock.calls.find(
    ([options]) => options?.subject === 'Thanks for visiting The Anchor'
  )?.[0]
}

describe('table review email: link shortening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    createShortLinkInternalMock.mockResolvedValue({
      short_code: 'rev123',
      full_url: SHORT_URL,
      already_exists: false,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the review email with the shortened link in both the html and the plain text', async () => {
    await run()

    const email = reviewEmailCall()
    expect(email).toBeDefined()
    expect(email.html).toContain(`href="${SHORT_URL}"`)
    expect(email.text).toContain(SHORT_URL)
  })

  it('leaves no long /r/ token URL anywhere in the email', async () => {
    await run()

    const email = reviewEmailCall()
    expect(email.html).not.toContain('/r/')
    expect(email.text).not.toContain('/r/')
    expect(email.html).not.toContain('management.orangejelly.co.uk')
    expect(email.text).not.toContain('management.orangejelly.co.uk')
  })

  it('shortens the /r/ URL exactly once, tagged as a guest review link', async () => {
    await run()

    expect(createShortLinkInternalMock).toHaveBeenCalledTimes(1)
    const [payload] = createShortLinkInternalMock.mock.calls[0]
    expect(payload.destination_url).toMatch(/\/r\/[A-Za-z0-9_-]+$/)
    expect(payload.link_type).toBe('custom')
    expect(payload.metadata.guest_link_kind).toBe('guest_review')
    expect(payload.metadata.table_booking_id).toBe('booking-emailable')
    expect(payload.metadata.customer_id).toBe('customer-emailable')
    // An expiry would send a late tapper to the venue homepage instead of the
    // review funnel, so the row must not carry one.
    expect(payload.expires_at).toBeUndefined()
  })

  // The character saving is worth less than the review. If the short link cannot
  // be minted the guest still gets a working long URL.
  it('still sends the ask with the long URL when shortening fails', async () => {
    createShortLinkInternalMock.mockRejectedValue(new Error('short link service down'))

    const { payload } = await run()

    const email = reviewEmailCall()
    expect(email).toBeDefined()
    expect(email.text).toMatch(/https?:\/\/\S+\/r\/[A-Za-z0-9_-]{20,}/)
    expect(email.html).toMatch(/href="https?:\/\/\S+\/r\/[A-Za-z0-9_-]{20,}"/)

    // The fallback has to be countable, or a run where shortening silently stopped
    // working would look identical to a healthy one.
    expect(payload.tableReviews.shortLinkFallbacks).toBe(1)
  })
})
