import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The texts a website callback request sends (owner decision, 17 November 2026): one
 * acknowledgement to the customer through sendSMS, noted on the booking timeline, and one alert to
 * each staff mobile in PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS. Nothing here reaches Twilio: sendSMS and
 * the staff alert sender are mocked.
 */

const auditInsert = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn(() => ({ insert: auditInsert })))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

const sendStaffAlertSms = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sms/staff-alert', () => ({ sendStaffAlertSms }))

const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error } }))

import {
  ENQUIRY_ACK_TEMPLATE_KEY,
  ENQUIRY_ALERT_NUMBERS_ENV,
  ENQUIRY_STAFF_ALERT_TEMPLATE_KEY,
  buildEnquiryAckText,
  buildEnquiryStaffAlertText,
  parseEnquiryAlertNumbers,
  sendWebEnquiryTexts,
  type WebEnquiryTextBooking,
} from '@/lib/private-bookings/enquiry-texts'
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
    sendSMS.mockResolvedValue({ success: true, sid: 'SM-test' })
    auditInsert.mockResolvedValue({ error: null })
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
    it('texts one acknowledgement to the customer with the right key and wording', async () => {
      await sendWebEnquiryTexts(BOOKING)

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(sendSMS).toHaveBeenCalledWith(
        '+447700900123',
        "The Anchor: thanks Alex, we've got your request and we'll call you back. Need us sooner? Call 01753 682707.",
        {
          customerId: 'cust-test-1',
          metadata: { template_key: ENQUIRY_ACK_TEMPLATE_KEY, private_booking_id: 'pb-test-1' },
        }
      )
      expect(ENQUIRY_ACK_TEMPLATE_KEY).toBe('private_booking_enquiry_ack')
      // Quiet hours, kill switches and safety guards are never skipped.
      const options = sendSMS.mock.calls[0][2]
      expect(options).not.toHaveProperty('skipQuietHours')
      expect(options).not.toHaveProperty('skipSafetyGuards')
    })

    it('notes the acknowledgement on the booking timeline', async () => {
      await sendWebEnquiryTexts(BOOKING)

      expect(from).toHaveBeenCalledWith('private_booking_audit')
      expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
        booking_id: 'pb-test-1',
        action: 'sms_sent',
        field_name: 'sms',
        new_value: 'private_booking_enquiry_ack',
      }))
    })

    it('notes on the timeline when quiet hours held the text for the morning', async () => {
      sendSMS.mockResolvedValueOnce({ success: true, deferred: true, scheduledFor: '2026-11-18T09:00:00.000Z' })
      await sendWebEnquiryTexts(BOOKING)

      expect(auditInsert.mock.calls[0][0].metadata).toMatchObject({
        delivery_state: 'deferred',
        scheduled_for: '2026-11-18T09:00:00.000Z',
      })
    })

    it('uses the nameless wording when the enquiry had no name', async () => {
      await sendWebEnquiryTexts({ ...BOOKING, firstName: 'Guest', lastName: null })

      expect(sendSMS.mock.calls[0][1]).toBe(
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
      sendSMS.mockRejectedValueOnce(new Error('twilio down'))

      await expect(sendWebEnquiryTexts(BOOKING)).resolves.toBeUndefined()

      expect(sendStaffAlertSms).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(
        'The acknowledgement text for a website callback request failed',
        expect.objectContaining({ metadata: { privateBookingId: 'pb-test-1' } })
      )
      expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'sms_failed' }))
    })

    it('logs an acknowledgement sendSMS refuses, such as under a kill switch', async () => {
      sendSMS.mockResolvedValueOnce({ success: false, error: 'SMS sending is currently suspended', code: 'sms_suspended' })

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

    it('sends the staff alert through the staff path, never as a customer text', async () => {
      process.env[ENQUIRY_ALERT_NUMBERS_ENV] = STAFF_A
      await sendWebEnquiryTexts(BOOKING)
      // sendSMS is called once, for the customer; the staff number goes to sendStaffAlertSms.
      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(sendSMS.mock.calls[0][0]).toBe('+447700900123')
    })

    it('never throws when the timeline note fails', async () => {
      auditInsert.mockResolvedValueOnce({ error: { message: 'db down' } })
      await expect(sendWebEnquiryTexts(BOOKING)).resolves.toBeUndefined()
      expect(error).toHaveBeenCalledWith('Could not note the callback acknowledgement text on the booking', expect.anything())
    })
  })
})
