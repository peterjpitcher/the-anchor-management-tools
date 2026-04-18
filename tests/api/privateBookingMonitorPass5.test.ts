import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn().mockReturnValue({ authorized: true })
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn()
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    queueAndSend: vi.fn().mockResolvedValue({ success: true, sent: true })
  }
}))

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    expireBooking: vi.fn().mockResolvedValue({ smsSent: false })
  }
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn()
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' })
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendPrivateBookingOutcomeEmail: vi.fn()
}))

vi.mock('@/lib/events/review-link', () => ({
  getGoogleReviewLink: vi.fn().mockResolvedValue('https://g.page/r/test-review-link')
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { sendPrivateBookingOutcomeEmail } from '@/lib/private-bookings/manager-notifications'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

const YESTERDAY_LONDON = (() => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  return formatter.format(new Date(Date.now() - 24 * 60 * 60 * 1000))
})()

type MockCapture = {
  bookingUpdates: Array<{ filter: Record<string, unknown>; payload: Record<string, unknown> }>
  idempotencyInserts: Array<Record<string, unknown>>
  updateReturnsForReviewClaim: Array<{ id: string } | null>
}

function buildBaseSupabase(options: {
  outcomeEmailRows?: Array<Record<string, unknown>>
  reviewSmsRows?: Array<Record<string, unknown>>
  idempotencyError?: { code?: string; message?: string } | null
  reviewClaimOverride?: Array<{ id: string } | null>
  outcomeStampError?: { message: string } | null
}) {
  const capture: MockCapture = {
    bookingUpdates: [],
    idempotencyInserts: [],
    updateReturnsForReviewClaim: options.reviewClaimOverride ?? []
  }

  let reviewClaimCursor = 0

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'cron_job_runs') {
        return {
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null })
            })
          })
        }
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                gte: vi.fn().mockResolvedValue({ count: 0, error: null })
              })
            })
          })
        }
      }
      if (table === 'private_booking_sms_queue') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: vi.fn().mockResolvedValue({ count: 0, error: null })
              })
            })
          })
        }
      }
      if (table === 'private_bookings_with_details') {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                lte: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            })
          })
        }
      }
      if (table === 'private_booking_send_idempotency') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            capture.idempotencyInserts.push(row)
            return Promise.resolve({
              data: null,
              error: options.idempotencyError ?? null
            })
          })
        }
      }
      if (table === 'private_bookings') {
        return {
          select: vi.fn((columns: string) => {
            if (columns.startsWith('id, hold_expiry')) {
              return {
                eq: () => ({
                  lt: () => ({
                    not: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              }
            }
            if (columns.includes('hold_expiry, event_date')) {
              return {
                eq: () => ({
                  gt: () => ({
                    not: vi.fn().mockResolvedValue({ data: [], error: null })
                  })
                })
              }
            }
            if (columns.includes('outcome_email_sent_at')) {
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      is: vi
                        .fn()
                        .mockResolvedValue({ data: options.outcomeEmailRows ?? [], error: null })
                    })
                  })
                })
              }
            }
            if (columns.includes('review_sms_sent_at')) {
              return {
                eq: () => ({
                  is: () => ({
                    neq: () => ({
                      gte: () => ({
                        lte: vi
                          .fn()
                          .mockResolvedValue({ data: options.reviewSmsRows ?? [], error: null })
                      })
                    })
                  })
                })
              }
            }
            if (columns.includes('start_time, guest_count')) {
              return {
                eq: () => ({
                  eq: vi.fn().mockResolvedValue({ data: [], error: null })
                })
              }
            }
            throw new Error(`Unexpected private_bookings select: ${columns}`)
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            const filter: Record<string, unknown> = {}
            return {
              eq: vi.fn((col: string, val: unknown) => {
                filter[col] = val
                return {
                  is: vi.fn((col2: string, _val: null) => {
                    filter[col2] = 'IS NULL'
                    // Record the update once per is() call.
                    const localFilter = { ...filter }
                    capture.bookingUpdates.push({ filter: localFilter, payload })

                    // For the outcome-email stamp path (no .select chained), this
                    // object is `await`-ed directly. For the review-SMS atomic
                    // claim path, .select().maybeSingle() is called. Support both
                    // by returning a thenable AND exposing .select().
                    const stampThenable = {
                      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                        Promise.resolve({ data: null, error: options.outcomeStampError ?? null })
                          .then(resolve, reject),
                      select: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => {
                          // Use index-based lookup so explicit `null` overrides still
                          // read as null (not masked by a default).
                          const hasOverride =
                            reviewClaimCursor < capture.updateReturnsForReviewClaim.length
                          const next = hasOverride
                            ? capture.updateReturnsForReviewClaim[reviewClaimCursor]
                            : { id: 'ok' }
                          reviewClaimCursor += 1
                          return { data: next, error: null }
                        })
                      }))
                    }
                    return stampThenable
                  }),
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({ data: null, error: null }))
                  })),
                  maybeSingle: vi.fn(async () => ({ data: null, error: null }))
                }
              })
            }
          })
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
  }

  return { supabase, capture }
}

describe('private booking monitor Pass 5a — outcome email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendPrivateBookingOutcomeEmail as unknown as vi.Mock).mockResolvedValue({
      success: true,
      tokenIds: ['hashed-1', 'hashed-2', 'hashed-3']
    })
  })

  it('sends the outcome email for an eligible booking and stamps outcome_email_sent_at', async () => {
    const { supabase, capture } = buildBaseSupabase({
      outcomeEmailRows: [
        {
          id: 'bk-1',
          customer_name: 'Sarah Jones',
          customer_first_name: 'Sarah',
          event_date: YESTERDAY_LONDON,
          guest_count: 20,
          status: 'confirmed',
          post_event_outcome: 'pending',
          outcome_email_sent_at: null,
          internal_notes: null
        }
      ]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stats.outcomeEmailsSent).toBe(1)

    expect(sendPrivateBookingOutcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'bk-1',
        customerName: 'Sarah Jones',
        guestCount: 20
      })
    )

    // Atomic claim update occurred with is.outcome_email_sent_at null guard.
    const stampUpdate = capture.bookingUpdates.find(
      (u) => u.payload.outcome_email_sent_at !== undefined
    )
    expect(stampUpdate).toBeDefined()
    expect(stampUpdate?.filter).toMatchObject({ id: 'bk-1', outcome_email_sent_at: 'IS NULL' })
  })

  it('skips the outcome email path when no eligible bookings are returned', async () => {
    const { supabase } = buildBaseSupabase({ outcomeEmailRows: [] })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.outcomeEmailsSent).toBe(0)
    expect(sendPrivateBookingOutcomeEmail).not.toHaveBeenCalled()
  })

  it('skips stamping when sendPrivateBookingOutcomeEmail fails', async () => {
    ;(sendPrivateBookingOutcomeEmail as unknown as vi.Mock).mockResolvedValue({
      success: false,
      tokenIds: [],
      error: 'smtp down'
    })

    const { supabase, capture } = buildBaseSupabase({
      outcomeEmailRows: [
        {
          id: 'bk-broken',
          customer_name: 'Broken Customer',
          customer_first_name: 'Broken',
          event_date: YESTERDAY_LONDON,
          guest_count: 10,
          status: 'confirmed',
          post_event_outcome: 'pending',
          outcome_email_sent_at: null,
          internal_notes: null
        }
      ]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.outcomeEmailsSent).toBe(0)

    // No stamping update should have been queued for this booking.
    const stampUpdate = capture.bookingUpdates.find(
      (u) => u.filter.id === 'bk-broken' && u.payload.outcome_email_sent_at !== undefined
    )
    expect(stampUpdate).toBeUndefined()
  })

  it('suppresses the send when the booking date is TBD', async () => {
    const { supabase } = buildBaseSupabase({
      outcomeEmailRows: [
        {
          id: 'bk-tbd',
          customer_name: 'TBD Customer',
          customer_first_name: 'TBD',
          event_date: YESTERDAY_LONDON,
          guest_count: 5,
          status: 'confirmed',
          post_event_outcome: 'pending',
          outcome_email_sent_at: null,
          internal_notes: 'Event date/time to be confirmed'
        }
      ]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.outcomeEmailsSent).toBe(0)
    expect(sendPrivateBookingOutcomeEmail).not.toHaveBeenCalled()
  })
})

describe('private booking monitor Pass 5b — review SMS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(SmsQueueService.queueAndSend as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sent: true
    })
    ;(sendPrivateBookingOutcomeEmail as unknown as vi.Mock).mockResolvedValue({
      success: true,
      tokenIds: []
    })
  })

  it('sends the review SMS for a went_well booking with review_sms_sent_at null', async () => {
    const { supabase, capture } = buildBaseSupabase({
      reviewSmsRows: [
        {
          id: 'bk-review-1',
          customer_id: 'cust-1',
          customer_first_name: 'Sam',
          customer_name: 'Sam Patel',
          contact_phone: '+447700900999',
          event_date: YESTERDAY_LONDON,
          post_event_outcome: 'went_well',
          review_sms_sent_at: null,
          status: 'confirmed',
          internal_notes: null
        }
      ],
      reviewClaimOverride: [{ id: 'bk-review-1' }]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.reviewRequestsSent).toBe(1)

    // Review SMS queueAndSend called with the new trigger_type.
    expect(SmsQueueService.queueAndSend).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'bk-review-1',
        trigger_type: 'review_request',
        template_key: 'private_booking_review_request'
      })
    )

    // Atomic claim set review_sms_sent_at with is.review_sms_sent_at=null guard.
    const claimUpdate = capture.bookingUpdates.find(
      (u) => u.payload.review_sms_sent_at !== undefined && u.filter.id === 'bk-review-1'
    )
    expect(claimUpdate).toBeDefined()
    expect(claimUpdate?.filter).toMatchObject({ review_sms_sent_at: 'IS NULL' })

    // Idempotency reservation happened AFTER the column claim.
    expect(capture.idempotencyInserts).toHaveLength(1)
    expect(capture.idempotencyInserts[0]).toMatchObject({
      idempotency_key: `bk-review-1:review_request:${YESTERDAY_LONDON}`,
      booking_id: 'bk-review-1',
      trigger_type: 'review_request',
      window_key: YESTERDAY_LONDON
    })
  })

  it('skips when no bookings are eligible (outcome never recorded as went_well)', async () => {
    const { supabase } = buildBaseSupabase({ reviewSmsRows: [] })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.reviewRequestsSent).toBe(0)
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
  })

  it('skips the SMS when the review_sms column race is already lost', async () => {
    const { supabase, capture } = buildBaseSupabase({
      reviewSmsRows: [
        {
          id: 'bk-raced',
          customer_id: 'cust-2',
          customer_first_name: 'R',
          customer_name: 'Raced Customer',
          contact_phone: '+447700900111',
          event_date: YESTERDAY_LONDON,
          post_event_outcome: 'went_well',
          review_sms_sent_at: null,
          status: 'confirmed',
          internal_notes: null
        }
      ],
      // Simulate another cron run winning the atomic claim.
      reviewClaimOverride: [null]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.reviewRequestsSent).toBe(0)
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
    expect(capture.idempotencyInserts).toHaveLength(0)
  })

  it('skips the SMS when the idempotency reservation already exists (23505)', async () => {
    const { supabase, capture } = buildBaseSupabase({
      reviewSmsRows: [
        {
          id: 'bk-dup',
          customer_id: 'cust-3',
          customer_first_name: 'Dup',
          customer_name: 'Dup Customer',
          contact_phone: '+447700900222',
          event_date: YESTERDAY_LONDON,
          post_event_outcome: 'went_well',
          review_sms_sent_at: null,
          status: 'confirmed',
          internal_notes: null
        }
      ],
      reviewClaimOverride: [{ id: 'bk-dup' }],
      idempotencyError: { code: '23505', message: 'duplicate key value violates unique constraint' }
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.reviewRequestsSent).toBe(0)
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
    expect(capture.idempotencyInserts).toHaveLength(1)
  })

  it('suppresses the send when the booking date is TBD', async () => {
    const { supabase, capture } = buildBaseSupabase({
      reviewSmsRows: [
        {
          id: 'bk-tbd',
          customer_id: 'cust-tbd',
          customer_first_name: 'T',
          customer_name: 'TBD Customer',
          contact_phone: '+447700900333',
          event_date: YESTERDAY_LONDON,
          post_event_outcome: 'went_well',
          review_sms_sent_at: null,
          status: 'confirmed',
          internal_notes: 'Event date/time to be confirmed'
        }
      ]
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.stats.reviewRequestsSent).toBe(0)
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
    // No atomic claim update should have been attempted.
    const claim = capture.bookingUpdates.find(
      (u) => u.filter.id === 'bk-tbd' && u.payload.review_sms_sent_at !== undefined
    )
    expect(claim).toBeUndefined()
  })
})
