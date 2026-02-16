import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { sendSMS } from '@/lib/twilio'
import { POST } from '@/app/api/boh/table-bookings/[id]/sms/route'

describe('BOH table booking SMS route safety signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces sendSMS code/logFailure in the response', async () => {
    const bookingId = 'table-booking-1'
    const customerId = 'customer-1'

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        booking_reference: 'ABC123',
        customer: {
          id: customerId,
          first_name: 'Pat',
          mobile_number: '+447700900001',
          sms_status: 'active',
        },
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: true,
      sid: 'SM123',
      scheduledFor: '2026-03-01T12:00:00.000Z',
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
    })

    const request = new Request(`http://localhost/api/boh/table-bookings/${bookingId}/sms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    })

    const response = await POST(request as any, {
      params: Promise.resolve({ id: bookingId }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      data: {
        booking_id: bookingId,
        customer_id: customerId,
        to: '+447700900001',
        sid: 'SM123',
        scheduled_for: '2026-03-01T12:00:00.000Z',
        status: 'queued',
        code: 'logging_failed',
        logFailure: true,
      },
    })
  })

  it('logs and fails closed when sendSMS throws unexpectedly', async () => {
    const bookingId = 'table-booking-2'
    const customerId = 'customer-2'

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        booking_reference: 'ABC999',
        customer: {
          id: customerId,
          first_name: 'Pat',
          mobile_number: '+447700900002',
          sms_status: 'active',
        },
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as vi.Mock).mockRejectedValue(new Error('Twilio unavailable'))

    const request = new Request(`http://localhost/api/boh/table-bookings/${bookingId}/sms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    })

    const response = await POST(request as any, {
      params: Promise.resolve({ id: bookingId }),
    })
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload).toEqual({ error: 'Failed to send SMS' })
    expect(logger.error).toHaveBeenCalledWith(
      'BOH table booking SMS send threw unexpectedly',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: bookingId,
          customerId,
        }),
      })
    )
  })

  it('fails safe when sendSMS reports logging_failed as non-success', async () => {
    const bookingId = 'table-booking-3'
    const customerId = 'customer-3'

    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        booking_reference: 'ABC777',
        customer: {
          id: customerId,
          first_name: 'Pat',
          mobile_number: '+447700900003',
          sms_status: 'active',
        },
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as vi.Mock).mockResolvedValue({
      success: false,
      sid: 'SM999',
      scheduledFor: null,
      status: 'queued',
      code: 'logging_failed',
      logFailure: true,
      error: 'DB insert failed',
    })

    const request = new Request(`http://localhost/api/boh/table-bookings/${bookingId}/sms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    })

    const response = await POST(request as any, {
      params: Promise.resolve({ id: bookingId }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      data: {
        booking_id: bookingId,
        customer_id: customerId,
        to: '+447700900003',
        sid: 'SM999',
        scheduled_for: null,
        status: 'queued',
        code: 'logging_failed',
        logFailure: true,
      },
    })
    expect(logger.error).toHaveBeenCalledWith(
      'BOH table booking SMS sent but outbound message logging failed',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: bookingId,
          customerId,
          code: 'logging_failed',
        }),
      })
    )
  })
})
