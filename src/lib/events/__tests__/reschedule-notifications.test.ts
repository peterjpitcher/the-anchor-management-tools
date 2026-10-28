import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCleanText } from '../../../../tests/mocks/emailRenderChecks'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventRescheduledEmail: vi.fn(),
  sendEventPostponedEmail: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { sendSMS } from '@/lib/twilio'
import { dispatchEventRescheduleNotifications, resolveRescheduledHoldExpiry } from '../reschedule-notifications'

type UpdateRecord = { table: string; payload: Record<string, unknown> }

function makeDb(bookings: Array<Record<string, unknown>>) {
  const updates: UpdateRecord[] = []

  const db = {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: bookings, error: null }),
        }),
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })),
  }

  return { db, updates }
}

const PENDING_BOOKING = {
  id: 'booking-pending',
  customer_id: 'customer-1',
  seats: 2,
  status: 'pending_payment',
  // A 15-minute website checkout hold, still live at the fixed clock below.
  hold_expires_at: '2026-09-10T12:15:00.000Z',
  customers: {
    id: 'customer-1',
    first_name: 'Pat',
    mobile_number: '+447700900001',
    sms_status: 'active',
  },
}

describe('event reschedule notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createEventManageToken).mockResolvedValue({
      rawToken: 'manage-token',
      url: 'https://management.orangejelly.co.uk/g/manage-token/manage-booking',
      expiresAt: '2026-09-23T18:00:00.000Z',
    })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as Awaited<ReturnType<typeof sendSMS>>)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // BK-140: a live unpaid hold gets 24 hours' grace after a move, not the whole run to the new
  // start, and the booking, its hold row and its linked table booking all get the same value.
  it('gives a live unpaid hold 24 hours of grace instead of holding the seats until the night', async () => {
    const { db, updates } = makeDb([PENDING_BOOKING])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Quiz Night',
      oldDate: '2026-09-16',
      oldTime: '19:00',
      newDate: '2026-09-23',
      newTime: '19:00',
      userId: 'user-1',
    })

    expect(updates).toEqual([
      { table: 'bookings', payload: { hold_expires_at: '2026-09-11T12:00:00.000Z' } },
      { table: 'booking_holds', payload: { expires_at: '2026-09-11T12:00:00.000Z' } },
      { table: 'table_bookings', payload: { hold_expires_at: '2026-09-11T12:00:00.000Z' } },
    ])
  })

  it('leaves a hold that has already lapsed alone', async () => {
    const { db, updates } = makeDb([{ ...PENDING_BOOKING, hold_expires_at: '2026-09-10T11:45:00.000Z' }])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Quiz Night',
      oldDate: '2026-09-16',
      oldTime: '19:00',
      newDate: '2026-09-23',
      newTime: '19:00',
      userId: 'user-1',
    })

    expect(updates).toEqual([])
  })

  it('caps the grace at the London instant of the new start, not the server clock reading', async () => {
    vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'))
    const { db, updates } = makeDb([{ ...PENDING_BOOKING, hold_expires_at: '2026-09-23T09:15:00.000Z' }])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Quiz Night',
      oldDate: '2026-09-16',
      oldTime: '19:00',
      newDate: '2026-09-23',
      newTime: '19:00',
      userId: 'user-1',
    })

    // 7pm on a British Summer Time date is 18:00 UTC. Parsing the wall time directly gave
    // 19:00 UTC on the production server, an hour late.
    expect(updates).toEqual([
      { table: 'bookings', payload: { hold_expires_at: '2026-09-23T18:00:00.000Z' } },
      { table: 'booking_holds', payload: { expires_at: '2026-09-23T18:00:00.000Z' } },
      { table: 'table_bookings', payload: { hold_expires_at: '2026-09-23T18:00:00.000Z' } },
    ])
  })

  it('texts the time the London clock shows on a British Summer Time date', async () => {
    const { db } = makeDb([PENDING_BOOKING])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Quiz Night',
      oldDate: '2026-09-16',
      oldTime: '19:00',
      newDate: '2026-09-23',
      newTime: '19:00',
      userId: 'user-1',
    })

    expect(sendSMS).toHaveBeenCalledTimes(1)
    const body = vi.mocked(sendSMS).mock.calls[0][1]
    assertCleanText(body)
    expect(body).toContain('Wed 23 Sep at 7pm')
    expect(body).not.toContain('8pm')
  })

  it('texts the time the London clock shows on a GMT date', async () => {
    const { db } = makeDb([PENDING_BOOKING])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Tinsel and Tipples Christmas Tasting Night',
      oldDate: '2026-11-20',
      oldTime: '19:00',
      newDate: '2026-11-27',
      newTime: '19:00',
      userId: 'user-1',
    })

    const body = vi.mocked(sendSMS).mock.calls[0][1]
    assertCleanText(body)
    expect(body).toContain('Fri 27 Nov at 7pm')
  })

  it('handles a new start just after midnight', async () => {
    vi.setSystemTime(new Date('2026-10-31T23:00:00.000Z'))
    const { db, updates } = makeDb([{ ...PENDING_BOOKING, hold_expires_at: '2026-10-31T23:15:00.000Z' }])
    vi.mocked(createAdminClient).mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>)

    await dispatchEventRescheduleNotifications({
      eventId: 'event-1',
      eventName: 'Halloween Party',
      oldDate: '2026-10-31',
      oldTime: '20:00',
      newDate: '2026-11-01',
      newTime: '00:15',
      userId: 'user-1',
    })

    const body = vi.mocked(sendSMS).mock.calls[0][1]
    assertCleanText(body)
    expect(body).toContain('Sun 1 Nov at 12:15am')
    // 00:15 on 1 November 2026 is after the clocks went back, so London is on UTC.
    expect(updates[0].payload).toEqual({ hold_expires_at: '2026-11-01T00:15:00.000Z' })
  })

  it('shortens a hold that would outlast a night moved earlier', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    expect(resolveRescheduledHoldExpiry('2026-09-20T12:00:00.000Z', '2026-09-12T18:00:00.000Z', now)).toBe('2026-09-12T18:00:00.000Z')
    expect(resolveRescheduledHoldExpiry('2026-09-11T20:00:00.000Z', '2026-09-30T18:00:00.000Z', now)).toBeNull()
    expect(resolveRescheduledHoldExpiry(null, '2026-09-30T18:00:00.000Z', now)).toBeNull()
  })
})
