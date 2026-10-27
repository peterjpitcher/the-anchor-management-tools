import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn().mockResolvedValue({
    state: 'updated',
    eventId: 'event-1',
    googleEventId: 'google-event-id',
  }),
}))

vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventPaymentExpiredEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(async () => ({ success: true })) }))

import { sendEventPaymentExpiredEmail } from '@/lib/email/event-ticket-emails'
import { sendSMS } from '@/lib/twilio'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { GET } from '@/app/api/cron/event-booking-holds/route'

describe('event booking holds route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when pending booking load fails', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })

    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive pending bookings diagnostics' },
    })
    const lte = vi.fn().mockReturnValue({ limit })
    const not = vi.fn().mockReturnValue({ lte })
    const eq = vi.fn().mockReturnValue({ not })
    const select = vi.fn().mockReturnValue({ eq })

    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to process hold expiry' })
  })

  it('syncs Pub Ops calendar entries for events with expired booking holds', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })

    const responses = [
      { data: [{ id: 'booking-1', event_id: 'event-1' }], error: null },
      // Nobody on the booking has checked in at the door (BK-032).
      { data: [], error: null },
      // No payment PayPal is still deciding (BK-019) and no paid booking or open payment
      // exception (BK-018), so the lapsed hold is expired.
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 'booking-1', event_id: 'event-1' }], error: null },
      { data: [{ id: 'hold-1' }], error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]

    const supabase = {
      from: vi.fn(() => {
        const builder: Record<string, Mock> & {
          then?: Promise<{ data: unknown; error: unknown }>['then']
        } = {} as any
        const resolveNext = () => Promise.resolve(responses.shift() ?? { data: [], error: null })

        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'update', 'in', 'neq']) {
          builder[method] = vi.fn(() => builder)
        }
        builder.maybeSingle = vi.fn(resolveNext)
        builder.then = (resolve, reject) => resolveNext().then(resolve, reject)
        return builder
      }),
    }

    ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      expiredPendingBookings: 1,
      expiredPaymentHolds: 1,
    })
    expect(syncPubOpsEventCalendarByEventId).toHaveBeenCalledWith(
      supabase,
      'event-1',
      { context: 'event_booking_hold_expired' },
    )
  })

  // BK-032, owner decision D12: a guest checked in at the door is in the room, so their unpaid
  // hold is left for staff to settle at the bar; a walk-in is never sent a "seats released"
  // message.
  it('keeps a hold whose guest has checked in, and never messages a lapsed walk-in', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })
    const updates: Array<{ table: string; ids: unknown }> = []
    const supabase = {
      from: vi.fn((table: string) => {
        const builder: Record<string, Mock> & { then?: Promise<{ data: unknown; error: unknown }>['then'] } = {} as any
        let updating = false
        let inIds: unknown = null
        const result = () => {
          if (table === 'bookings' && !updating) {
            return { data: [
              { id: 'checked-in', event_id: 'event-1', source: 'admin' },
              { id: 'walk-in', event_id: 'event-1', source: 'walk-in' },
            ], error: null }
          }
          if (table === 'event_check_ins') return { data: [{ booking_id: 'checked-in' }], error: null }
          if (table === 'bookings' && updating) {
            updates.push({ table, ids: inIds })
            return { data: (inIds as string[]).map((id) => ({ id, event_id: 'event-1' })), error: null }
          }
          return { data: [], error: null }
        }
        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'neq']) builder[method] = vi.fn(() => builder)
        builder.update = vi.fn(() => { updating = true; return builder })
        builder.in = vi.fn((_column: string, ids: unknown) => { inIds = ids; return builder })
        builder.maybeSingle = vi.fn(() => Promise.resolve(result()))
        builder.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
        return builder
      }),
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.keptCheckedIn).toBe(1)
    expect(updates[0]?.ids).toEqual(['walk-in'])
    expect(sendEventPaymentExpiredEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  // BK-113: this cron used to cancel every lapsed plain table deposit hold too, silently: no
  // message to the guest, no audit row, nobody named as cancelling it, five minutes ahead of the
  // table cron built to do it properly. Plain table bookings are now left to that cron.
  it('never reads or touches a plain table booking', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })
    const tables: string[] = []
    const supabase = {
      from: vi.fn((table: string) => {
        tables.push(table)
        const builder: Record<string, Mock> & { then?: Promise<{ data: unknown; error: unknown }>['then'] } = {} as any
        const resolveNext = () => Promise.resolve(
          table === 'table_bookings'
            // What the old block found: a plain table booking whose deposit hold had lapsed.
            ? { data: [{ id: 'table-1', customer_id: 'customer-1', booking_type: 'regular' }], error: null }
            : { data: [], error: null },
        )
        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'in', 'neq', 'update']) builder[method] = vi.fn(() => builder)
        builder.maybeSingle = vi.fn(resolveNext)
        builder.then = (resolve, reject) => resolveNext().then(resolve, reject)
        return builder
      }),
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)

    expect(response.status).toBe(200)
    expect(tables).not.toContain('table_bookings')
  })

  // BK-019: a booking whose payment PayPal is still holding for review is not "unpaid". The job
  // used to expire it and text the guest that payment was not completed.
  it('leaves a booking alone while PayPal holds its payment, and sends no expiry message', async () => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })
    const tables: string[] = []
    const updates: Array<{ table: string; payload: unknown }> = []
    const responses: Record<string, Array<{ data: unknown; error: unknown }>> = {
      bookings: [{ data: [{ id: 'booking-1', event_id: 'event-1' }], error: null }],
      payments: [{ data: [{ event_booking_id: 'booking-1', status: 'pending', paypal_capture_id: 'CAPTURE-1', metadata: { capture_status: 'PENDING' } }], error: null }],
    }

    const supabase = {
      from: vi.fn((table: string) => {
        tables.push(table)
        const builder: Record<string, Mock> & { then?: Promise<{ data: unknown; error: unknown }>['then'] } = {} as any
        const resolveNext = () => Promise.resolve(responses[table]?.shift() ?? { data: [], error: null })
        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'in', 'neq']) builder[method] = vi.fn(() => builder)
        builder.update = vi.fn((payload: unknown) => { updates.push({ table, payload }); return builder })
        builder.maybeSingle = vi.fn(resolveNext)
        builder.then = (resolve, reject) => resolveNext().then(resolve, reject)
        return builder
      }),
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, expiredPendingBookings: 0, keptAwaitingPaymentDecision: 1 })
    expect(updates.filter((update) => update.table === 'bookings')).toEqual([])
    expect(syncPubOpsEventCalendarByEventId).not.toHaveBeenCalled()
  })

  // BK-018: a guest whose money was taken but whose booking went to manual review used to be
  // texted, ten minutes after the old hold, that their seats were released because payment was
  // not completed, and the seats were resold.
  it.each([
    ['a payment that succeeded', { payments: [{ event_booking_id: 'booking-1', status: 'succeeded', paypal_capture_id: 'CAPTURE-1', metadata: {} }], event_payment_exceptions: [] }],
    ['an open payment exception', { payments: [], event_payment_exceptions: [{ event_booking_id: 'booking-1' }] }],
  ])('leaves a booking alone when it has %s', async (_label, rows) => {
    ;(authorizeCronRequest as unknown as Mock).mockReturnValue({ authorized: true })
    const updates: string[] = []
    const responses: Record<string, Array<{ data: unknown; error: unknown }>> = {
      bookings: [{ data: [{ id: 'booking-1', event_id: 'event-1' }], error: null }],
      payments: [{ data: rows.payments, error: null }],
      event_payment_exceptions: [{ data: rows.event_payment_exceptions, error: null }],
    }
    const supabase = {
      from: vi.fn((table: string) => {
        const builder: Record<string, Mock> & { then?: Promise<{ data: unknown; error: unknown }>['then'] } = {} as any
        const resolveNext = () => Promise.resolve(responses[table]?.shift() ?? { data: [], error: null })
        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'in', 'neq']) builder[method] = vi.fn(() => builder)
        builder.update = vi.fn(() => { updates.push(table); return builder })
        builder.maybeSingle = vi.fn(resolveNext)
        builder.then = (resolve, reject) => resolveNext().then(resolve, reject)
        return builder
      }),
    }
    ;(createAdminClient as unknown as Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(payload).toMatchObject({ success: true, expiredPendingBookings: 0, keptAwaitingPaymentDecision: 1 })
    expect(updates).not.toContain('bookings')
  })
})

