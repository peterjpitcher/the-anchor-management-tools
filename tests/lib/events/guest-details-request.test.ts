import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Details to follow" (BK-011, owner decision D5): the booker is sent their link to add guest
 * details, email first and a text only when no email goes (D14), behind a flag that ships off.
 */
const mocks = vi.hoisted(() => ({
  flagOn: false,
  email: vi.fn(),
  sms: vi.fn(),
  booking: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => mocks.flagOn) }))
vi.mock('@/lib/email/event-ticket-emails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/event-ticket-emails')>()),
  sendEventGuestDetailsRequestEmail: mocks.email,
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: mocks.sms }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn(async () => ({ url: 'https://l.example/new-link' })) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { buildGuestDetailsRequestSms, requestMissingGuestDetails } from '@/lib/events/guest-details-request'
import { buildEventGuestDetailsRequestLines } from '@/lib/email/event-ticket-emails'
import { isMessagingFlagOn } from '@/lib/messaging/flags'

const QUESTION = { id: '33333333-3333-4333-8333-333333333333', label: 'Any allergies?', type: 'text', required: true }
function db() {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = async () => ({ data: mocks.booking, error: null })
  return { from: () => builder } as never
}
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1', seats: 2, status: 'confirmed', source: 'admin', attendees: [],
    customer: { id: 'customer-1', first_name: 'Pat', mobile_number: '+447700900123', sms_status: 'active' },
    event: { name: 'Tasting Night', start_datetime: '2026-11-20T19:00:00Z', booking_questions: [QUESTION], collect_guest_details: null, payment_mode: 'prepaid' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.flagOn = false
  mocks.booking = booking()
  mocks.email.mockResolvedValue({ success: true })
  mocks.sms.mockResolvedValue({ success: true })
})

describe('requestMissingGuestDetails', () => {
  it('sends nothing while event_guest_details_request is off', async () => {
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('flag_off')
    expect(isMessagingFlagOn).toHaveBeenCalledWith('event_guest_details_request')
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })

  it('emails the booker when details are missing on an event that needs them', async () => {
    mocks.flagOn = true
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('sent_email')
    expect(mocks.sms).not.toHaveBeenCalled()
  })

  it('texts only when there is no usable email', async () => {
    mocks.flagOn = true
    mocks.email.mockResolvedValue({ success: false, skipped: true })
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('sent_sms')
    expect(mocks.sms).toHaveBeenCalledWith('+447700900123', expect.stringContaining('https://l.example/m'), expect.objectContaining({
      metadata: expect.objectContaining({ event_booking_id: 'booking-1', template_key: 'event_guest_details_request' }),
    }))
  })

  it('does not text after an email that failed, because it may have arrived', async () => {
    mocks.flagOn = true
    mocks.email.mockResolvedValue({ success: false, error: 'timeout' })
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('failed')
    expect(mocks.sms).not.toHaveBeenCalled()
  })

  it('asks a waitlist booker, recorded with the website as source, and makes them a link (BK-011)', async () => {
    mocks.flagOn = true
    mocks.booking = booking({ source: 'brand_site' })
    mocks.email.mockResolvedValue({ success: false, skipped: true })
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: null, waitlistAcceptance: true })).toBe('sent_sms')
    expect(mocks.sms.mock.calls[0][1]).toContain('https://l.example/new-link')
  })

  it('never asks a website booker outside the waitlist', async () => {
    mocks.flagOn = true
    mocks.booking = booking({ source: 'brand_site' })
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('not_needed')
  })

  it.each([
    ['every ticket is complete', { attendees: [
      { id: 'a', name: 'Sam', answers: [{ question_id: QUESTION.id, value: 'None', required: true }] },
      { id: 'b', name: 'Jo', answers: [{ question_id: QUESTION.id, value: 'Nuts', required: true }] },
    ] }],
    ['the event does not need guest details', { event: { ...booking().event, payment_mode: 'cash_only' } }],
    ['the booking is a walk-in, already in the room', { source: 'walk-in' }],
    ['the booking was cancelled', { status: 'cancelled' }],
  ])('sends nothing when %s', async (_label, overrides) => {
    mocks.flagOn = true
    mocks.booking = booking(overrides)
    expect(await requestMissingGuestDetails(db(), { bookingId: 'booking-1', manageUrl: 'https://l.example/m' })).toBe('not_needed')
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })
})

describe('guest details request wording, rendered with fixture data', () => {
  const rendered = [
    ...buildEventGuestDetailsRequestLines({ firstName: 'Pat', eventName: 'Tasting Night', when: ' on Friday 20 November 2026 at 7pm', seats: 2 }),
    ...buildEventGuestDetailsRequestLines({ firstName: 'Pat', eventName: 'Tasting Night', when: '', seats: 1 }),
    buildGuestDetailsRequestSms({ firstName: 'Pat', eventName: 'Tasting Night', eventDate: 'Friday 20 November', link: 'https://l.example/m' }),
    buildGuestDetailsRequestSms({ firstName: 'Pat', eventName: 'Tasting Night', eventDate: null, link: 'https://l.example/m' }),
  ]
  it('never prints undefined, NaN or Invalid Date', () => {
    for (const line of rendered) {
      expect(line).not.toMatch(/undefined|NaN|Invalid Date|null/)
    }
  })
  it('says what to do and that the details are for this booking only', () => {
    expect(rendered[1]).toBe("Tell us who's coming to Tasting Night on Friday 20 November 2026 at 7pm, so we can look after everyone on the night.")
    expect(rendered[2]).toContain('Mobile numbers are optional')
    expect(rendered[3]).toContain('only use these details for this booking')
    expect(rendered[8]).toBe("The Anchor: Hi Pat, tell us who's coming to Tasting Night on Friday 20 November so we can look after everyone. Add their details here: https://l.example/m")
  })
})
