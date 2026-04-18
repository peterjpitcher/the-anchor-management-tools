import { beforeEach, describe, expect, it, vi } from 'vitest'

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
 * Verifies that the private-booking-monitor cron route uses the business
 * idempotency table (`private_booking_send_idempotency`) to prevent duplicate
 * sends across overlapping runs.
 */
describe('private booking monitor idempotency guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reserves an idempotency key before firing a Pass 1 deposit reminder', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(SmsQueueService.queueAndSend as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sent: true,
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      // Single draft booking, 3 days to hold expiry (7-day window hits).
      const draftBooking = {
        id: 'booking-1',
        customer_first_name: 'Sarah',
        customer_name: 'Sarah Jones',
        contact_phone: '+447700900123',
        hold_expiry: new Date('2026-02-18T12:00:00.000Z').toISOString(),
        event_date: new Date('2026-02-28T12:00:00.000Z').toISOString(),
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
                if (columns.includes('contact_phone, event_date, customer_id')) {
                  // Pass 5 post-event (untouched in Wave 2)
                  return {
                    in: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        is: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
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
                    in: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            }
          }

          if (table === 'private_bookings_with_details') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gt: vi.fn(() => ({
                    lte: vi.fn().mockResolvedValue({ data: [], error: null }),
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

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)

      // Idempotency insert MUST happen before the send.
      expect(idempotencyInsert).toHaveBeenCalledTimes(1)
      expect(idempotencyInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: 'booking-1:deposit_reminder_7day:2026-02-18',
          booking_id: 'booking-1',
          trigger_type: 'deposit_reminder_7day',
          window_key: '2026-02-18',
        })
      )
      expect(SmsQueueService.queueAndSend).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the Pass 1 send cleanly when idempotency insert returns 23505 (duplicate)', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(SmsQueueService.queueAndSend as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sent: true,
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      const draftBooking = {
        id: 'booking-1',
        customer_first_name: 'Sarah',
        customer_name: 'Sarah Jones',
        contact_phone: '+447700900123',
        hold_expiry: new Date('2026-02-18T12:00:00.000Z').toISOString(),
        event_date: new Date('2026-02-28T12:00:00.000Z').toISOString(),
        customer_id: 'customer-1',
        deposit_amount: 250,
        internal_notes: null,
      }

      // Simulate the unique-constraint violation — a previous run already
      // reserved this (booking, trigger, window) tuple.
      const idempotencyInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })

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
                  return {
                    eq: vi.fn(() => ({
                      lt: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
                  }
                }
                if (columns.includes('hold_expiry')) {
                  return {
                    eq: vi.fn(() => ({
                      gt: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({ data: [draftBooking], error: null }),
                      })),
                    })),
                  }
                }
                if (columns.includes('start_time, guest_count')) {
                  return {
                    eq: vi.fn(() => ({
                      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                  }
                }
                if (columns.includes('contact_phone, event_date, customer_id')) {
                  return {
                    in: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        is: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
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
                    in: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            }
          }
          if (table === 'private_bookings_with_details') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gt: vi.fn(() => ({
                    lte: vi.fn().mockResolvedValue({ data: [], error: null }),
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

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)

      // Insert attempted, but send suppressed.
      expect(idempotencyInsert).toHaveBeenCalledTimes(1)
      expect(SmsQueueService.queueAndSend).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
