import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { GET } from '@/app/api/cron/private-bookings-expire-holds/route'

function makeSupabase() {
  const expiredBookingId = 'booking-expired-1'

  const updateExpiredQuery: any = {
    eq: vi.fn(() => updateExpiredQuery),
    not: vi.fn(() => updateExpiredQuery),
    lt: vi.fn(() => updateExpiredQuery),
    select: vi.fn().mockResolvedValue({
      data: [{ id: expiredBookingId }],
      error: null,
    }),
  }

  const smsQueueUpdateQuery: any = {
    eq: vi.fn(() => smsQueueUpdateQuery),
    in: vi.fn().mockResolvedValue({ error: null }),
  }
  const smsQueueUpdate = vi.fn(() => smsQueueUpdateQuery)

  const privateBookingLookupQuery: any = {
    eq: vi.fn(() => privateBookingLookupQuery),
    maybeSingle: vi.fn()
      .mockResolvedValueOnce({ data: { calendar_event_id: null }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') {
        return {
          update: vi.fn(() => updateExpiredQuery),
          select: vi.fn(() => privateBookingLookupQuery),
        }
      }
      if (table === 'private_booking_sms_queue') {
        return {
          update: smsQueueUpdate,
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
    smsQueueUpdate,
    smsQueueUpdateQuery,
  }
}

describe('private bookings expire-holds cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes an audit event for each expired private-booking hold', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase() as any)

    const response = await GET(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.cancelled).toBe(1)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: 'booking-expired-1',
      operation_status: 'success',
      additional_info: expect.objectContaining({
        action: 'expire_booking_hold',
        actor: 'system_cron',
      }),
    }))
  })

  it('cancels the waiting texts with a payload the queue table accepts', async () => {
    const supabase = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)

    await GET(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)

    // The queue table has no updated_at column; naming one made PostgREST reject the update.
    expect(supabase.smsQueueUpdate).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(supabase.smsQueueUpdateQuery.eq).toHaveBeenCalledWith('booking_id', 'booking-expired-1')
    expect(supabase.smsQueueUpdateQuery.in).toHaveBeenCalledWith('status', ['pending', 'approved'])
  })

  it('logs the queue error instead of dropping it', async () => {
    const supabase = makeSupabase()
    supabase.smsQueueUpdateQuery.in.mockResolvedValue({
      error: { code: 'PGRST204', message: 'column missing', details: null, hint: null },
    })
    vi.mocked(createAdminClient).mockReturnValue(supabase as any)
    const { logger } = await import('@/lib/logger')

    const response = await GET(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)

    expect(response.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to cancel queued texts for a cancelled private booking',
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingId: 'booking-expired-1', code: 'PGRST204' }),
      })
    )
  })
})
