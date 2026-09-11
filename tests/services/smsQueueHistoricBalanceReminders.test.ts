import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flags: {} as Record<string, boolean> }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => state.flags[key] === true),
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

import { sendSms } from '@/app/actions/sms'
import { tryEmailForApprovedPrivateBookingText } from '@/lib/private-bookings/approved-message'
import { SmsQueueService } from '@/services/sms-queue'
import { HISTORIC_BALANCE_REMINDER_REFUSAL } from '@/lib/private-bookings/balance-reminders'

const mockedSendSms = sendSms as unknown as Mock
const mockedTryEmail = tryEmailForApprovedPrivateBookingText as unknown as Mock

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sms-1',
    booking_id: 'booking-1',
    status: 'pending',
    error_message: null,
    recipient_phone: '+447700900123',
    message_body: 'Hi Alex, £900 balance and your final details (numbers, menus, suppliers) are due by 26 September 2026 for 10 October 2026.',
    template_key: 'private_booking_balance_reminder_21day',
    trigger_type: 'balance_reminder_21day',
    metadata: { balance_due_date: '2026-09-26' },
    approved_by: null,
    created_at: '2026-07-06T09:00:00.000Z',
    ...overrides,
  }
}

function seed(row: Record<string, unknown>) {
  state.db = createFakeSupabase({
    private_booking_sms_queue: [row],
    private_bookings: [{ id: 'booking-1', customer_id: 'customer-1' }],
    private_booking_audit: [],
  })
}

function queued() {
  return state.db.tables.private_booking_sms_queue[0]
}

describe('balance reminders queued before the switch to email are never sent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { private_booking_balance_email_auto: true }
    mockedSendSms.mockResolvedValue({ success: true, sid: 'SM-1', messageId: 'msg-1', customerId: 'customer-1' })
    mockedTryEmail.mockResolvedValue({ status: 'not_attempted', reason: 'flag_off' })
  })

  it('cannot be approved: staff are told why and the row is left as it was', async () => {
    seed(queueRow())

    await expect(SmsQueueService.approveSms('sms-1', 'user-1')).rejects.toThrow(HISTORIC_BALANCE_REMINDER_REFUSAL)

    expect(queued()).toMatchObject({ status: 'pending', approved_by: null })
  })

  it('cannot be sent, even if it was approved before the switch, and is not even claimed', async () => {
    seed(queueRow({ status: 'approved', approved_by: 'user-1' }))

    await expect(SmsQueueService.sendApprovedSms('sms-1')).rejects.toThrow(HISTORIC_BALANCE_REMINDER_REFUSAL)

    expect(queued()).toMatchObject({ status: 'approved', error_message: null })
    expect(mockedSendSms).not.toHaveBeenCalled()
    expect(mockedTryEmail).not.toHaveBeenCalled()
  })

  it.each(['balance_reminder_16day', 'balance_reminder_15day', 'balance_reminder_due', 'balance_reminder_14day'])(
    'refuses the older %s rows too',
    async (triggerType) => {
      seed(queueRow({ trigger_type: triggerType, template_key: `private_booking_${triggerType}` }))
      await expect(SmsQueueService.approveSms('sms-1', 'user-1')).rejects.toThrow(HISTORIC_BALANCE_REMINDER_REFUSAL)
    }
  )

  it('can still be rejected, to clear it from the queue', async () => {
    seed(queueRow())

    await SmsQueueService.rejectSms('sms-1', 'user-1')

    expect(queued().status).toBe('cancelled')
  })

  it('a reminder queued after the switch (no usable email) is approved and sent as before', async () => {
    seed(queueRow({ metadata: { balance_due_date: '2026-09-26', balance_email_auto: true } }))

    await SmsQueueService.approveSms('sms-1', 'user-1')
    expect(queued().status).toBe('approved')

    await SmsQueueService.sendApprovedSms('sms-1')
    expect(mockedSendSms).toHaveBeenCalledTimes(1)
    expect(queued().status).toBe('sent')
  })

  it('other queued texts are not affected', async () => {
    seed(queueRow({ trigger_type: 'deposit_reminder_3day', template_key: 'private_booking_deposit_reminder_3day', metadata: {} }))

    await SmsQueueService.approveSms('sms-1', 'user-1')

    expect(queued().status).toBe('approved')
  })

  it('if the row cannot be checked, nothing is sent', async () => {
    seed(queueRow({ status: 'approved', metadata: { balance_email_auto: true } }))
    state.db.failures.push({ table: 'private_booking_sms_queue', op: 'select', error: { message: 'timeout' } })

    await expect(SmsQueueService.sendApprovedSms('sms-1')).rejects.toThrow('Could not check this queued message, so it was not sent.')
    expect(mockedSendSms).not.toHaveBeenCalled()
  })

  it('with the flag off, the backlog behaves exactly as today', async () => {
    state.flags = {}
    seed(queueRow())

    await SmsQueueService.approveSms('sms-1', 'user-1')
    await SmsQueueService.sendApprovedSms('sms-1')

    expect(mockedSendSms).toHaveBeenCalledTimes(1)
    expect(queued().status).toBe('sent')
  })
})
