import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../mocks/emailRenderChecks'

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))

import { sendEmail } from '@/lib/email/emailService'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'

/** BK-188: the manager alert names the room, the hours and the reply choice a website enquiry gave. */
describe('the manager email for a website enquiry', () => {
  beforeEach(() => vi.clearAllMocks())

  const booking = {
    id: 'pb-1',
    customer_first_name: 'Alice',
    customer_last_name: 'Booker',
    contact_phone: '+447700900000',
    event_date: '2026-12-05',
    start_time: '19:00:00',
    end_time: '00:00:00',
    status: 'draft',
    source: 'website',
    guest_count: 30,
    event_type: 'Birthday',
    created_at: '2026-10-28T10:00:00.000Z',
  }

  it('lists them, in words', async () => {
    await sendManagerPrivateBookingCreatedEmail({
      booking,
      createdVia: 'api_private_booking_enquiry',
      enquiry: { roomName: 'Function Room', hireHours: 5, replyPreference: 'email' },
    })
    const { html, text, subject } = vi.mocked(sendEmail).mock.calls[0][0] as { html: string; text: string; subject: string }
    expect(text).toContain('Room asked for: Function Room')
    expect(text).toContain('Hire length: 5 hours (to 12am)')
    expect(text).toContain('Reply by: Email')
    expect(html).toContain('<strong>Room asked for:</strong> Function Room')
    for (const part of [subject, html, text]) assertCleanText(part)
  })

  it('leaves them out when the enquiry gave none', async () => {
    await sendManagerPrivateBookingCreatedEmail({ booking: { ...booking, end_time: null }, enquiry: {} })
    const { text } = vi.mocked(sendEmail).mock.calls[0][0] as { text: string }
    expect(text).not.toMatch(/Room asked for|Hire length|Reply by/)
    assertCleanText(text)
  })
})
