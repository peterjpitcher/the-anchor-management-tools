import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mockTableBookingPermission = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: mockTableBookingPermission,
  requireBohTableBookingPermission: mockTableBookingPermission,
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

const mockAudit = vi.hoisted(() => vi.fn())
vi.mock('@/services/audit', () => ({ AuditService: { logAuditEvent: mockAudit } }))

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
    const bookingId = '00000000-0000-4000-8000-000000000001'
    const customerId = '00000000-0000-4000-8000-000000000011'

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

    const messagesSelectGte = vi.fn().mockResolvedValue({ count: 0, error: null })
    const messagesSelectEqDir = vi.fn().mockReturnValue({ gte: messagesSelectGte })
    const messagesSelectEqId = vi.fn().mockReturnValue({ eq: messagesSelectEqDir })
    const messagesSelect = vi.fn().mockReturnValue({ eq: messagesSelectEqId })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as Mock).mockResolvedValue({
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
    const bookingId = '00000000-0000-4000-8000-000000000002'
    const customerId = '00000000-0000-4000-8000-000000000012'

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

    const messagesSelectGte = vi.fn().mockResolvedValue({ count: 0, error: null })
    const messagesSelectEqDir = vi.fn().mockReturnValue({ gte: messagesSelectGte })
    const messagesSelectEqId = vi.fn().mockReturnValue({ eq: messagesSelectEqDir })
    const messagesSelect = vi.fn().mockReturnValue({ eq: messagesSelectEqId })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as Mock).mockRejectedValue(new Error('Twilio unavailable'))

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
    const bookingId = '00000000-0000-4000-8000-000000000003'
    const customerId = '00000000-0000-4000-8000-000000000013'

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

    const messagesSelectGte = vi.fn().mockResolvedValue({ count: 0, error: null })
    const messagesSelectEqDir = vi.fn().mockReturnValue({ gte: messagesSelectGte })
    const messagesSelectEqId = vi.fn().mockReturnValue({ eq: messagesSelectEqDir })
    const messagesSelect = vi.fn().mockReturnValue({ eq: messagesSelectEqId })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    ;(requireFohPermission as unknown as Mock).mockResolvedValue({
      ok: true,
      supabase,
    })

    ;(sendSMS as unknown as Mock).mockResolvedValue({
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

  // BK-182: a text typed on the booking page records who sent it.
  it('records the sender on the message and in the audit log', async () => {
    const bookingId = '00000000-0000-4000-8000-000000000003'
    const customerId = '00000000-0000-4000-8000-000000000013'
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: bookingId,
        booking_reference: 'ABC777',
        customer: { id: customerId, first_name: 'Pat', mobile_number: '+447700900001', sms_status: 'active' },
      },
      error: null,
    })
    const messagesSelectGte = vi.fn().mockResolvedValue({ count: 0, error: null })
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return { select: () => ({ eq: () => ({ maybeSingle: bookingMaybeSingle }) }) }
        }
        return { select: () => ({ eq: () => ({ eq: () => ({ gte: messagesSelectGte }) }) }) }
      }),
    }
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'user-1', supabase })
    ;(sendSMS as unknown as Mock).mockResolvedValue({ success: true, sid: 'SM777', status: 'queued' })

    const response = await POST(
      new Request(`http://localhost/api/boh/table-bookings/${bookingId}/sms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Your table is ready' }),
      }) as any,
      { params: Promise.resolve({ id: bookingId }) }
    )

    expect(response.status).toBe(200)
    expect((sendSMS as unknown as Mock).mock.calls[0][2].metadata).toMatchObject({ sent_by_user_id: 'user-1' })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'table_booking.manual_sms_sent',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: expect.objectContaining({ customer_id: customerId, message_sid: 'SM777' }),
    }))
  })
})
