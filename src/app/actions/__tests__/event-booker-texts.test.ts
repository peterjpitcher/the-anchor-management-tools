import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))

const mockEventMaybeSingle = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mockEventMaybeSingle })) })),
    })),
  })),
}))

vi.mock('@/lib/events/booker-texts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/booker-texts')>()
  return { ...actual, loadEventBookerAudience: vi.fn() }
})

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiters: { bulk: vi.fn().mockResolvedValue(null) } }))
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }))

import { previewEventBookerText, sendEventBookerText } from '../event-booker-texts'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { sendSMS } from '@/lib/twilio'
import { loadEventBookerAudience, EVENT_BOOKER_UPDATE_TEMPLATE_KEY } from '@/lib/events/booker-texts'
import { buildSmsDedupContext } from '@/lib/sms/safety'

const EVENT_ID = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'

const AUDIENCE = {
  recipients: [
    { customerId: 'c1', bookingIds: ['b1'], firstName: 'Tracey', lastName: 'Williams', mobile: '+447700900001', seats: 4, pendingPayment: false },
    { customerId: 'c2', bookingIds: ['b2'], firstName: '', lastName: '', mobile: '+447700900002', seats: 1, pendingPayment: true },
  ],
  excluded: [{ customerId: 'c3', name: 'Katie Fowles', seats: 6, reason: 'opted_out' as const }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'staff@example.com' } } })
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(loadEventBookerAudience).mockResolvedValue(AUDIENCE)
  mockEventMaybeSingle.mockResolvedValue({ data: { id: EVENT_ID, name: 'Tasting Night' }, error: null })
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)
})

describe('previewEventBookerText', () => {
  it('lists who will and will not be texted, with the reason', async () => {
    const result = await previewEventBookerText({ eventId: EVENT_ID, includePendingPayment: true })
    expect(result.data?.recipients.map((r) => r.name)).toEqual(['Tracey Williams', 'Unnamed guest'])
    expect(result.data?.excluded).toEqual([
      { customerId: 'c3', name: 'Katie Fowles', seats: 6, reason: 'Has opted out of texts' },
    ])
    expect(loadEventBookerAudience).toHaveBeenCalledWith(expect.anything(), EVENT_ID, { includePendingPayment: true })
  })

  it('refuses without both permissions', async () => {
    vi.mocked(checkUserPermission).mockImplementation(async (module) => module === 'events')
    expect(await previewEventBookerText({ eventId: EVENT_ID, includePendingPayment: false })).toEqual({
      error: 'Insufficient permissions',
    })
  })

  it('shows an error when the bookings cannot be loaded', async () => {
    vi.mocked(loadEventBookerAudience).mockRejectedValue(new Error('db down'))
    const result = await previewEventBookerText({ eventId: EVENT_ID, includePendingPayment: false })
    expect(result.error).toMatch(/Could not load the bookers/)
  })
})

describe('sendEventBookerText', () => {
  it('rejects a signed-out user before sending anything', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    expect(await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })).toEqual({
      error: 'Unauthorized',
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('rejects an empty message', async () => {
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: '   ' })
    expect(result.error).toBe('Write a message first')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('texts the bookers the server found, as a service text tied to the event', async () => {
    const result = await sendEventBookerText({
      eventId: EVENT_ID,
      includePendingPayment: false,
      message: 'Hi {{first_name}}, doors open at 6.30pm',
    })

    expect(result).toMatchObject({ success: true, sent: 2, held: 0, failed: 0 })
    expect(sendSMS).toHaveBeenCalledTimes(2)
    expect(sendSMS).toHaveBeenNthCalledWith(1, '+447700900001', 'Hi Tracey, doors open at 6.30pm', expect.objectContaining({
      customerId: 'c1',
      createCustomerIfMissing: false,
      metadata: expect.objectContaining({
        template_key: EVENT_BOOKER_UPDATE_TEMPLATE_KEY,
        event_id: EVENT_ID,
        event_booking_id: 'b1',
      }),
    }))
    expect(sendSMS).toHaveBeenNthCalledWith(2, '+447700900002', 'Hi there, doors open at 6.30pm', expect.anything())
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'send',
      resource_type: 'event_booker_text',
      resource_id: EVENT_ID,
      operation_status: 'success',
    }))
  })

  it('counts texts held by quiet hours separately', async () => {
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: null, deferred: true } as never)
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(result).toMatchObject({ success: true, sent: 0, held: 2 })
  })

  it('gives each different message its own duplicate key, and the same message the same key', async () => {
    // Codex review on PR 388: the duplicate guard keys on customer, template and event, so a
    // second, different update to the same bookers used to clash and stop the send.
    const keyFor = (call: number) => {
      const [to, body, options] = vi.mocked(sendSMS).mock.calls[call] as [string, string, { customerId: string; metadata: Record<string, unknown> }]
      return buildSmsDedupContext({ to, customerId: options.customerId, body, metadata: options.metadata })?.key
    }

    await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Doors open at 6.30pm' })
    await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'We now start at 7.30pm' })
    await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Doors open at 6.30pm' })

    // Calls 0, 2 and 4 are Tracey for each of the three sends.
    expect(keyFor(0)).toBeDefined()
    expect(keyFor(2)).not.toBe(keyFor(0))
    expect(keyFor(4)).toBe(keyFor(0))
  })

  it('reports bookers who already had this exact message instead of claiming a new send', async () => {
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: null, suppressed: true, suppressionReason: 'duplicate' } as never)
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(result).toMatchObject({ success: true, sent: 0, held: 0, alreadySent: 2, failed: 0 })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'success' }))
  })

  it('reports per-person failures and carries on', async () => {
    vi.mocked(sendSMS)
      .mockResolvedValueOnce({ success: false, error: 'This number is not eligible to receive SMS messages' } as never)
      .mockResolvedValueOnce({ success: true, sid: 'SM2' } as never)
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(result).toMatchObject({ success: true, sent: 1, failed: 1 })
    expect(result.failures).toEqual([{ name: 'Tracey Williams', error: 'This number is not eligible to receive SMS messages' }])
  })

  it('stops at once and tells staff when SMS is switched off', async () => {
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'SMS sending is currently suspended', code: 'sms_suspended' } as never)
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
    expect(result.stoppedEarly).toBe(true)
    expect(result.error).toMatch(/SMS sending is currently suspended/)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_status: 'failure' }))
  })

  it('fails closed when the SMS pipeline throws', async () => {
    vi.mocked(sendSMS).mockRejectedValue(new Error('Twilio unreachable'))
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Twilio unreachable/)
  })

  it('stops after a send that could not be logged, without retrying', async () => {
    vi.mocked(sendSMS).mockResolvedValue({ success: false, error: 'SMS sent but logging failed', code: 'logging_failed', logFailure: true } as never)
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.stoppedEarly).toBe(true)
  })

  it('sends nothing when the bookings cannot be loaded', async () => {
    vi.mocked(loadEventBookerAudience).mockRejectedValue(new Error('db down'))
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(result.error).toMatch(/Nothing was sent/)
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('says so when nobody can be texted', async () => {
    vi.mocked(loadEventBookerAudience).mockResolvedValue({ recipients: [], excluded: AUDIENCE.excluded })
    const result = await sendEventBookerText({ eventId: EVENT_ID, includePendingPayment: false, message: 'Hi' })
    expect(result.error).toBe('Nobody booked into this event can be texted.')
    expect(sendSMS).not.toHaveBeenCalled()
  })
})
