import { beforeEach, describe, expect, it, vi } from 'vitest'

// Parking customer messages: email first, a text only without a usable email (owner, 24 November
// 2026). The templates are rendered with fixture data and must never show a placeholder.

vi.mock('@/lib/notifications/notify', () => ({ notifyCustomer: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { notifyCustomer } from '@/lib/notifications/notify'
import { resolveNotificationRoute } from '@/lib/notifications/routing-matrix'
import {
  parkingChangeEmail,
  parkingConfirmationEmail,
  parkingPaymentReminderEmail,
  parkingPaymentRequestEmail,
  parkingSessionReminderEmail,
  parkingTopUpReceivedEmail,
  renderParkingEmail,
  sendParkingCustomerMessage,
  type ParkingEmailContent,
} from '@/lib/parking/customer-message'
import type { ParkingNotificationBooking } from '@/lib/parking/notifications'

const booking: ParkingNotificationBooking = {
  id: 'booking-1',
  reference: 'PAR-20261201-0001',
  customer_id: 'customer-1',
  customer_first_name: 'Sam',
  customer_last_name: 'Jones',
  customer_mobile: '+447700900123',
  customer_email: 'sam@example.com',
  vehicle_registration: 'AB12CDE',
  // 1 December 2026, 10:00 UTC is 10:00 in London (GMT); 1 July is BST, an hour ahead.
  start_at: '2026-12-01T10:00:00.000Z',
  end_at: '2026-12-10T10:00:00.000Z',
  calculated_price: 105,
  override_price: null,
}

const summerBooking: ParkingNotificationBooking = { ...booking, start_at: '2026-07-01T09:00:00.000Z', end_at: '2026-07-03T09:00:00.000Z' }

const LINK = 'https://management.orangejelly.co.uk/parking/guest/booking-1'

const templates: Array<[string, ParkingEmailContent]> = [
  ['payment request', parkingPaymentRequestEmail(booking, LINK)],
  ['payment request, no link yet', parkingPaymentRequestEmail(booking, null)],
  ['reminder, a week before', parkingPaymentReminderEmail(booking, 'week_before_expiry', LINK)],
  ['reminder, the day before', parkingPaymentReminderEmail(booking, 'day_before_expiry', LINK, 'tomorrow at 10:00am')],
  ['confirmation', parkingConfirmationEmail(booking)],
  ['starts soon', parkingSessionReminderEmail(booking, 'start')],
  ['ends soon', parkingSessionReminderEmail(booking, 'end')],
  ['change, plain', parkingChangeEmail(booking, { kind: 'plain' })],
  ['change, refund', parkingChangeEmail(booking, { kind: 'refund', amount: 5 })],
  ['change, pay link', parkingChangeEmail(booking, { kind: 'pay_link', amount: 30, link: LINK })],
  ['change, paid at venue', parkingChangeEmail(booking, { kind: 'paid_at_venue', amount: 30 })],
  ['top-up received', parkingTopUpReceivedEmail(booking, 30)],
]

describe('parking email templates', () => {
  it.each(templates)('%s renders with no placeholder, bad date, NaN or zero amount', (_name, content) => {
    const rendered = renderParkingEmail(booking, content)
    for (const part of [rendered.subject, rendered.html, rendered.text]) {
      expect(part).not.toMatch(/undefined|null|Invalid Date|NaN|£0\.00/)
    }
    expect(rendered.text).toContain('PAR-20261201-0001')
    expect(rendered.text).toContain('AB12CDE')
    expect(rendered.text).toContain('Sam')
    expect(rendered.html).toContain('01753')
  })

  it('shows the London time in winter and in summer, whatever zone the server runs in', () => {
    const winter = renderParkingEmail(booking, parkingConfirmationEmail(booking)).text
    expect(winter).toMatch(/10:00|10am/)
    const summer = renderParkingEmail(summerBooking, parkingConfirmationEmail(summerBooking)).text
    // 09:00 UTC on 1 July is 10:00 BST.
    expect(summer).toMatch(/10:00|10am/)
  })

  it('a payment link is a button in the HTML and a plain line in the text', () => {
    const rendered = renderParkingEmail(booking, parkingPaymentRequestEmail(booking, LINK))
    expect(rendered.html).toContain(`href="${LINK}"`)
    expect(rendered.html).toContain('Pay £105.00')
    expect(rendered.text).toContain(`Pay £105.00: ${LINK}`)
  })

  it('escapes what a person typed', () => {
    const rendered = renderParkingEmail({ ...booking, customer_first_name: 'Sam <b>&' }, parkingConfirmationEmail(booking))
    const withName = renderParkingEmail({ ...booking, customer_first_name: 'Sam <b>&' }, parkingConfirmationEmail({ ...booking, customer_first_name: 'Sam <b>&' }))
    expect(rendered.html).not.toContain('<b>&')
    expect(withName.html).toContain('Sam &lt;b&gt;&amp;')
  })
})

describe('routing', () => {
  it('every parking template is email first, then a text, and never WhatsApp-only', () => {
    for (const key of ['parking_payment_request', 'parking_session_start_3d', 'parking_booking_changed', 'parking_top_up_received']) {
      expect(resolveNotificationRoute({ templateKey: key, policy: 'email_first' }).channels).toEqual(['email', 'whatsapp', 'sms'])
    }
  })
})

describe('sendParkingCustomerMessage', () => {
  beforeEach(() => vi.clearAllMocks())

  const send = () =>
    sendParkingCustomerMessage({
      client: {} as never,
      booking,
      eventType: 'top_up_received',
      templateKey: 'parking_top_up_received',
      email: parkingTopUpReceivedEmail(booking, 30),
      smsBody: 'The Anchor: thanks, we have your £30.00.',
      dedupe: { payment_id: 'pay-2', change_id: undefined },
    })

  it('asks for email first, with both versions and the dedupe ids, and no WhatsApp', async () => {
    vi.mocked(notifyCustomer).mockResolvedValue({
      selectedChannels: ['email', 'sms'],
      attempts: [{ channel: 'email', success: true, messageId: 'email-1' }],
      finalStatus: 'sent',
      sentChannel: 'email',
      fallbackUsed: false,
    })
    const result = await send()
    expect(result).toMatchObject({ status: 'sent', channel: 'email', messageId: 'email-1' })
    const input = vi.mocked(notifyCustomer).mock.calls[0][0]
    expect(input.policy).toBe('email_first')
    expect(input.whatsapp).toBeUndefined()
    expect(input.email).toMatchObject({ to: 'sam@example.com', parkingBookingId: 'booking-1', commType: 'parking_top_up_received' })
    expect(input.email?.idempotencyKey).toBe('parking:booking-1:parking_top_up_received:payment_id=pay-2')
    expect(input.sms).toMatchObject({ to: '+447700900123' })
    expect(input.sms?.options?.metadata).toMatchObject({ payment_id: 'pay-2', parking_booking_id: 'booking-1' })
    // Ids and facts only in the delivery record.
    expect(JSON.stringify(input.deliveryMetadata)).not.toMatch(/sam@|7700/)
  })

  it('reports the text when the email failed and the text went instead', async () => {
    vi.mocked(notifyCustomer).mockResolvedValue({
      selectedChannels: ['email', 'sms'],
      attempts: [
        { channel: 'email', success: false, error: 'provider down', code: 'provider_error' },
        { channel: 'sms', success: true, messageId: 'SM1' },
      ],
      finalStatus: 'sent',
      sentChannel: 'sms',
      fallbackUsed: true,
    })
    expect(await send()).toMatchObject({ status: 'sent', channel: 'sms', messageId: 'SM1', fallbackUsed: true })
  })

  it('a text held for quiet hours is held, not sent', async () => {
    vi.mocked(notifyCustomer).mockResolvedValue({
      selectedChannels: ['sms'],
      attempts: [{ channel: 'sms', success: true, messageId: 'SM2', scheduledFor: '2026-12-01T09:00:00.000Z' }],
      finalStatus: 'sent',
      sentChannel: 'sms',
      fallbackUsed: false,
    })
    expect(await send()).toMatchObject({ status: 'held', scheduledFor: '2026-12-01T09:00:00.000Z' })
  })

  it('no email and no textable mobile is skipped, with a reason', async () => {
    vi.mocked(notifyCustomer).mockResolvedValue({
      selectedChannels: [],
      attempts: [],
      finalStatus: 'no_channel',
      sentChannel: null,
      fallbackUsed: false,
      noChannelReason: 'no_channel_available',
    })
    expect(await send()).toMatchObject({ status: 'skipped', channel: null })
  })

  it('never throws, and keeps an SMS safety code from a send that threw', async () => {
    vi.mocked(notifyCustomer).mockRejectedValue(Object.assign(new Error('boom'), { code: 'logging_failed' }))
    expect(await send()).toMatchObject({ status: 'failed', code: 'logging_failed', logFailure: true })
  })
})
