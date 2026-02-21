import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn(),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { GET } from '@/app/api/cron/sunday-preorder/route'

describe('sunday preorder route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when cron run acquisition fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive cron run diagnostics' },
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

    const request = new Request('http://localhost/api/cron/sunday-preorder') as any
    request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')
    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to process Sunday pre-orders' })
  })

  it('fails closed when send guard schema is unavailable in production', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const previousNodeEnv = process.env.NODE_ENV
    const previousGuardOverride = process.env.SUNDAY_PREORDER_SEND_GUARD_ALLOW_SCHEMA_GAPS
    process.env.NODE_ENV = 'production'
    delete process.env.SUNDAY_PREORDER_SEND_GUARD_ALLOW_SCHEMA_GAPS

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
                      error: { code: '42P01', message: 'relation "messages" does not exist' },
                    }),
                  })),
                })),
              })),
            }
          }

          throw new Error(`Unexpected table: ${table}`)
        }),
      })

      const request = new Request('http://localhost/api/cron/sunday-preorder') as any
      request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')
      const response = await GET(request)
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
        delete process.env.SUNDAY_PREORDER_SEND_GUARD_ALLOW_SCHEMA_GAPS
      } else {
        process.env.SUNDAY_PREORDER_SEND_GUARD_ALLOW_SCHEMA_GAPS = previousGuardOverride
      }
    }
  })

  it('aborts remaining sends when sendSMS returns fatal logging_failed safety signal', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      ;(createSundayPreorderToken as unknown as vi.Mock).mockResolvedValue({ url: 'http://localhost/preorder/token' })
      ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
        success: true,
        code: 'logging_failed',
        sid: 'SM-1',
        fromNumber: '+15555555555',
        status: 'queued',
        messageId: null,
        customerId: 'cust-1',
        logFailure: true,
      })

      const startIso = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString()
      const bookings = [
        {
          id: 'booking-1',
          customer_id: 'cust-1',
          booking_reference: 'ABC',
          party_size: 2,
          status: 'confirmed',
          start_datetime: startIso,
          sunday_preorder_completed_at: null,
          customer: {
            id: 'cust-1',
            first_name: 'A',
            mobile_number: '07111111111',
            sms_status: 'opted_out',
          },
        },
        {
          id: 'booking-2',
          customer_id: 'cust-2',
          booking_reference: 'DEF',
          party_size: 2,
          status: 'confirmed',
          start_datetime: startIso,
          sunday_preorder_completed_at: null,
          customer: {
            id: 'cust-2',
            first_name: 'B',
            mobile_number: '07222222222',
            sms_status: 'active',
          },
        },
      ]

      const cronRunsSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        })),
      }))
      const cronRunsInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
        })),
      }))

      const messagesSelect = vi.fn((columns: string, options?: any) => {
        if (options?.count === 'exact') {
          return {
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
              })),
            })),
          }
        }

        if (columns.includes('table_booking_id')) {
          return {
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          }
        }

        throw new Error(`Unexpected messages select: ${columns}`)
      })

      const tableBookingsSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: bookings, error: null }),
            })),
          })),
        })),
      }))

      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'cron_job_runs') {
            return { select: cronRunsSelect, insert: cronRunsInsert }
          }
          if (table === 'messages') {
            return { select: messagesSelect }
          }
          if (table === 'table_bookings') {
            return { select: tableBookingsSelect }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const request = new Request('http://localhost/api/cron/sunday-preorder') as any
      request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')
      const response = await GET(request)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('logging_failed')
      expect(payload.abortBookingId).toBe('booking-1')
      expect(payload.abortTemplateKey).toBe('sunday_preorder_reminder_48h')
      expect(payload.safetyAborts).toBe(1)

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(sendSMS).toHaveBeenCalledWith(
        '07111111111',
        expect.any(String),
        expect.objectContaining({
          allowTransactionalOverride: true,
        })
      )
      expect(persistCronRunResult).toHaveBeenCalledWith(
        supabase,
        expect.objectContaining({ runId: 'run-1', status: 'failed', errorMessage: 'logging_failed' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when the message dedupe set cannot be loaded', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      ;(createSundayPreorderToken as unknown as vi.Mock).mockResolvedValue({ url: 'http://localhost/preorder/token' })

      const startIso = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString()
      const bookings = [
        {
          id: 'booking-1',
          customer_id: 'cust-1',
          booking_reference: 'ABC',
          party_size: 2,
          status: 'confirmed',
          start_datetime: startIso,
          sunday_preorder_completed_at: null,
          customer: {
            id: 'cust-1',
            first_name: 'A',
            mobile_number: '07111111111',
            sms_status: 'active',
          },
        },
      ]

      const cronRunsSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        })),
      }))
      const cronRunsInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
        })),
      }))

      const messagesSelect = vi.fn((columns: string, options?: any) => {
        if (options?.count === 'exact') {
          return {
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
              })),
            })),
          }
        }

        if (columns.includes('table_booking_id')) {
          return {
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'dedupe query failed' },
              }),
            })),
          }
        }

        throw new Error(`Unexpected messages select: ${columns}`)
      })

      const tableBookingsSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: bookings, error: null }),
            })),
          })),
        })),
      }))

      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'cron_job_runs') {
            return { select: cronRunsSelect, insert: cronRunsInsert }
          }
          if (table === 'messages') {
            return { select: messagesSelect }
          }
          if (table === 'table_bookings') {
            return { select: tableBookingsSelect }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const request = new Request('http://localhost/api/cron/sunday-preorder') as any
      request.nextUrl = new URL('http://localhost/api/cron/sunday-preorder')
      const response = await GET(request)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('dedupe_unavailable')
      expect(payload.safetyAborts).toBe(1)

      expect(sendSMS).not.toHaveBeenCalled()
      expect(persistCronRunResult).toHaveBeenCalledWith(
        supabase,
        expect.objectContaining({ runId: 'run-1', status: 'failed', errorMessage: 'dedupe_unavailable' })
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
