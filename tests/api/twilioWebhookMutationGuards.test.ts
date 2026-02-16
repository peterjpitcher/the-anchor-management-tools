import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: {
    validateRequest: vi.fn(() => true),
  },
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { POST } from '@/app/api/webhooks/twilio/route'

describe('twilio webhook mutation guards', () => {
  const originalAuthToken = process.env.TWILIO_AUTH_TOKEN

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_AUTH_TOKEN = 'twilio_auth_token_test'
  })

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN
    } else {
      process.env.TWILIO_AUTH_TOKEN = originalAuthToken
    }
  })

  it('treats status update no-op as success to prevent webhook retry loops', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'message-1',
        status: 'queued',
        twilio_status: 'queued',
        direction: 'outbound',
        customer_id: null,
        sent_at: null,
      },
      error: null,
    })
    const messageLookupLimit = vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle })
    const messageLookupOrder = vi.fn().mockReturnValue({ limit: messageLookupLimit })
    const messageLookupEq = vi.fn().mockReturnValue({ order: messageLookupOrder })
    const messageLookupSelect = vi.fn().mockReturnValue({ eq: messageLookupEq })

    const messageUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const messageUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: messageUpdateMaybeSingle })
    const messageUpdateEqId = vi.fn().mockReturnValue({ select: messageUpdateSelect })
    const messageUpdateEqSid = vi.fn().mockReturnValue({ eq: messageUpdateEqId })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEqSid })

    const messageDeliveryStatusInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: messageLookupSelect,
            update: messageUpdate,
          }
        }
        if (table === 'message_delivery_status') {
          return { insert: messageDeliveryStatusInsert }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM123',
      MessageStatus: 'delivered',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      note: 'Status update already applied or message missing',
    })
    expect(messageDeliveryStatusInsert).not.toHaveBeenCalled()
  })

  it('fails closed when duplicate status webhook cannot apply delivery-outcome customer updates', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'message-dup-1',
        status: 'delivered',
        twilio_status: 'delivered',
        direction: 'outbound',
        customer_id: 'customer-dup-1',
        sent_at: '2026-02-16T00:00:00.000Z',
      },
      error: null,
    })
    const messageLookupLimit = vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle })
    const messageLookupOrder = vi.fn().mockReturnValue({ limit: messageLookupLimit })
    const messageLookupEq = vi.fn().mockReturnValue({ order: messageLookupOrder })
    const messageLookupSelect = vi.fn().mockReturnValue({ eq: messageLookupEq })

    const customerLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'customers lookup unavailable' },
    })
    const customerLookupEq = vi.fn().mockReturnValue({ maybeSingle: customerLookupMaybeSingle })
    const customerLookupSelect = vi.fn().mockReturnValue({ eq: customerLookupEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: messageLookupSelect }
        }
        if (table === 'customers') {
          return { select: customerLookupSelect }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_DUPLICATE_DELIVERED_1',
      MessageStatus: 'delivered',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(customerLookupSelect).toHaveBeenCalledWith('id, sms_status, sms_opt_in, sms_delivery_failures')
  })

  it('fails closed when post-status customer delivery-outcome updates cannot be applied', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'message-status-1',
        status: 'queued',
        twilio_status: 'queued',
        direction: 'outbound',
        customer_id: 'customer-status-1',
        sent_at: null,
      },
      error: null,
    })
    const messageLookupLimit = vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle })
    const messageLookupOrder = vi.fn().mockReturnValue({ limit: messageLookupLimit })
    const messageLookupEq = vi.fn().mockReturnValue({ order: messageLookupOrder })
    const messageLookupSelect = vi.fn().mockReturnValue({ eq: messageLookupEq })

    const messageUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'message-status-1' },
      error: null,
    })
    const messageUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: messageUpdateMaybeSingle })
    const messageUpdateEqId = vi.fn().mockReturnValue({ select: messageUpdateSelect })
    const messageUpdateEqSid = vi.fn().mockReturnValue({ eq: messageUpdateEqId })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEqSid })

    const customerLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'customers lookup unavailable after update' },
    })
    const customerLookupEq = vi.fn().mockReturnValue({ maybeSingle: customerLookupMaybeSingle })
    const customerLookupSelect = vi.fn().mockReturnValue({ eq: customerLookupEq })

    const messageDeliveryStatusInsert = vi.fn().mockResolvedValue({ error: null })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: messageLookupSelect,
            update: messageUpdate,
          }
        }
        if (table === 'customers') {
          return { select: customerLookupSelect }
        }
        if (table === 'message_delivery_status') {
          return { insert: messageDeliveryStatusInsert }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_STATUS_DELIVERED_1',
      MessageStatus: 'delivered',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(messageUpdate).toHaveBeenCalledTimes(1)
    expect(customerLookupSelect).toHaveBeenCalledWith('id, sms_status, sms_opt_in, sms_delivery_failures')
    expect(messageDeliveryStatusInsert).toHaveBeenCalledTimes(1)
  })

  it('recovers inbound customer create duplicate-key races by loading the concurrent customer row', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const existingMessageMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const existingMessageLimit = vi.fn().mockReturnValue({ maybeSingle: existingMessageMaybeSingle })
    const existingMessageOrder = vi.fn().mockReturnValue({ limit: existingMessageLimit })
    const existingMessageEq = vi.fn().mockReturnValue({ order: existingMessageOrder })
    const existingMessageSelect = vi.fn().mockReturnValue({ eq: existingMessageEq })

    const inboundInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'message-inbound-1' },
      error: null,
    })
    const inboundInsertSelect = vi.fn().mockReturnValue({ single: inboundInsertSingle })
    const inboundInsert = vi.fn().mockReturnValue({ select: inboundInsertSelect })

    const customerLimit = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'customer-1',
            first_name: 'Unknown',
            last_name: '(+447700900123)',
            mobile_number: '+447700900123',
            mobile_e164: '+447700900123',
            sms_opt_in: true,
            sms_status: 'active',
          },
        ],
        error: null,
      })
    const customerOr = vi.fn().mockReturnValue({ limit: customerLimit })
    const customerSelect = vi.fn().mockReturnValue({ or: customerOr })

    const createCustomerSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    })
    const createCustomerSelect = vi.fn().mockReturnValue({ single: createCustomerSingle })
    const createCustomerInsert = vi.fn().mockReturnValue({ select: createCustomerSelect })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: existingMessageSelect,
            insert: inboundInsert,
          }
        }
        if (table === 'customers') {
          return {
            select: customerSelect,
            insert: createCustomerInsert,
          }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_INBOUND_1',
      From: '+447700900123',
      To: '+447700900124',
      Body: 'Hello from customer',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, messageId: 'message-inbound-1' })
    expect(createCustomerInsert).toHaveBeenCalledTimes(1)
    expect(customerLimit).toHaveBeenCalledTimes(2)
    expect(inboundInsert).toHaveBeenCalledTimes(1)
  })

  it('returns retriable 500 when status webhook cannot load the target message due to DB errors', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const messageLookupMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'temporary read failure' },
    })
    const messageLookupLimit = vi.fn().mockReturnValue({ maybeSingle: messageLookupMaybeSingle })
    const messageLookupOrder = vi.fn().mockReturnValue({ limit: messageLookupLimit })
    const messageLookupEq = vi.fn().mockReturnValue({ order: messageLookupOrder })
    const messageLookupSelect = vi.fn().mockReturnValue({ eq: messageLookupEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: messageLookupSelect }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_STATUS_ERR_1',
      MessageStatus: 'delivered',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
  })

  it('fails closed when inbound duplicate lookup query errors before message insert', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const existingMessageMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'messages lookup unavailable' },
    })
    const existingMessageLimit = vi.fn().mockReturnValue({ maybeSingle: existingMessageMaybeSingle })
    const existingMessageOrder = vi.fn().mockReturnValue({ limit: existingMessageLimit })
    const existingMessageEq = vi.fn().mockReturnValue({ order: existingMessageOrder })
    const existingMessageSelect = vi.fn().mockReturnValue({ eq: existingMessageEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: existingMessageSelect }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_INBOUND_ERR_1',
      From: '+447700900123',
      To: '+447700900124',
      Body: 'hello',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
  })

  it('fails closed when inbound opt-out keyword cannot persist the customer preference update', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const existingMessageMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const existingMessageLimit = vi.fn().mockReturnValue({ maybeSingle: existingMessageMaybeSingle })
    const existingMessageOrder = vi.fn().mockReturnValue({ limit: existingMessageLimit })
    const existingMessageEq = vi.fn().mockReturnValue({ order: existingMessageOrder })
    const existingMessageSelect = vi.fn().mockReturnValue({ eq: existingMessageEq })

    const inboundInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'message-inbound-1' },
      error: null,
    })
    const inboundInsertSelect = vi.fn().mockReturnValue({ single: inboundInsertSingle })
    const inboundInsert = vi.fn().mockReturnValue({ select: inboundInsertSelect })

    const customerLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Test',
          mobile_number: '+447700900123',
          mobile_e164: '+447700900123',
          sms_opt_in: true,
          sms_status: 'active',
        },
      ],
      error: null,
    })
    const customerOr = vi.fn().mockReturnValue({ limit: customerLimit })
    const customerSelect = vi.fn().mockReturnValue({ or: customerOr })

    const customerOptOutMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'temporary write failure' },
    })
    const customerOptOutSelect = vi.fn().mockReturnValue({ maybeSingle: customerOptOutMaybeSingle })
    const customerOptOutEq = vi.fn().mockReturnValue({ select: customerOptOutSelect })
    const customerUpdate = vi.fn().mockReturnValue({ eq: customerOptOutEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: existingMessageSelect,
            insert: inboundInsert,
          }
        }
        if (table === 'customers') {
          return {
            select: customerSelect,
            update: customerUpdate,
          }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_INBOUND_STOP_1',
      From: '+447700900123',
      To: '+447700900124',
      Body: 'STOP',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(customerUpdate).toHaveBeenCalledTimes(1)
    expect(inboundInsert).not.toHaveBeenCalled()
  })

  it('fails closed when inbound opt-out keyword update affects no rows', async () => {
    ;(twilio.validateRequest as unknown as vi.Mock).mockReturnValue(true)

    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    ;(createClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return { insert: webhookLogInsert }
        }
        throw new Error(`Unexpected public table: ${table}`)
      }),
    })

    const existingMessageMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const existingMessageLimit = vi.fn().mockReturnValue({ maybeSingle: existingMessageMaybeSingle })
    const existingMessageOrder = vi.fn().mockReturnValue({ limit: existingMessageLimit })
    const existingMessageEq = vi.fn().mockReturnValue({ order: existingMessageOrder })
    const existingMessageSelect = vi.fn().mockReturnValue({ eq: existingMessageEq })

    const inboundInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'message-inbound-1' },
      error: null,
    })
    const inboundInsertSelect = vi.fn().mockReturnValue({ single: inboundInsertSingle })
    const inboundInsert = vi.fn().mockReturnValue({ select: inboundInsertSelect })

    const customerLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'customer-1',
          first_name: 'Test',
          mobile_number: '+447700900123',
          mobile_e164: '+447700900123',
          sms_opt_in: true,
          sms_status: 'active',
        },
      ],
      error: null,
    })
    const customerOr = vi.fn().mockReturnValue({ limit: customerLimit })
    const customerSelect = vi.fn().mockReturnValue({ or: customerOr })

    const customerOptOutMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const customerOptOutSelect = vi.fn().mockReturnValue({ maybeSingle: customerOptOutMaybeSingle })
    const customerOptOutEq = vi.fn().mockReturnValue({ select: customerOptOutSelect })
    const customerUpdate = vi.fn().mockReturnValue({ eq: customerOptOutEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return {
            select: existingMessageSelect,
            insert: inboundInsert,
          }
        }
        if (table === 'customers') {
          return {
            select: customerSelect,
            update: customerUpdate,
          }
        }
        throw new Error(`Unexpected admin table: ${table}`)
      }),
    })

    const requestBody = new URLSearchParams({
      MessageSid: 'SM_INBOUND_STOP_2',
      From: '+447700900123',
      To: '+447700900124',
      Body: 'STOPALL please',
    })

    const request = new Request('http://localhost/api/webhooks/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'sig_test',
      },
      body: requestBody.toString(),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Webhook processing failed' })
    expect(customerUpdate).toHaveBeenCalledTimes(1)
    expect(inboundInsert).not.toHaveBeenCalled()
  })
})
