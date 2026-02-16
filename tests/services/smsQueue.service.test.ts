import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/sms', () => ({
  sendSms: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  resolveCustomerIdForSms: vi.fn(),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendSms } from '@/app/actions/sms'
import { sendSMS } from '@/lib/twilio'
import { resolveCustomerIdForSms } from '@/lib/sms/customers'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { SmsQueueService } from '@/services/sms-queue'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedSendSms = sendSms as unknown as Mock
const mockedSendSMS = sendSMS as unknown as Mock
const mockedResolveCustomerIdForSms = resolveCustomerIdForSms as unknown as Mock
const mockedClaimIdempotencyKey = claimIdempotencyKey as unknown as Mock
const mockedComputeIdempotencyRequestHash = computeIdempotencyRequestHash as unknown as Mock
const mockedReleaseIdempotencyClaim = releaseIdempotencyClaim as unknown as Mock

describe('SmsQueueService queue persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedComputeIdempotencyRequestHash.mockReturnValue('lock-hash')
    mockedClaimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
    mockedReleaseIdempotencyClaim.mockResolvedValue(undefined)
  })

  it('queueAndSend fails closed when booking context lookup errors during recipient resolution', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking lookup unavailable' },
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const insert = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'private_booking_sms_queue') {
          return { insert, select: vi.fn() }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual({
      error: 'Failed to resolve SMS recipient booking context',
      code: 'safety_unavailable',
    })
    expect(bookingEq).toHaveBeenCalledWith('id', 'booking-1')
    expect(mockedClaimIdempotencyKey).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('queueAndSend fails closed when booking context lookup affects no rows during recipient resolution', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const insert = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'private_booking_sms_queue') {
          return { insert, select: vi.fn() }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual({
      error: 'Failed to resolve SMS recipient booking context (booking missing)',
    })
    expect(bookingEq).toHaveBeenCalledWith('id', 'booking-1')
    expect(mockedClaimIdempotencyKey).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('queueAndSend surfaces safety_unavailable when customer context lookup errors during recipient resolution', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: { contact_phone: null, customer_id: 'customer-1' },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const customerMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'customer lookup unavailable' },
    })
    const customerEq = vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
    const customerSelect = vi.fn().mockReturnValue({ eq: customerEq })

    const insert = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'customers') {
          return { select: customerSelect }
        }
        if (table === 'private_booking_sms_queue') {
          return { insert, select: vi.fn() }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual({
      error: 'Failed to resolve SMS recipient customer context',
      code: 'safety_unavailable',
    })
    expect(bookingEq).toHaveBeenCalledWith('id', 'booking-1')
    expect(customerEq).toHaveBeenCalledWith('id', 'customer-1')
    expect(mockedClaimIdempotencyKey).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('surfaces logging_failed when sent-status persistence affects no queue rows', async () => {
    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'sms-1', metadata: {} },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const sentUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const sentUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: sentUpdateMaybeSingle })
    const sentUpdateEq = vi.fn().mockReturnValue({ select: sentUpdateSelect })
    const update = vi.fn().mockReturnValue({ eq: sentUpdateEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue(duplicateQuery),
          insert,
          update,
        }
      }),
    })

    const sendSpy = vi
      .spyOn(SmsQueueService, 'sendPrivateBookingSms')
      .mockResolvedValue({
        success: true,
        sent: true,
        sid: 'SM123',
        messageId: 'msg-1',
        customerId: 'customer-1',
        deliveryState: 'sent',
      })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_phone: '+447700900123',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual({
      success: true,
      sent: true,
      queueId: 'sms-1',
      sid: 'SM123',
      messageId: 'msg-1',
      code: 'logging_failed',
      logFailure: true,
    })

    sendSpy.mockRestore()
  })

  it('returns explicit error when failed-status persistence affects no queue rows', async () => {
    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'sms-2', metadata: {} },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const failedUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const failedUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: failedUpdateMaybeSingle })
    const failedUpdateEq = vi.fn().mockReturnValue({ select: failedUpdateSelect })
    const update = vi.fn().mockReturnValue({ eq: failedUpdateEq })

    const failureStateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'sms-2', status: 'pending' },
      error: null,
    })
    const failureStateEq = vi.fn().mockReturnValue({ maybeSingle: failureStateMaybeSingle })
    const failureStateSelect = vi.fn().mockReturnValue({ eq: failureStateEq })

    const select = vi
      .fn()
      .mockImplementationOnce(() => duplicateQuery)
      .mockImplementationOnce(failureStateSelect)

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select,
          insert,
          update,
        }
      }),
    })

    const sendSpy = vi
      .spyOn(SmsQueueService, 'sendPrivateBookingSms')
      .mockResolvedValue({
        error: 'Twilio unavailable',
      })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-2',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Second message',
      customer_phone: '+447700900124',
      customer_name: 'Jamie Smith',
      customer_id: 'customer-2',
    })

    expect(result).toEqual({
      error: 'SMS failed and queue status update affected no rows',
      queueId: 'sms-2',
      originalError: 'Twilio unavailable',
    })

    sendSpy.mockRestore()
  })

  it('queueAndSend fails closed when another worker holds the enqueue lock and no duplicate row exists', async () => {
    mockedClaimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })

    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    const insert = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue(duplicateQuery),
          insert,
        }
      }),
    })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-3',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_phone: '+447700900125',
      customer_name: 'Taylor Smith',
      customer_id: 'customer-3',
    })

    expect(result).toEqual({ error: 'SMS enqueue already in progress' })
    expect(insert).not.toHaveBeenCalled()
    expect(mockedReleaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('queueAndSend returns suppressed when another worker holds the enqueue lock and the queue row already exists', async () => {
    mockedClaimIdempotencyKey.mockResolvedValue({ state: 'in_progress' })

    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'sms-dup', status: 'sent', twilio_message_sid: 'SM999', metadata: {} }],
        error: null,
      }),
    }

    const insert = vi.fn()

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue(duplicateQuery),
          insert,
        }
      }),
    })

    const result = await SmsQueueService.queueAndSend({
      booking_id: 'booking-4',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_phone: '+447700900126',
      customer_name: 'Morgan Smith',
      customer_id: 'customer-4',
    })

    expect(result).toEqual({
      success: true,
      sent: false,
      suppressed: true,
      suppressionReason: 'duplicate_queue_in_progress',
      queueId: 'sms-dup',
    })
    expect(insert).not.toHaveBeenCalled()
    expect(mockedReleaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('sendApprovedSms fails closed when another worker holds a fresh dispatch claim', async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })
    const update = vi.fn().mockImplementationOnce(() => ({ eq: claimEqId }))

    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sms-1',
        status: 'approved',
        error_message: `dispatching:${new Date().toISOString()}:claim1234`,
      },
      error: null,
    })
    const existingEq = vi.fn().mockReturnValue({ maybeSingle: existingMaybeSingle })
    const select = vi.fn().mockReturnValue({ eq: existingEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
          select,
        }
      }),
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn(),
    })

    await expect(
      SmsQueueService.sendApprovedSms('sms-1')
    ).rejects.toThrow('SMS dispatch already in progress for this queue item')
  })

  it('sendApprovedSms fails closed when a stale dispatch claim cannot be reconciled safely', async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const staleClaimIso = new Date(Date.now() - (11 * 60 * 1000)).toISOString()
    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sms-1',
        status: 'approved',
        error_message: `dispatching:${staleClaimIso}:claim1234`,
      },
      error: null,
    })
    const existingEq = vi.fn().mockReturnValue({ maybeSingle: existingMaybeSingle })
    const existingSelect = vi.fn().mockReturnValue({ eq: existingEq })

    const staleSmsMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sms-1',
        booking_id: 'booking-1',
        recipient_phone: '+447700900123',
        message_body: 'Approved message',
        template_key: 'private_booking_manual',
        metadata: {},
      },
      error: null,
    })
    const staleSmsEq = vi.fn().mockReturnValue({ maybeSingle: staleSmsMaybeSingle })
    const staleSmsSelect = vi.fn().mockReturnValue({ eq: staleSmsEq })

    const select = vi
      .fn()
      .mockImplementationOnce(existingSelect)
      .mockImplementationOnce(staleSmsSelect)

    const update = vi.fn().mockImplementationOnce(() => ({ eq: claimEqId }))

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
          select,
        }
      }),
    })

    const messagesMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const messagesQuery: any = {}
    messagesQuery.contains = vi.fn(() => messagesQuery)
    messagesQuery.eq = vi.fn(() => messagesQuery)
    messagesQuery.gte = vi.fn(() => messagesQuery)
    messagesQuery.order = vi.fn(() => messagesQuery)
    messagesQuery.limit = vi.fn(() => messagesQuery)
    messagesQuery.maybeSingle = messagesMaybeSingle

    const messagesSelect = vi.fn().mockReturnValue(messagesQuery)

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await expect(
      SmsQueueService.sendApprovedSms('sms-1')
    ).rejects.toThrow(
      'Stale SMS dispatch claim detected; refusing to resend automatically because prior send state cannot be verified'
    )

    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('sendApprovedSms reconciles a stale dispatch claim to sent status without re-sending', async () => {
    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const reconcileMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sms-1' }, error: null })
    const reconcileSelect = vi.fn().mockReturnValue({ maybeSingle: reconcileMaybeSingle })
    const reconcileEqClaim = vi.fn().mockReturnValue({ select: reconcileSelect })
    const reconcileEqStatus = vi.fn().mockReturnValue({ eq: reconcileEqClaim })
    const reconcileEqId = vi.fn().mockReturnValue({ eq: reconcileEqStatus })

    const update = vi
      .fn()
      .mockImplementationOnce(() => ({ eq: claimEqId }))
      .mockImplementationOnce(() => ({ eq: reconcileEqId }))

    const staleClaimIso = new Date(Date.now() - (11 * 60 * 1000)).toISOString()
    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sms-1',
        status: 'approved',
        error_message: `dispatching:${staleClaimIso}:claim1234`,
      },
      error: null,
    })
    const existingEq = vi.fn().mockReturnValue({ maybeSingle: existingMaybeSingle })
    const existingSelect = vi.fn().mockReturnValue({ eq: existingEq })

    const staleSmsMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'sms-1',
        booking_id: 'booking-1',
        recipient_phone: '+447700900123',
        message_body: 'Approved message',
        template_key: 'private_booking_manual',
        metadata: { existing: true },
      },
      error: null,
    })
    const staleSmsEq = vi.fn().mockReturnValue({ maybeSingle: staleSmsMaybeSingle })
    const staleSmsSelect = vi.fn().mockReturnValue({ eq: staleSmsEq })

    const select = vi
      .fn()
      .mockImplementationOnce(existingSelect)
      .mockImplementationOnce(staleSmsSelect)

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
          select,
        }
      }),
    })

    const messagesMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'msg-1', twilio_message_sid: 'SM123', sent_at: new Date().toISOString() },
      error: null,
    })
    const messagesLimit = vi.fn().mockReturnValue({ maybeSingle: messagesMaybeSingle })
    const messagesOrder = vi.fn().mockReturnValue({ limit: messagesLimit })
    const messagesContains = vi.fn().mockReturnValue({ order: messagesOrder })
    const messagesSelect = vi.fn().mockReturnValue({ contains: messagesContains })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'messages') {
          return { select: messagesSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).resolves.toEqual({ success: true })
    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(2)

    const reconcilePayload = update.mock.calls[1]?.[0] as any
    expect(reconcilePayload).toEqual(
      expect.objectContaining({
        status: 'sent',
        error_message: null,
        twilio_message_sid: 'SM123',
      })
    )
    expect(reconcilePayload?.metadata).toEqual(
      expect.objectContaining({
        delivery_state: 'sent',
        reconciled_from_stale_claim: true,
        message_id: 'msg-1',
      })
    )
  })

  it('sendApprovedSms surfaces logging_failed when sent-status persistence fails after transport success', async () => {
    const claimedSms = {
      id: 'sms-1',
      booking_id: 'booking-1',
      recipient_phone: '+447700900123',
      message_body: 'Approved message',
      template_key: 'private_booking_manual',
      trigger_type: 'manual',
      metadata: {},
      approved_by: 'user-1',
    }

    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: claimedSms, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const sentMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const sentSelect = vi.fn().mockReturnValue({ maybeSingle: sentMaybeSingle })
    const sentEqDispatch = vi.fn().mockReturnValue({ select: sentSelect })
    const sentEqStatus = vi.fn().mockReturnValue({ eq: sentEqDispatch })
    const sentEqId = vi.fn().mockReturnValue({ eq: sentEqStatus })

    const update = vi
      .fn()
      .mockImplementationOnce(() => ({ eq: claimEqId }))
      .mockImplementationOnce(() => ({ eq: sentEqId }))

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
        }
      }),
    })

    const bookingSingle = vi.fn().mockResolvedValue({ data: { customer_id: 'customer-1' }, error: null })
    const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'private_booking_audit') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedSendSms.mockResolvedValue({
      success: true,
      sid: 'SM123',
      messageId: 'msg-1',
      customerId: 'customer-1',
      suppressed: false,
      deferred: false,
    })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).resolves.toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })
  })

  it('sendApprovedSms fails closed when booking context lookup errors before send', async () => {
    const claimedSms = {
      id: 'sms-1',
      booking_id: 'booking-1',
      recipient_phone: '+447700900123',
      message_body: 'Approved message',
      template_key: 'private_booking_manual',
      trigger_type: 'manual',
      metadata: {},
      approved_by: 'user-1',
    }

    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: claimedSms, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })
    const update = vi.fn().mockImplementationOnce(() => ({ eq: claimEqId }))

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
        }
      }),
    })

    const bookingSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'booking lookup unavailable' },
    })
    const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).rejects.toThrow(
      'Failed to load booking context for approved SMS send'
    )

    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('sendApprovedSms propagates thrown idempotency_conflict safety metadata from send errors', async () => {
    const claimedSms = {
      id: 'sms-1',
      booking_id: 'booking-1',
      recipient_phone: '+447700900123',
      message_body: 'Approved message',
      template_key: 'private_booking_manual',
      trigger_type: 'manual',
      metadata: {},
      approved_by: 'user-1',
    }

    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: claimedSms, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const failedMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sms-1' }, error: null })
    const failedSelect = vi.fn().mockReturnValue({ maybeSingle: failedMaybeSingle })
    const failedEqDispatch = vi.fn().mockReturnValue({ select: failedSelect })
    const failedEqStatus = vi.fn().mockReturnValue({ eq: failedEqDispatch })
    const failedEqId = vi.fn().mockReturnValue({ eq: failedEqStatus })

    const update = vi
      .fn()
      .mockImplementationOnce(() => ({ eq: claimEqId }))
      .mockImplementationOnce(() => ({ eq: failedEqId }))

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
        }
      }),
    })

    const bookingSingle = vi.fn().mockResolvedValue({ data: { customer_id: 'customer-1' }, error: null })
    const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'private_booking_audit') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedSendSms.mockRejectedValue(
      Object.assign(new Error('idempotency claim conflict'), {
        code: 'idempotency_conflict',
        logFailure: false,
      })
    )

    await expect(SmsQueueService.sendApprovedSms('sms-1')).rejects.toMatchObject({
      message: 'idempotency claim conflict',
      code: 'idempotency_conflict',
    })

    expect(update).toHaveBeenCalledTimes(2)
  })

  it('sendApprovedSms keeps queue correlation out of the idempotency context', async () => {
    const claimedSms = {
      id: 'sms-1',
      booking_id: 'booking-1',
      recipient_phone: '+447700900123',
      message_body: 'Approved message',
      template_key: 'private_booking_manual',
      trigger_type: 'manual',
      metadata: { existing: true },
      approved_by: 'user-1',
    }

    const claimMaybeSingle = vi.fn().mockResolvedValue({ data: claimedSms, error: null })
    const claimSelect = vi.fn().mockReturnValue({ maybeSingle: claimMaybeSingle })
    const claimIs = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEqStatus = vi.fn().mockReturnValue({ is: claimIs })
    const claimEqId = vi.fn().mockReturnValue({ eq: claimEqStatus })

    const sentMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sms-1' }, error: null })
    const sentSelect = vi.fn().mockReturnValue({ maybeSingle: sentMaybeSingle })
    const sentEqDispatch = vi.fn().mockReturnValue({ select: sentSelect })
    const sentEqStatus = vi.fn().mockReturnValue({ eq: sentEqDispatch })
    const sentEqId = vi.fn().mockReturnValue({ eq: sentEqStatus })

    const update = vi
      .fn()
      .mockImplementationOnce(() => ({ eq: claimEqId }))
      .mockImplementationOnce(() => ({ eq: sentEqId }))

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
        }
      }),
    })

    const bookingSingle = vi.fn().mockResolvedValue({ data: { customer_id: 'customer-1' }, error: null })
    const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          return { select: bookingSelect }
        }
        if (table === 'private_booking_audit') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    mockedSendSms.mockResolvedValue({
      success: true,
      sid: 'SM123',
      messageId: 'msg-1',
      customerId: 'customer-1',
      suppressed: false,
      deferred: false,
      code: 'logging_failed',
      logFailure: true,
    })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).resolves.toEqual({
      success: true,
      code: 'logging_failed',
      logFailure: true,
    })

    expect(update).toHaveBeenCalledTimes(2)
    const sentUpdatePayload = update.mock.calls[1]?.[0] as any
    expect(sentUpdatePayload?.metadata).toEqual(
      expect.objectContaining({
        sms_code: 'logging_failed',
        sms_log_failure: true,
      })
    )

    expect(mockedSendSms).toHaveBeenCalledTimes(1)
    expect(mockedSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        to: '+447700900123',
        body: 'Approved message',
        metadata: expect.objectContaining({
          private_booking_id: 'booking-1',
          queue_id: 'sms-1',
          queue_job_id: 'private_booking_sms_queue:sms-1',
        }),
      })
    )
    expect((mockedSendSms.mock.calls[0]?.[0] as any)?.metadata).not.toHaveProperty('job_id')
  })

  it('sendPrivateBookingSms uses sendSMS directly (system context) with stable dedupe metadata', async () => {
    mockedCreateAdminClient.mockReturnValue({})
    mockedResolveCustomerIdForSms.mockResolvedValue({ customerId: 'customer-1' })
    mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM123',
      messageId: 'msg-1',
      customerId: 'customer-1',
      suppressed: false,
      deferred: false,
    })

    const body = 'The Anchor: Hi Alex, reminder.'
    const expectedStage = createHash('sha256').update(body).digest('hex').slice(0, 16)

    const result: any = await SmsQueueService.sendPrivateBookingSms(
      'booking-1',
      'deposit_reminder_7day',
      'private_booking_deposit_reminder_7day',
      '+447700900123',
      body,
      undefined,
      'sms-queue-1'
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sid: 'SM123',
        sent: true,
        messageId: 'msg-1',
        customerId: 'customer-1',
        deliveryState: 'sent',
        logFailure: false,
      })
    )
    expect(result.code).toBeUndefined()

    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
    expect(mockedSendSMS).toHaveBeenCalledWith(
      '+447700900123',
      body,
      expect.objectContaining({
        customerId: 'customer-1',
        createCustomerIfMissing: false,
        metadata: expect.objectContaining({
          private_booking_id: 'booking-1',
          booking_id: 'booking-1',
          queue_id: 'sms-queue-1',
          queue_job_id: 'private_booking_sms_queue:sms-queue-1',
          template_key: 'private_booking_deposit_reminder_7day',
          trigger_type: 'deposit_reminder_7day',
          stage: expectedStage,
        }),
      })
    )
  })

  it('sendPrivateBookingSms surfaces logging_failed safety signals without calling sendSms', async () => {
    mockedCreateAdminClient.mockReturnValue({})
    mockedResolveCustomerIdForSms.mockResolvedValue({ customerId: 'customer-1' })
    mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM123',
      messageId: 'msg-1',
      customerId: 'customer-1',
      suppressed: false,
      deferred: false,
      code: 'logging_failed',
      logFailure: true,
    })

    const result: any = await SmsQueueService.sendPrivateBookingSms(
      'booking-1',
      'deposit_reminder_7day',
      'private_booking_deposit_reminder_7day',
      '+447700900123',
      'The Anchor: Hi Alex, reminder.',
      undefined,
      'sms-queue-1'
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sent: true,
        code: 'logging_failed',
        logFailure: true,
      })
    )

    expect(mockedSendSms).not.toHaveBeenCalled()
  })

  it('sendPrivateBookingSms maps lookup failures to safety_unavailable without calling transport send', async () => {
    mockedCreateAdminClient.mockReturnValue({})
    mockedResolveCustomerIdForSms.mockResolvedValue({
      customerId: null,
      resolutionError: 'booking_lookup_failed',
    })

    const result: any = await SmsQueueService.sendPrivateBookingSms(
      'booking-1',
      'deposit_reminder_7day',
      'private_booking_deposit_reminder_7day',
      '+447700900123',
      'The Anchor: Hi Alex, reminder.',
      undefined,
      'sms-queue-1'
    )

    expect(result).toEqual(
      expect.objectContaining({
        error: 'Failed SMS recipient safety check',
        code: 'safety_unavailable',
      })
    )
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(mockedSendSms).not.toHaveBeenCalled()
  })

  it('sendPrivateBookingSms normalizes logging_failed to logFailure even when transport meta omits the boolean', async () => {
    mockedCreateAdminClient.mockReturnValue({})
    mockedResolveCustomerIdForSms.mockResolvedValue({ customerId: 'customer-1' })
    mockedSendSMS.mockResolvedValue({
      success: true,
      sid: 'SM123',
      messageId: 'msg-1',
      customerId: 'customer-1',
      suppressed: false,
      deferred: false,
      code: 'logging_failed',
      logFailure: false,
    })

    const result: any = await SmsQueueService.sendPrivateBookingSms(
      'booking-1',
      'deposit_reminder_7day',
      'private_booking_deposit_reminder_7day',
      '+447700900123',
      'The Anchor: Hi Alex, reminder.',
      undefined,
      'sms-queue-1'
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sent: true,
        code: 'logging_failed',
        logFailure: true,
      })
    )
    expect(mockedSendSms).not.toHaveBeenCalled()
  })

  it('queueAndSend persists sms_log_failure markers and surfaces safety signals to callers', async () => {
    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'sms-1', metadata: {} },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: insertSelect })

    const sentUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sms-1' }, error: null })
    const sentUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: sentUpdateMaybeSingle })
    const sentUpdateEq = vi.fn().mockReturnValue({ select: sentUpdateSelect })
    const update = vi.fn().mockReturnValue({ eq: sentUpdateEq })

    const auditInsert = vi.fn().mockResolvedValue({ error: null })

    mockedCreateAdminClient.mockImplementation(() => ({
      from: vi.fn((table: string) => {
        if (table === 'private_booking_sms_queue') {
          return {
            select: vi.fn().mockReturnValue(duplicateQuery),
            insert,
            update,
          }
        }
        if (table === 'private_booking_audit') {
          return { insert: auditInsert }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }))

    const sendSpy = vi
      .spyOn(SmsQueueService, 'sendPrivateBookingSms')
      .mockResolvedValue({
        success: true,
        sent: true,
        sid: 'SM123',
        messageId: 'msg-1',
        customerId: 'customer-1',
        deliveryState: 'sent',
        code: 'logging_failed',
        logFailure: true,
      } as any)

    const result: any = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_phone: '+447700900123',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sent: true,
        queueId: 'sms-1',
        sid: 'SM123',
        messageId: 'msg-1',
        code: 'logging_failed',
        logFailure: true,
      })
    )

    expect(update).toHaveBeenCalledTimes(1)
    const updatePayload = update.mock.calls[0]?.[0] as any
    expect(updatePayload?.metadata).toEqual(
      expect.objectContaining({
        sms_code: 'logging_failed',
        sms_log_failure: true,
      })
    )

    sendSpy.mockRestore()
  })

  it('queueAndSend claims auto-send rows with a dispatch marker and clears it after send persistence', async () => {
    const duplicateQuery: any = {
      eq: vi.fn(() => duplicateQuery),
      in: vi.fn(() => duplicateQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    let insertedPayload: any | null = null
    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: 'sms-claim-1', metadata: {} },
      error: null,
    })
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn((payload: any) => {
      insertedPayload = payload
      return { select: insertSelect }
    })

    let updatePayload: any | null = null
    const sentUpdateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'sms-claim-1' }, error: null })
    const sentUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: sentUpdateMaybeSingle })
    const sentUpdateEq = vi.fn().mockReturnValue({ select: sentUpdateSelect })
    const update = vi.fn((payload: any) => {
      updatePayload = payload
      return { eq: sentUpdateEq }
    })

    mockedCreateAdminClient.mockImplementation(() => ({
      from: vi.fn((table: string) => {
        if (table === 'private_booking_sms_queue') {
          return {
            select: vi.fn().mockReturnValue(duplicateQuery),
            insert,
            update,
          }
        }
        if (table === 'private_booking_audit') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }))

    const sendSpy = vi
      .spyOn(SmsQueueService, 'sendPrivateBookingSms')
      .mockResolvedValue({
        success: true,
        sent: true,
        sid: 'SM123',
        messageId: 'msg-1',
        customerId: 'customer-1',
        deliveryState: 'sent',
      } as any)

    const result: any = await SmsQueueService.queueAndSend({
      booking_id: 'booking-1',
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: 'Hello from The Anchor',
      customer_phone: '+447700900123',
      customer_name: 'Alex Smith',
      customer_id: 'customer-1',
    })

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        sent: true,
        queueId: 'sms-claim-1',
      })
    )

    expect(insertedPayload).toEqual(expect.objectContaining({ status: 'pending' }))
    expect(typeof insertedPayload?.error_message).toBe('string')
    expect(insertedPayload?.error_message).toMatch(/^dispatching:/)

    expect(updatePayload).toEqual(
      expect.objectContaining({
        status: 'sent',
        error_message: null,
      })
    )

    sendSpy.mockRestore()
  })

  it('approveSms fails closed when a dispatch marker is present', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateIs = vi.fn().mockReturnValue({ select: updateSelect })
    const updateEqStatus = vi.fn().mockReturnValue({ is: updateIs })
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqStatus })
    const update = vi.fn().mockReturnValue({ eq: updateEqId })

    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: { status: 'pending', error_message: `dispatching:${new Date().toISOString()}:claim1234` },
      error: null,
    })
    const existingEq = vi.fn().mockReturnValue({ maybeSingle: existingMaybeSingle })
    const select = vi.fn().mockReturnValue({ eq: existingEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update,
          select,
        }
      }),
    })

    await expect(SmsQueueService.approveSms('sms-claim-1', 'user-1')).rejects.toThrow(
      'SMS dispatch already in progress for this queue item'
    )

    expect(update).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)

    // ensure approval uses a fail-closed "must not be dispatching" guard
    expect(updateEqStatus).toHaveBeenCalledWith('status', 'pending')
    expect(updateIs).toHaveBeenCalledWith('error_message', null)
  })
})
