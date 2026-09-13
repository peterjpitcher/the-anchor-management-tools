import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ queue: vi.fn(), send: vi.fn(), notify: vi.fn() }))
vi.mock('@/lib/manager-report/queue', () => ({ queueManagerReportEmail: mocks.queue }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.send }))
vi.mock('@/lib/notifications/notify', () => ({ notifyCustomer: mocks.notify }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
import { sendManagerTableBookingCreatedEmailIfAllowed } from './bookings'

function client(source = 'website') {
  return { from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
    data: table === 'table_bookings' ? {
      id: 'booking-1', customer_id: 'customer-1', booking_reference: 'TB-1', booking_date: '2026-09-12',
      booking_time: '18:00', start_datetime: '2026-09-12T17:00:00Z', party_size: 4, source,
      booking_type: 'regular', status: 'confirmed',
    } : { id: 'customer-1', first_name: 'Alex', last_name: 'Rowe', email: 'alex@example.com' }, error: null,
  }) }) }) }) } as never
}

describe('manager table booking report source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queue.mockResolvedValue({ success: true, queued: true })
  })
  it('uses the booking ID for creation and deposit-capture deduplication without immediate mail', async () => {
    const db = client()
    for (const createdVia of ['api', 'paypal_capture']) {
      expect(await sendManagerTableBookingCreatedEmailIfAllowed(db, { tableBookingId: 'booking-1', createdVia }))
        .toEqual({ sent: false, queued: true })
    }
    expect(mocks.queue.mock.calls.map(([input]) => input.key)).toEqual(['booking-1', 'booking-1'])
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      section: 'table_bookings', to: 'manager@the-anchor.pub', html: expect.stringContaining('Alex Rowe'),
      metadata: expect.objectContaining({ table_booking_id: 'booking-1' }),
    }))
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('retains the walk-in exclusion', async () => {
    expect(await sendManagerTableBookingCreatedEmailIfAllowed(client('walk-in'), { tableBookingId: 'booking-1' }))
      .toMatchObject({ sent: false, skipped: true, reason: 'walk_in' })
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('reports queue failure truthfully', async () => {
    mocks.queue.mockResolvedValue({ success: false, error: 'queue unavailable' })
    expect(await sendManagerTableBookingCreatedEmailIfAllowed(client(), { tableBookingId: 'booking-1' }))
      .toEqual({ sent: false, error: 'queue unavailable' })
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
