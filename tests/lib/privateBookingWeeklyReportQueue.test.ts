import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), queue: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.send }))
vi.mock('@/lib/manager-report/queue', () => ({ queueManagerReportEmail: mocks.queue }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/guest/tokens', () => ({ createGuestToken: vi.fn() }))

import {
  queueManagerPrivateBookingsWeeklyDigestEmail,
  sendManagerPrivateBookingCreatedEmail,
} from '@/lib/private-bookings/manager-notifications'

describe('private booking manager email policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queue.mockResolvedValue({ success: true, queued: true })
    mocks.send.mockResolvedValue({ success: true, messageId: 'provider-1' })
  })

  const input = {
    runDateKey: '2026-09-11', weekLabel: 'snapshot Fri, 11 Sept 2026',
    appBaseUrl: 'https://management.orangejelly.co.uk', events: [], pendingSmsCount: 0,
    smsQueueUrl: 'https://management.orangejelly.co.uk/private-bookings/sms-queue',
  }

  it('queues even an empty weekly snapshot without sending another email', async () => {
    expect(await queueManagerPrivateBookingsWeeklyDigestEmail(input)).toMatchObject({ queued: true, eventCount: 0 })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      section: 'private_bookings', key: '2026-09-11',
      text: expect.stringContaining('Included in the Friday manager report'),
    }))
    expect(mocks.queue.mock.calls[0][0].text).not.toMatch(/Monday|undefined|Invalid Date|NaN/)
  })

  it('returns queue failure truthfully', async () => {
    mocks.queue.mockResolvedValue({ success: false, error: 'Queue unavailable' })
    expect(await queueManagerPrivateBookingsWeeklyDigestEmail(input)).toMatchObject({ queued: false, error: 'Queue unavailable' })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('still sends a new private enquiry immediately', async () => {
    expect(await sendManagerPrivateBookingCreatedEmail({ booking: {
      id: 'private-1', booking_reference: 'PB-1', customer_name: 'Example Guest',
      event_date: '2026-09-12', start_time: '19:00', guest_count: 20,
    } })).toEqual({ sent: true })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'New private booking enquiry: PB-1' }))
    expect(mocks.queue).not.toHaveBeenCalled()
  })
})
