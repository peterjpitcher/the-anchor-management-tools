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

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { sendSMS } from '@/lib/twilio'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { GET } from '@/app/api/cron/private-booking-monitor/route'

describe('private booking monitor route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when cron run acquisition fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive private booking cron diagnostics' },
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'cron_job_runs') {
          return { insert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Internal server error' })
  })

  it('fails closed when duplicate-check lookup errors during reminder pass', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const from = vi.fn((table: string) => {
      if (table === 'cron_job_runs') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'run-1' },
                error: null,
              }),
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
            if (columns.includes('hold_expiry, event_date')) {
              return {
                eq: vi.fn(() => ({
                  gt: vi.fn(() => ({
                    not: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'booking-1',
                          customer_first_name: 'Test',
                          customer_name: 'Test User',
                          contact_phone: '+447700900123',
                          hold_expiry: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                          event_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                          customer_id: 'customer-1',
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              }
            }

            if (columns === 'id, hold_expiry') {
              return {
                eq: vi.fn(() => ({
                  lt: vi.fn(() => ({
                    not: vi.fn().mockResolvedValue({ data: [], error: null }),
                  })),
                })),
              }
            }

            if (columns.includes('start_time, guest_count')) {
              return {
                eq: vi.fn((column: string) => {
                  if (column === 'status') {
                    return {
                      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }
                  }
                  return { eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
                }),
              }
            }

            if (columns.includes('customer_id, customer_first_name')) {
              return {
                in: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    lt: vi.fn(() => ({
                      not: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                      })),
                    })),
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
                in: vi.fn().mockResolvedValue({
                  count: null,
                  error: { message: 'duplicate lookup failed' },
                }),
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

      throw new Error(`Unexpected table: ${table}`)
    })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({ from })

    const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.stats.remindersSent).toBe(0)
    expect((SmsQueueService.queueAndSend as unknown as vi.Mock).mock.calls.length).toBe(0)
  })

  it('aborts remaining sends when queueAndSend returns fatal logging_failed safety signal', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(SmsQueueService.queueAndSend as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sent: true,
      code: 'logging_failed',
      logFailure: true,
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      const drafts = [
        {
          id: 'booking-1',
          customer_first_name: 'Test',
          customer_name: 'Test User',
          contact_phone: '+447700900123',
          hold_expiry: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          event_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          customer_id: 'customer-1',
        },
        {
          id: 'booking-2',
          customer_first_name: 'Test2',
          customer_name: 'Test User2',
          contact_phone: '+447700900124',
          hold_expiry: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          event_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          customer_id: 'customer-2',
        },
      ]

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
                if (columns.includes('hold_expiry')) {
                  return {
                    eq: vi.fn(() => ({
                      gt: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({ data: drafts, error: null }),
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

          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('logging_failed')
      expect(payload.abortStage).toBe('pass1:deposit_reminder_7day')
      expect(payload.abortBookingId).toBe('booking-1')
      expect(payload.abortTriggerType).toBe('deposit_reminder_7day')
      expect(payload.abortTemplateKey).toBe('private_booking_deposit_reminder_7day')
      expect(payload.safetyAborts).toBe(1)
      expect((SmsQueueService.queueAndSend as unknown as vi.Mock).mock.calls.length).toBe(1)

      expect(persistCronRunResult).toHaveBeenCalledWith(
        supabase,
        expect.objectContaining({ runId: 'run-1', status: 'failed', errorMessage: 'logging_failed' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when private feedback dedupe lookup errors', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
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
              select: vi.fn((columns: string, options?: any) => {
                if (options?.count === 'exact') {
                  return {
                    eq: vi.fn(() => ({
                      in: vi.fn(() => ({
                        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                      })),
                    })),
                  }
                }

                if (columns.includes('private_booking_id')) {
                  return {
                    in: vi.fn(() => ({
                      eq: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'messages lookup failed' },
                      }),
                    })),
                  }
                }

                throw new Error(`Unexpected messages select: ${columns}`)
              }),
            }
          }

          if (table === 'private_bookings') {
            return {
              select: vi.fn((columns: string) => {
                if (columns === 'id, hold_expiry') {
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
                        not: vi.fn().mockResolvedValue({ data: [], error: null }),
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

                if (columns.includes('customer_id, customer_first_name')) {
                  return {
                    in: vi.fn(() => ({
                      gte: vi.fn(() => ({
                        lt: vi.fn(() => ({
                          not: vi.fn(() => ({
                            limit: vi.fn().mockResolvedValue({
                              data: [
                                {
                                  id: 'booking-1',
                                  customer_id: 'customer-1',
                                  customer_first_name: 'Test',
                                  customer_last_name: 'User',
                                  customer_name: 'Test User',
                                  contact_phone: '+447700900123',
                                  event_date: '2026-02-10',
                                  start_time: '18:00',
                                  status: 'completed',
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

                throw new Error(`Unexpected private_bookings select: ${columns}`)
              }),
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

          throw new Error(`Unexpected table: ${table}`)
        }),
      }

      ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

      const response = await GET(new Request('http://localhost/api/cron/private-booking-monitor') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('dedupe_unavailable')
      expect(payload.abortStage).toBe('pass5:feedback_dedupe')
      expect(payload.safetyAborts).toBe(1)

      expect(sendSMS).not.toHaveBeenCalled()
      expect((SmsQueueService.queueAndSend as unknown as vi.Mock).mock.calls.length).toBe(0)
      expect(persistCronRunResult).toHaveBeenCalledWith(
        supabase,
        expect.objectContaining({ runId: 'run-1', status: 'failed', errorMessage: 'dedupe_unavailable' })
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
