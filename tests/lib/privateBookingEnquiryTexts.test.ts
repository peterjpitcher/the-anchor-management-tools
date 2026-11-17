import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The texts a website callback request sends (owner decision, 17 November 2026): one
 * acknowledgement to the customer through the private booking text queue, and one alert to each
 * staff mobile in PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS. Nothing here reaches Twilio: the queue and
 * the staff alert sender are mocked.
 */

const queueAndSend = vi.hoisted(() => vi.fn())
vi.mock('@/services/sms-queue', () => ({ SmsQueueService: { queueAndSend } }))

const sendStaffAlertSms = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sms/staff-alert', () => ({ sendStaffAlertSms }))

const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error } }))

import {
  ENQUIRY_ACK_TEMPLATE_KEY,
  ENQUIRY_ACK_TRIGGER_TYPE,
  ENQUIRY_ALERT_NUMBERS_ENV,
  ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
  buildEnquiryAckText,
  buildEnquiryStaffAlertText,
  parseEnquiryAlertNumbers,
  sendWebEnquiryTexts,
  type WebEnquiryTextBooking,
} from '@/lib/private-bookings/enquiry-texts'
import { shouldAutoSendPrivateBookingSms } from '@/lib/private-bookings/sms-approval'
import { getAppUrl } from '@/lib/env'

const BOOKING: WebEnquiryTextBooking = {
  id: 'pb-test-1',
  customerId: 'cust-test-1',
  firstName: 'Alex',
  lastName: 'Example',
  contactPhone: '+447700900123',
  eventType: 'Wake',
}

const STAFF_A = '+447700900201'
const STAFF_B = '+447700900202'
const LONG_DASH = String.fromCharCode(0x2014)

function assertCleanText(text: string) {
  expect(text).not.toMatch(/undefined|null|NaN|Invalid Date/)
  expect(text).not.toMatch(/\{|\}/)
  expect(text).not.toContain(LONG_DASH)
  expect(text).not.toMatch(/thanks\s+,/)
}

describe('callback request texts', () => {
  const saved = process.env[ENQUIRY_ALERT_NUMBERS_ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env[ENQUIRY_ALERT_NUMBERS_ENV]
    queueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'q-1' })
    sendStaffAlertSms.mockResolvedValue({ outcome: 'sent' })
  })

  afterEach(() => {
    if (saved === undefined) delete process.env[ENQUIRY_ALERT_NUMBERS_ENV]
    else process.env[ENQUIRY_ALERT_NUMBERS_ENV] = saved
  })

  describe('the acknowledgement wording', () => {
    it('renders with the first name, exactly as approved', () => {
      const text = buildEnquiryAckText('Alex')
      expect(text).toBe(
        "The Anchor: thanks Alex, we've got your request and we'll call you back. Need us sooner? Call 01753 682707."
      )
      assertCleanText(text)
    })

    it.each([null, '', '   ', 'Guest', 'guest'])('drops the name when it is %j', (firstName) => {
      const text = buildEnquiryAckText(firstName)
      expect(text).toBe(
        "The Anchor: thanks, we've got your request and we'll call you back. Need us sooner? Call 01753 682707."
      )
      assertCleanText(text)
    })

    it('names no day, because a text held by quiet hours arrives the next morning', () => {
      expect(buildEnquiryAckText('Alex')).not.toMatch(/today|tomorrow|same day|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i)
    })
  })

  describe('the staff alert wording', () => {
    it('names the customer, their number, the occasion and the booking link', () => {
      const text = buildEnquiryStaffAlertText(BOOKING, 'https://app.example.test')
      expect(text).toBe(
        "New website enquiry: Alex Example, +447700900123. Wake. They've been told we'll call back the same day. https://app.example.test/private-bookings/pb-test-1"
      )
      assertCleanText(text)
    })

    it('says Private hire when no occasion was given, and never prints the Guest placeholder', () => {
      const text = buildEnquiryStaffAlertText(
        { ...BOOKING, firstName: 'Guest', lastName: null, eventType: null },
        'https://app.example.test'
      )
      expect(text).toBe(
        "New website enquiry: Name not given, +447700900123. Private hire. They've been told we'll call back the same day. https://app.example.test/private-bookings/pb-test-1"
      )
      assertCleanText(text)
    })
  })

  describe('reading the staff numbers', () => {
    it('is empty, with no error, when the variable is unset or blank', () => {
      expect(parseEnquiryAlertNumbers(undefined)).toEqual([])
      expect(parseEnquiryAlertNumbers('')).toEqual([])
      expect(parseEnquiryAlertNumbers(' , ')).toEqual([])
      expect(error).not.toHaveBeenCalled()
    })

    it('normalises each number, skips and logs one that will not parse, and keeps the rest', () => {
      expect(parseEnquiryAlertNumbers(`${STAFF_A}, not-a-number ,07700 900202`)).toEqual([STAFF_A, STAFF_B])
      expect(error).toHaveBeenCalledTimes(1)
    })

    it('texts a number listed twice only once', () => {
      expect(parseEnquiryAlertNumbers(`${STAFF_A},${STAFF_A}`)).toEqual([STAFF_A])
    })
  })

  describe('sendWebEnquiryTexts', () => {
    it('queues one acknowledgement with the right key, trigger, customer and wording', async () => {
      await sendWebEnquiryTexts(BOOKING)

      expect(queueAndSend).toHaveBeenCalledTimes(1)
      expect(queueAndSend).toHaveBeenCalledWith({
        booking_id: 'pb-test-1',
        trigger_type: ENQUIRY_ACK_TRIGGER_TYPE,
        template_key: 'private_booking_enquiry_ack',
        message_body: "The Anchor: thanks Alex, we've got your request and we'll call you back. Need us sooner? Call 01753 682707.",
        customer_phone: '+447700900123',
        customer_name: 'Alex Example',
        customer_id: 'cust-test-1',
        metadata: { template_key: ENQUIRY_ACK_TEMPLATE_KEY, private_booking_id: 'pb-test-1' },
      })
    })

    it('sends the acknowledgement straight away rather than waiting for staff approval', () => {
      expect(shouldAutoSendPrivateBookingSms(ENQUIRY_ACK_TRIGGER_TYPE)).toBe(true)
    })

    it('uses the nameless wording when the enquiry had no name', async () => {
      await sendWebEnquiryTexts({ ...BOOKING, firstName: 'Guest', lastName: null })

      expect(queueAndSend.mock.calls[0][0].message_body).toBe(
        "The Anchor: thanks, we've got your request and we'll call you back. Need us sooner? Call 01753 682707."
      )
    })

    it('sends no staff alert when the variable is unset', async () => {
      await sendWebEnquiryTexts(BOOKING)

      expect(sendStaffAlertSms).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    })

    it('sends one alert to each configured number, as staff texts tied to the booking', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = `${STAFF_A},${STAFF_B}`

      await sendWebEnquiryTexts(BOOKING)

      expect(sendStaffAlertSms).toHaveBeenCalledTimes(2)
      expect(sendStaffAlertSms.mock.calls.map(([alert]) => alert.to)).toEqual([STAFF_A, STAFF_B])
      for (const [alert] of sendStaffAlertSms.mock.calls) {
        expect(alert.body).toBe(buildEnquiryStaffAlertText(BOOKING, getAppUrl()))
        expect(alert.metadata).toEqual({
          template_key: ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
          trigger_type: ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
          private_booking_id: 'pb-test-1',
          source: 'private_booking_enquiry',
        })
      }
    })

    it('skips a bad number and still alerts the rest', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = `${STAFF_A},12,${STAFF_B}`

      await sendWebEnquiryTexts(BOOKING)

      expect(sendStaffAlertSms.mock.calls.map(([alert]) => alert.to)).toEqual([STAFF_A, STAFF_B])
      expect(error).toHaveBeenCalledTimes(1)
    })

    it('still alerts staff, and never throws, when the acknowledgement send rejects', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = STAFF_A
      queueAndSend.mockRejectedValueOnce(new Error('twilio down'))

      await expect(sendWebEnquiryTexts(BOOKING)).resolves.toBeUndefined()

      expect(sendStaffAlertSms).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(
        'The acknowledgement text for a website callback request failed',
        expect.objectContaining({ metadata: { privateBookingId: 'pb-test-1' } })
      )
    })

    it('logs an acknowledgement the queue reports as not sent', async () => {
      queueAndSend.mockResolvedValueOnce({ error: 'SMS sending is currently suspended', code: 'sms_suspended' })

      await sendWebEnquiryTexts(BOOKING)

      expect(error).toHaveBeenCalledWith(
        'The acknowledgement text for a website callback request was not sent',
        expect.anything()
      )
    })

    it('carries on to the next staff number when one alert rejects or fails', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = `${STAFF_A},${STAFF_B}`
      sendStaffAlertSms
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ outcome: 'failed', error: 'Failed to send message' })

      await expect(sendWebEnquiryTexts(BOOKING)).resolves.toBeUndefined()

      expect(sendStaffAlertSms).toHaveBeenCalledTimes(2)
      expect(error).toHaveBeenCalledTimes(2)
      // Staff numbers are masked in the logs.
      expect(JSON.stringify(error.mock.calls)).not.toContain(STAFF_A)
      expect(JSON.stringify(error.mock.calls)).not.toContain(STAFF_B)
    })

    it('never calls Twilio directly', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = STAFF_A
      await sendWebEnquiryTexts(BOOKING)
      expect(sendSMS).not.toHaveBeenCalled()
    })
  })
})
