import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { sendSMS } from '@/lib/twilio'
import { GET } from '@/app/api/cron/event-guest-engagement/route'

describe('event guest engagement route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when cron run acquisition fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive engagement cron diagnostics' },
    })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const eqStatus = vi.fn().mockReturnValue({ order })
    const eqJob = vi.fn().mockReturnValue({ eq: eqStatus })
    const select = vi.fn().mockReturnValue({ eq: eqJob })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'cron_job_runs') {
          return { select }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-guest-engagement') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to process event guest engagement' })
  })

  it('fails closed when send guard schema is unavailable in production', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const previousNodeEnv = process.env.NODE_ENV
    const previousGuardOverride = process.env.EVENT_ENGAGEMENT_SEND_GUARD_ALLOW_SCHEMA_GAPS
    process.env.NODE_ENV = 'production'
    delete process.env.EVENT_ENGAGEMENT_SEND_GUARD_ALLOW_SCHEMA_GAPS

    try {
      ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
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
            }
          }

          if (table === 'messages') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    gte: vi.fn().mockResolvedValue({
                      count: null,
                      error: { code: '42703', message: 'column "template_key" does not exist' },
                    }),
                  })),
                })),
              })),
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      })

      const response = await GET(new Request('http://localhost/api/cron/event-guest-engagement') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.skipped).toBe(true)
      expect(payload.reason).toBe('send_guard_blocked')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }

      if (previousGuardOverride === undefined) {
        delete process.env.EVENT_ENGAGEMENT_SEND_GUARD_ALLOW_SCHEMA_GAPS
      } else {
        process.env.EVENT_ENGAGEMENT_SEND_GUARD_ALLOW_SCHEMA_GAPS = previousGuardOverride
      }
    }
  })

  it('aborts remaining sends when sendSMS returns fatal logging_failed safety signal', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
        success: true,
        sid: 'SM1',
        code: 'logging_failed',
        logFailure: true,
      })

      const eventStartIso = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

      const supabase = {
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
            }
          }

          if (table === 'messages') {
            return {
              select: vi.fn((columns: string) => {
                if (columns === 'id') {
                  return {
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                      })),
                    })),
                  }
                }

                return {
                  in: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue({ data: [], error: null }),
                  })),
                }
              }),
            }
          }

          if (table === 'bookings') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'booking-1',
                            customer_id: 'customer-1',
                            event_id: 'event-1',
                            seats: 2,
                            is_reminder_only: false,
                            status: 'confirmed',
                            review_sms_sent_at: null,
                            review_window_closes_at: null,
                            event: {
                              id: 'event-1',
                              name: 'Test Event',
                              start_datetime: eventStartIso,
                              date: null,
                              time: null,
                              event_status: null,
                            },
                            customer: {
                              id: 'customer-1',
                              first_name: 'Alex',
                              mobile_number: '+447700900111',
                              sms_status: 'active',
                            },
                          },
                        ],
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            }
          }

          if (table === 'table_bookings') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  not: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      lte: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
                  })),
                })),
              })),
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const request: any = new Request('http://localhost/api/cron/event-guest-engagement')
      request.nextUrl = new URL('http://localhost')

      const response = await GET(request)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('logging_failed')
      expect(payload.abortStage).toBe('reminders:send_sms')
      expect(payload.abortBookingId).toBe('booking-1')
      expect(payload.abortTemplateKey).toBe('event_reminder_1d')
      expect(payload.safetyAborts).toHaveLength(1)

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(persistCronRunResult).toHaveBeenCalledWith(supabase, {
        runId: 'run-1',
        status: 'failed',
        errorMessage: 'logging_failed',
        context: 'event-guest-engagement',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when reminder dedupe lookup errors', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      const eventStartIso = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

      const supabase = {
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
            }
          }

          if (table === 'messages') {
            return {
              select: vi.fn((columns: string) => {
                if (columns === 'id') {
                  return {
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                      })),
                    })),
                  }
                }

                return {
                  in: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: 'messages lookup failed' },
                    }),
                  })),
                }
              }),
            }
          }

          if (table === 'bookings') {
            return {
              select: vi.fn(() => ({
                in: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lte: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'booking-1',
                            customer_id: 'customer-1',
                            event_id: 'event-1',
                            seats: 2,
                            is_reminder_only: false,
                            status: 'confirmed',
                            review_sms_sent_at: null,
                            review_window_closes_at: null,
                            event: {
                              id: 'event-1',
                              name: 'Test Event',
                              start_datetime: eventStartIso,
                              date: null,
                              time: null,
                              event_status: null,
                            },
                            customer: {
                              id: 'customer-1',
                              first_name: 'Alex',
                              mobile_number: '+447700900111',
                              sms_status: 'active',
                            },
                          },
                        ],
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            }
          }

          if (table === 'table_bookings') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  not: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      lte: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
                  })),
                })),
              })),
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const request: any = new Request('http://localhost/api/cron/event-guest-engagement')
      request.nextUrl = new URL('http://localhost')

      const response = await GET(request)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('dedupe_unavailable')
      expect(payload.abortStage).toBe('reminders:dedupe')
      expect(sendSMS).not.toHaveBeenCalled()

      expect(persistCronRunResult).toHaveBeenCalledWith(supabase, {
        runId: 'run-1',
        status: 'failed',
        errorMessage: 'dedupe_unavailable',
        context: 'event-guest-engagement',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
