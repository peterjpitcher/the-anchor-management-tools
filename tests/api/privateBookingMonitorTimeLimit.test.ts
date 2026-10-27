import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    queueAndSend: vi.fn(),
  },
}))

// Which reminders go is under test, not the channel: the messenger hands each to the queue.
vi.mock('@/lib/private-bookings/messenger', async () => {
  const { SmsQueueService } = await import('@/services/sms-queue')
  return {
    sendPrivateBookingMessage: vi.fn((input: { sms: Parameters<typeof SmsQueueService.queueAndSend>[0] }) =>
      SmsQueueService.queueAndSend(input.sms)),
  }
})

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    expireBooking: vi.fn(),
  },
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/sms/review-once', () => ({
  hasCustomerReviewed: vi.fn().mockResolvedValue(new Set()),
}))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn().mockResolvedValue({ rawToken: 'test-token', hashedToken: 'hashed' }),
}))

vi.mock('@/lib/events/review-link', () => ({
  getGoogleReviewLink: vi.fn().mockResolvedValue('https://g.page/r/test'),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn().mockImplementation((body: string) => body),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { reportCronFailure } from '@/lib/cron/alerting'
import { GET, maxDuration } from '@/app/api/cron/private-booking-monitor/route'

/**
 * BK-212 (customer bookings review of 24 October 2026). The daily private hire monitor ran on the
 * 15-second project default and keys its run on the London date, so a run cut off part way
 * skipped the rest of that day's reminders and chasers with no record and no alert. It now has a
 * 300-second limit, and each per-booking loop checks a deadline before the next booking: a run
 * that reaches it stops cleanly, keeps what it did not reach in cron_job_runs.result, is marked
 * failed so a second call that day finishes the work, and emails the alert inbox.
 */
const HOLD_EXPIRY = '2026-10-13T22:59:59.000Z'

async function runOn(day: string, options: { clockJumpMs?: number } = {}): Promise<{ triggers: string[]; body: Record<string, unknown> }> {
  vi.clearAllMocks()
  ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })
  ;(SmsQueueService.queueAndSend as unknown as Mock).mockResolvedValue({ success: true, sent: true })
  vi.setSystemTime(new Date(`${day}T09:00:00.000Z`))
  const draftBooking = {
    id: 'booking-1',
    customer_first_name: 'Sarah',
    customer_name: 'Sarah Jones',
    contact_phone: '+447700900123',
    hold_expiry: HOLD_EXPIRY,
    event_date: '2026-11-28T18:00:00.000Z',
    customer_id: 'customer-1',
    deposit_amount: 250,
    internal_notes: null,
  }
      const idempotencyInsert = vi.fn().mockResolvedValue({ data: null, error: null })

      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'cron_job_runs') {
            return {
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
                })),
              })),
            }
          }

          if (table === 'messages') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            }
          }

          if (table === 'private_bookings') {
            return {
              select: vi.fn((columns: string) => {
                if (columns.startsWith('id, hold_expiry')) {
                  // Pass 2 (expired drafts)
                  return {
                    eq: vi.fn(() => ({
                      lt: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
                  }
                }
                if (columns.includes('hold_expiry')) {
                  // Pass 1 draft reminders. The clock jumps while the drafts are read, as a slow
                  // run would, so the loop meets its deadline at the first booking.
                  return {
                    eq: vi.fn(() => ({
                      gt: vi.fn(() => ({
                        // Pass 1 also leaves out a deposit still to be confirmed: a second .not().
                        not: vi.fn(() => ({
                          not: vi.fn(async () => {
                            if (options.clockJumpMs) vi.setSystemTime(Date.now() + options.clockJumpMs)
                            return { data: [draftBooking, { ...draftBooking, id: 'booking-2' }], error: null }
                          }),
                        })),
                      })),
                    })),
                  }
                }
                if (columns.includes('start_time, guest_count')) {
                  // Pass 4 event reminder: .or(live hire statuses).eq('event_date', tomorrow)
                  const byDate = () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })
                  return { eq: vi.fn(byDate), or: vi.fn(byDate) }
                }
                if (columns.includes('outcome_email_sent_at')) {
                  // Pass 5a: outcome email eligibility, .eq(date).or(live hire statuses).eq(outcome).is(sent)
                  const byOutcome = () => ({
                    eq: vi.fn(() => ({ is: vi.fn().mockResolvedValue({ data: [], error: null }) })),
                  })
                  return { eq: vi.fn(() => ({ eq: vi.fn(byOutcome), or: vi.fn(byOutcome) })) }
                }
                if (columns.includes('review_sms_sent_at')) {
                  // Pass 5b: review SMS eligibility
                  return {
                    eq: vi.fn(() => ({
                      is: vi.fn(() => ({
                        neq: vi.fn(() => ({
                          gte: vi.fn(() => ({
                            lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                          })),
                        })),
                      })),
                    })),
                  }
                }
                // PASS 6: post-event inspection sweep (no eligible bookings in these tests)
                if (columns === 'id, status, event_date, invoice_deposit_treatment') {
                  return {
                    or: () => ({
                      not: () => ({
                        is: () => ({
                          is: () => ({
                            limit: vi.fn().mockResolvedValue({ data: [], error: null })
                          })
                        })
                      })
                    })
                  }
                }
                throw new Error(`Unexpected private_bookings select: ${columns}`)
              }),
            }
          }

          if (table === 'private_booking_sms_queue') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    // .or(...) keys the legacy dedup to the reminder's date
                    or: vi.fn(() => ({
                      in: vi.fn().mockResolvedValue({ count: 0, error: null }),
                    })),
                  })),
                })),
              })),
            }
          }

          if (table === 'private_bookings_with_details') {
            // Pass 3: .or(live hire statuses).not('balance_due_date', 'is', null)
            //   .gte('balance_due_date', today).lte('balance_due_date', today+7)
            const balanceChain = () => ({
              not: vi.fn(() => ({
                gte: vi.fn(() => ({
                  lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })
            return {
              select: vi.fn(() => ({ eq: vi.fn(balanceChain), or: vi.fn(balanceChain) })),
            }
          }

          if (table === 'private_booking_send_idempotency') {
            return { insert: idempotencyInsert }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)
  const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
  expect(response.status).toBe(200)
  return {
    triggers: idempotencyInsert.mock.calls.map((call) => (call[0] as { trigger_type: string }).trigger_type),
    body: (await response.json()) as Record<string, unknown>,
  }
}

describe('private booking monitor time limit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('has a five-minute limit of its own', () => {
    expect(maxDuration).toBe(300)
  })

  it('finishes and records a completed run when there is time', async () => {
    const { triggers, body } = await runOn('2026-10-06')

    expect(triggers).toEqual(['deposit_reminder_7day', 'deposit_reminder_7day'])
    expect(body.deadline).toBeNull()
    expect(persistCronRunResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'completed', result: undefined }))
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('stops before the next booking at its deadline, records what it skipped and alerts', async () => {
    const { triggers, body } = await runOn('2026-10-06', { clockJumpMs: maxDuration * 1000 })

    expect(triggers).toEqual([])
    expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
    const skipped = { stoppedIn: 'deposit_reminders', skipped: [{ stage: 'deposit_reminders', items: 2 }] }
    expect(body.deadline).toEqual(skipped)
    expect(persistCronRunResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('Stopped at its time limit in deposit_reminders'),
        result: expect.objectContaining({ deadline: skipped }),
      }),
    )
    expect(reportCronFailure).toHaveBeenCalledWith(
      'private-booking-monitor',
      expect.any(Error),
      expect.objectContaining({ stoppedIn: 'deposit_reminders', skipped: 'deposit_reminders: 2 booking(s)' }),
    )
  })
})
