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

vi.mock('@/lib/parking/repository', () => ({
  logParkingNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/parking/booking-updates', () => ({
  updateParkingBookingById: vi.fn().mockResolvedValue('updated'),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { persistCronRunResult } from '@/lib/cron-run-results'
import { sendSMS } from '@/lib/twilio'
import { logParkingNotification } from '@/lib/parking/repository'
import { GET } from '@/app/api/cron/parking-notifications/route'

describe('parking notifications route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when cron run acquisition fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'cron_job_runs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'sensitive parking cron diagnostics' },
                      }),
                    })),
                  })),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/parking-notifications') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Internal error' })
  })

  it('fails closed when send guard schema is unavailable in production', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const previousNodeEnv = process.env.NODE_ENV
    const previousGuardOverride = process.env.PARKING_SEND_GUARD_ALLOW_SCHEMA_GAPS
    process.env.NODE_ENV = 'production'
    delete process.env.PARKING_SEND_GUARD_ALLOW_SCHEMA_GAPS

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

      const response = await GET(new Request('http://localhost/api/cron/parking-notifications') as any)
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
        delete process.env.PARKING_SEND_GUARD_ALLOW_SCHEMA_GAPS
      } else {
        process.env.PARKING_SEND_GUARD_ALLOW_SCHEMA_GAPS = previousGuardOverride
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

      const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const startAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const endAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

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
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            }
          }

          if (table === 'parking_bookings') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((column: string, value: string) => {
                  if (column !== 'status') {
                    throw new Error(`Unexpected parking_bookings filter: ${column}`)
                  }

                  if (value === 'pending_payment') {
                    return {
                      eq: vi.fn(() => ({
                        not: vi.fn().mockResolvedValue({
                          data: [
                            {
                              id: 'booking-1',
                              customer_id: 'customer-1',
                              customer_first_name: 'Alex',
                              customer_mobile: '+447700900111',
                              customer_email: 'alex@example.com',
                              start_at: startAt,
                              end_at: endAt,
                              payment_due_at: dueAt,
                              unpaid_week_before_sms_sent: false,
                              unpaid_day_before_sms_sent: false,
                              calculated_price: 10,
                            },
                            {
                              id: 'booking-2',
                              customer_id: 'customer-2',
                              customer_first_name: 'Sam',
                              customer_mobile: '+447700900222',
                              customer_email: 'sam@example.com',
                              start_at: startAt,
                              end_at: endAt,
                              payment_due_at: dueAt,
                              unpaid_week_before_sms_sent: false,
                              unpaid_day_before_sms_sent: false,
                              calculated_price: 10,
                            },
                          ],
                          error: null,
                        }),
                      })),
                    }
                  }

                  if (value === 'confirmed') {
                    return {
                      eq: vi.fn(() => ({
                        data: [
                          {
                            id: 'booking-paid-1',
                            customer_id: 'customer-3',
                            customer_first_name: 'Jamie',
                            customer_mobile: '+447700900333',
                            customer_email: 'jamie@example.com',
                            start_at: startAt,
                            end_at: endAt,
                            vehicle_registration: 'TEST123',
                            paid_start_three_day_sms_sent: false,
                            paid_end_three_day_sms_sent: true,
                          },
                        ],
                        error: null,
                      })),
                    }
                  }

                  throw new Error(`Unexpected parking booking status: ${value}`)
                }),
              })),
            }
          }

          if (table === 'parking_booking_payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { metadata: { approve_url: 'https://payments.example.com' } },
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            }
          }

          if (table === 'parking_booking_notifications') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          contains: vi.fn().mockResolvedValue({ data: [], error: null }),
                        })),
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

      const response = await GET(new Request('http://localhost/api/cron/parking-notifications') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('logging_failed')
      expect(payload.abortBookingId).toBe('booking-1')
      expect(payload.abortTemplateKey).toBe('parking_payment_reminder_week_before_expiry')
      expect(payload.safetyAborts).toHaveLength(1)

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(logParkingNotification).toHaveBeenCalled()
      expect(persistCronRunResult).toHaveBeenCalledWith(supabase, {
        runId: 'run-1',
        status: 'failed',
        errorMessage: 'logging_failed',
        context: 'parking-notifications',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts remaining sends when parking notification logging fails after a successful transport send', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    try {
      ;(sendSMS as unknown as vi.Mock).mockResolvedValueOnce({
        success: true,
        sid: 'SM1',
      })
      ;(logParkingNotification as unknown as vi.Mock).mockRejectedValueOnce(new Error('parking log down'))

      const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const startAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
      const endAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

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
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                  })),
                })),
              })),
            }
          }

          if (table === 'parking_bookings') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    not: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'booking-1',
                          customer_id: 'customer-1',
                          customer_first_name: 'Alex',
                          customer_mobile: '+447700900111',
                          customer_email: 'alex@example.com',
                          start_at: startAt,
                          end_at: endAt,
                          payment_due_at: dueAt,
                          unpaid_week_before_sms_sent: false,
                          unpaid_day_before_sms_sent: false,
                          calculated_price: 10,
                        },
                        {
                          id: 'booking-2',
                          customer_id: 'customer-2',
                          customer_first_name: 'Sam',
                          customer_mobile: '+447700900222',
                          customer_email: 'sam@example.com',
                          start_at: startAt,
                          end_at: endAt,
                          payment_due_at: dueAt,
                          unpaid_week_before_sms_sent: false,
                          unpaid_day_before_sms_sent: false,
                          calculated_price: 10,
                        },
                      ],
                      error: null,
                    }),
                  })),
                })),
              })),
            }
          }

          if (table === 'parking_booking_payments') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { metadata: { approve_url: 'https://payments.example.com' } },
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            }
          }

          if (table === 'parking_booking_notifications') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      eq: vi.fn(() => ({
                        limit: vi.fn(() => ({
                          contains: vi.fn().mockResolvedValue({ data: [], error: null }),
                        })),
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

      const response = await GET(new Request('http://localhost/api/cron/parking-notifications') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.success).toBe(true)
      expect(payload.aborted).toBe(true)
      expect(payload.abortReason).toBe('logging_failed')
      expect(payload.abortStage).toBe('parking_notification_log')
      expect(payload.abortBookingId).toBe('booking-1')
      expect(payload.abortTemplateKey).toBe('parking_payment_reminder_week_before_expiry')

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(persistCronRunResult).toHaveBeenCalledWith(supabase, {
        runId: 'run-1',
        status: 'failed',
        errorMessage: 'logging_failed',
        context: 'parking-notifications',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
