import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => state.flagOn),
}))

vi.mock('@/app/actions/sms', () => ({
  sendSms: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/private-bookings/approved-message', () => ({
  tryEmailForApprovedPrivateBookingText: vi.fn(),
}))

vi.mock('@/lib/private-bookings/email-first', () => ({
  finishPrivateBookingEmailFirstDelivery: vi.fn(async () => undefined),
}))

import { sendSms } from '@/app/actions/sms'
import { tryEmailForApprovedPrivateBookingText } from '@/lib/private-bookings/approved-message'
import { finishPrivateBookingEmailFirstDelivery } from '@/lib/private-bookings/email-first'
import { SmsQueueService } from '@/services/sms-queue'

const mockedSendSms = sendSms as unknown as Mock
const mockedTryEmail = tryEmailForApprovedPrivateBookingText as unknown as Mock
const mockedFinish = finishPrivateBookingEmailFirstDelivery as unknown as Mock

function seed() {
  state.db = createFakeSupabase({
    private_booking_sms_queue: [
      {
        id: 'sms-1',
        booking_id: 'booking-1',
        status: 'approved',
        error_message: null,
        recipient_phone: '+447700900123',
        message_body: 'Hi Alex, your hold on 3 October 2026 expires on 25 September 2026.',
        template_key: 'private_booking_deposit_reminder_3day',
        trigger_type: 'deposit_reminder_3day',
        metadata: { hold_expiry_date: '2026-09-25' },
        approved_by: 'user-1',
      },
    ],
    private_bookings: [{ id: 'booking-1', customer_id: 'customer-1' }],
    private_booking_audit: [],
  })
}

describe('Send Now for an approved private booking text (email first)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    seed()
    mockedSendSms.mockResolvedValue({ success: true, sid: 'SM-1', messageId: 'msg-1', customerId: 'customer-1' })
  })

  it('sends the email instead of the text, and records the row as sent by email', async () => {
    mockedTryEmail.mockResolvedValue({ status: 'sent', deliveryId: 'delivery-1' })

    const result = await SmsQueueService.sendApprovedSms('sms-1')

    expect(result).toEqual({ success: true, channel: 'email' })
    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(mockedTryEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        row: expect.objectContaining({ id: 'sms-1', trigger_type: 'deposit_reminder_3day' }),
        performedBy: 'user-1',
      })
    )
    expect(state.db.tables.private_booking_sms_queue[0]).toMatchObject({
      status: 'sent',
      error_message: null,
      metadata: expect.objectContaining({ delivered_by: 'email', delivery_id: 'delivery-1', hold_expiry_date: '2026-09-25' }),
    })
  })

  it('the email fails: the approved text goes, and the delivery records that it did', async () => {
    mockedTryEmail.mockResolvedValue({ status: 'failed', deliveryId: 'delivery-1', error: 'Resend 500' })

    const result = await SmsQueueService.sendApprovedSms('sms-1')

    expect(result).toMatchObject({ success: true })
    expect(mockedSendSms).toHaveBeenCalledTimes(1)
    expect(mockedFinish).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'delivery-1', sms: expect.objectContaining({ sent: true, sid: 'SM-1' }) })
    )
    expect(state.db.tables.private_booking_sms_queue[0].status).toBe('sent')
  })

  it('both fail: the delivery is finished as failed and the error still reaches staff', async () => {
    mockedTryEmail.mockResolvedValue({ status: 'failed', deliveryId: 'delivery-1', error: 'Resend 500' })
    mockedSendSms.mockResolvedValue({ error: 'Twilio 21211' })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).rejects.toThrow('Twilio 21211')
    expect(mockedFinish).toHaveBeenCalledWith(expect.objectContaining({ sms: expect.objectContaining({ sent: false, error: 'Twilio 21211' }) }))
  })

  it('no usable address or a changed booking: the approved text goes exactly as before', async () => {
    mockedTryEmail.mockResolvedValue({ status: 'not_attempted', reason: 'queued_text_differs' })

    const result = await SmsQueueService.sendApprovedSms('sms-1')

    expect(result).toMatchObject({ success: true })
    expect(mockedSendSms).toHaveBeenCalledTimes(1)
    expect(mockedFinish).not.toHaveBeenCalled()
  })

  it('flag off: the email path is never tried', async () => {
    state.flagOn = false

    await SmsQueueService.sendApprovedSms('sms-1')

    expect(mockedTryEmail).not.toHaveBeenCalled()
    expect(mockedSendSms).toHaveBeenCalledTimes(1)
  })
})
