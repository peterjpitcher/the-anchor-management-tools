import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * The hold job and the one-tap rebook link (event checkout spec, Piece 4.2): each lapsed hold's
 * plan is made before its message, a website hold's email carries the link, and a booking whose
 * recovery message is already claimed, or whose guest has booked again, gets no message at all.
 */

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: vi.fn().mockResolvedValue({ state: 'updated' }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventPaymentExpiredEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/events/event-guest-notify', () => ({
  sendEventMessageEmailFirst: vi.fn(async (input: { email: () => Promise<unknown> }) => {
    await input.email()
    return { status: 'sent' }
  }),
}))
vi.mock('@/lib/events/rebook-link', () => ({ prepareHoldReleasedRebookLink: vi.fn() }))
vi.mock('@/lib/cron/run-recorder', () => ({
  withCronRun: (_name: string, handler: (request: unknown) => unknown) => handler,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEventPaymentExpiredEmail } from '@/lib/email/event-ticket-emails'
import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { prepareHoldReleasedRebookLink } from '@/lib/events/rebook-link'
import { GET } from '@/app/api/cron/event-booking-holds/route'

const PENDING = [
  { id: 'site-new', event_id: 'event-1', source: 'brand_site' },
  { id: 'site-claimed', event_id: 'event-1', source: 'brand_site' },
  { id: 'phone', event_id: 'event-1', source: 'admin' },
]

function fakeSupabase() {
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, Mock> & { then?: Promise<{ data: unknown; error: unknown }>['then'] } = {} as any
      let updating = false
      let inIds: string[] = []
      const result = () => {
        if (table === 'bookings' && !updating) return { data: PENDING, error: null }
        if (table === 'bookings' && updating) return { data: inIds.map((id) => ({ id, event_id: 'event-1' })), error: null }
        return { data: [], error: null }
      }
      for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'neq']) builder[method] = vi.fn(() => builder)
      builder.update = vi.fn(() => { updating = true; return builder })
      builder.in = vi.fn((_column: string, ids: string[]) => { inIds = ids; return builder })
      builder.maybeSingle = vi.fn(() => Promise.resolve(result()))
      builder.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
      return builder
    }),
  }
}

const LINK = 'https://www.the-anchor.pub/events/quiz-night?rebook=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde#event-booking'

beforeEach(() => {
  vi.clearAllMocks()
  ;(createAdminClient as unknown as Mock).mockReturnValue(fakeSupabase())
  ;(prepareHoldReleasedRebookLink as unknown as Mock).mockImplementation(async (_db: unknown, input: { bookingId: string; source: string | null }) => {
    if (input.bookingId === 'site-new') return { send: true, rebookUrl: LINK, outcome: 'issued' }
    if (input.bookingId === 'site-claimed') return { send: false, outcome: 'already_claimed' }
    return { send: true, rebookUrl: null, outcome: 'not_website' }
  })
})

describe('event booking holds: the rebook link', () => {
  it('passes each booking source to the plan, sends the link, and skips a claimed booking', async () => {
    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, expiredPendingBookings: 3, rebookLinksIssued: 1, releasedMessagesSkipped: 1 })

    const plans = (prepareHoldReleasedRebookLink as unknown as Mock).mock.calls.map((call) => call[1])
    expect(plans).toEqual([
      { bookingId: 'site-new', source: 'brand_site' },
      { bookingId: 'site-claimed', source: 'brand_site' },
      { bookingId: 'phone', source: 'admin' },
    ])

    // One message each for the two that may send; none for the claimed booking.
    expect(sendEventMessageEmailFirst).toHaveBeenCalledTimes(2)
    expect((sendEventMessageEmailFirst as unknown as Mock).mock.calls.map((call) => call[0].bookingId)).toEqual(['site-new', 'phone'])
    expect(sendEventPaymentExpiredEmail).toHaveBeenCalledWith(expect.anything(), { bookingId: 'site-new', rebookLinkUrl: LINK })
    expect(sendEventPaymentExpiredEmail).toHaveBeenCalledWith(expect.anything(), { bookingId: 'phone', rebookLinkUrl: null })
  })
})
