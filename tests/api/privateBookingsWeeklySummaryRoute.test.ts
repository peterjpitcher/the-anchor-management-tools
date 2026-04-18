import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingsWeeklyDigestEmail: vi.fn(),
}))

vi.mock('@/services/audit', () => ({
  AuditService: {
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
  },
}))

const { error, warn } = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error,
    warn,
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { sendManagerPrivateBookingsWeeklyDigestEmail } from '@/lib/private-bookings/manager-notifications'
import { GET } from '@/app/api/cron/private-bookings-weekly-summary/route'

function createSupabaseMock() {
  const upcomingRows = [
    {
      id: 'booking-1',
      customer_name: 'Alex Morgan',
      customer_first_name: 'Alex',
      customer_last_name: 'Morgan',
      event_date: '2026-03-27',
      start_time: '19:00:00',
      status: 'confirmed',
      guest_count: 24,
      event_type: 'Birthday',
      balance_due_date: '2026-03-24',
      final_payment_date: null,
      internal_notes: null,
      updated_at: '2026-03-20T10:00:00.000Z',
      contact_email: 'alex@example.com',
      contact_phone: '+447700900001',
      balance_remaining: 550,
      hold_expiry: null,
    },
    {
      id: 'booking-2',
      customer_name: 'Jamie Lee',
      customer_first_name: 'Jamie',
      customer_last_name: 'Lee',
      event_date: '2026-03-28',
      start_time: '18:30:00',
      status: 'draft',
      guest_count: 40,
      event_type: 'Corporate',
      balance_due_date: null,
      final_payment_date: null,
      internal_notes: 'Event date/time to be confirmed',
      updated_at: '2026-03-19T14:00:00.000Z',
      contact_email: 'jamie@example.com',
      contact_phone: '+447700900002',
      balance_remaining: 0,
      hold_expiry: '2026-03-25T10:00:00.000Z',
    },
  ]

  const pendingSmsRows = [
    {
      id: 'sms-1',
      booking_id: 'booking-2',
      trigger_type: 'manual',
      created_at: '2026-03-22T08:30:00.000Z',
    },
  ]

  return {
    from: vi.fn((table: string) => {
      if (table === 'private_bookings_with_details') {
        return {
          select: vi.fn(() => ({
            gte: vi.fn(() => ({
              neq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue({
                      data: upcomingRows,
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          })),
        }
      }

      if (table === 'private_booking_sms_queue') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: pendingSmsRows,
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('private-bookings weekly summary cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendManagerPrivateBookingsWeeklyDigestEmail as unknown as vi.Mock).mockResolvedValue({
      sent: true,
      actionCount: 3,
      eventCount: 2,
    })
  })

  it('rejects unauthorized cron calls', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: false, reason: 'missing' })

    const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)
    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('skips outside the 9am London window unless forced', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T07:00:00.000Z')) // Monday but 7am, not 9am
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    try {
      const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload).toMatchObject({
        success: true,
        skipped: true,
        reason: 'outside_london_digest_window',
      })
      expect(createAdminClient).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips on non-Monday unless forced', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T09:00:00.000Z')) // Wednesday
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    try {
      const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)
      const payload = await response.json()
      expect(payload).toMatchObject({ skipped: true, reason: 'not_monday' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends digest on non-Monday when force=true', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T09:00:00.000Z')) // Wednesday
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(createSupabaseMock())

    try {
      const response = await GET(
        new Request('http://localhost/api/cron/private-bookings-weekly-summary?force=true') as any
      )
      const payload = await response.json()
      expect(payload).toMatchObject({ success: true, sent: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the digest and persists idempotency response during the 9am Monday window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T09:00:00.000Z')) // Monday 9am GMT
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(createSupabaseMock())

    try {
      const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload).toMatchObject({
        success: true,
        sent: true,
        londonDate: '2026-03-23',
        events: 2,
        actions: 3,
      })
      expect(sendManagerPrivateBookingsWeeklyDigestEmail).toHaveBeenCalledTimes(1)
      expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
      expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases idempotency claim when email send fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-23T09:00:00.000Z')) // Monday 9am GMT
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    const supabase = createSupabaseMock()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)
    ;(sendManagerPrivateBookingsWeeklyDigestEmail as unknown as vi.Mock).mockResolvedValueOnce({
      sent: false,
      error: 'smtp down',
      actionCount: 3,
      eventCount: 2,
    })

    try {
      const response = await GET(new Request('http://localhost/api/cron/private-bookings-weekly-summary') as any)

      expect(response.status).toBe(500)
      expect(releaseIdempotencyClaim).toHaveBeenCalledWith(
        supabase,
        'cron:private-bookings-weekly-summary:2026-03-23',
        'hash-1'
      )
      expect(persistIdempotencyResponse).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
