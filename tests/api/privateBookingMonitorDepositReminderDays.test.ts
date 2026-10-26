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

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn().mockImplementation((body: string) => body),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

/**
 * BK-009 (customer bookings review of 24 October 2026). Since 12 September a deposit hold ends at
 * 23:59 London on its deadline day. The job counted the days left in elapsed hours, so every
 * reminder landed a day late: "7 days" with 6 left, the 3-day one 2 days out, and "tomorrow" on the
 * deadline day itself. It now counts London calendar days, as the preview and the wording do.
 *
 * Hold ends 2026-10-13T22:59:59Z (23:59 BST). The job runs at 09:00 UTC on each of the last days.
 */
const HOLD_EXPIRY = '2026-10-13T22:59:59.000Z'

async function runOn(day: string): Promise<{ triggers: string[]; bodies: string[] }> {
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
                  // Pass 1 draft reminders
                  return {
                    eq: vi.fn(() => ({
                      gt: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({ data: [draftBooking], error: null }),
                      })),
                    })),
                  }
                }
                if (columns.includes('start_time, guest_count')) {
                  // Pass 4 event reminder
                  return {
                    eq: vi.fn(() => ({
                      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                  }
                }
                if (columns.includes('outcome_email_sent_at')) {
                  // Pass 5a: outcome email eligibility
                  return {
                    eq: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        eq: vi.fn(() => ({
                          is: vi.fn().mockResolvedValue({ data: [], error: null }),
                        })),
                      })),
                    })),
                  }
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
                // PASS 6 — post-event inspection sweep (no eligible bookings in these tests)
                if (columns === 'id, status, event_date') {
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
            // Pass 3: .eq('status').not('balance_due_date', 'is', null)
            //   .gte('balance_due_date', today).lte('balance_due_date', today+7)
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  not: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                  })),
                })),
              })),
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
    bodies: (SmsQueueService.queueAndSend as unknown as Mock).mock.calls.map((call) => String((call[0] as { message_body?: string }).message_body ?? '')),
  }
}

describe('private hire deposit reminders count London calendar days', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends nothing 8 days out', async () => {
    expect((await runOn('2026-10-05')).triggers).toEqual([])
  })

  it('sends the 7-day reminder 7 days out, saying 7 days', async () => {
    const { triggers, bodies } = await runOn('2026-10-06')
    expect(triggers).toEqual(['deposit_reminder_7day'])
    expect(bodies[0]).toContain('expires in 7 days')
  })

  it('sends the 3-day reminder 3 days out', async () => {
    expect((await runOn('2026-10-10')).triggers).toEqual(['deposit_reminder_3day'])
  })

  it('sends the day-before reminder the day before, not on the day', async () => {
    expect((await runOn('2026-10-12')).triggers).toEqual(['deposit_reminder_1day'])
  })

  it('sends nothing on the deadline day itself', async () => {
    expect((await runOn('2026-10-13')).triggers).toEqual([])
  })
})
