import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/events/waitlist-offers', () => ({
  createNextWaitlistOffer: vi.fn(),
  sendWaitlistOfferSms: vi.fn(),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createNextWaitlistOffer, sendWaitlistOfferSms } from '@/lib/events/waitlist-offers'
import { GET } from '@/app/api/cron/event-waitlist-offers/route'

describe('event waitlist offers route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when waitlist candidate load fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive waitlist candidate diagnostics' },
    })
    const order = vi.fn().mockReturnValue({ limit })
    const eqStatus = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq: eqStatus })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'waitlist_entries') {
          return { select }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-waitlist-offers') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to process waitlist offers' })
  })

  it('counts cleanup no-op writes as processing errors after SMS failure', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createNextWaitlistOffer as unknown as vi.Mock).mockResolvedValue({
      state: 'offered',
      waitlist_offer_id: 'offer-1',
      waitlist_entry_id: 'entry-1',
      event_id: 'event-1',
      customer_id: 'customer-1',
    })
    ;(sendWaitlistOfferSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      reason: 'sms_send_failed',
    })

    const queuedLimit = vi.fn().mockResolvedValue({
      data: [{ event_id: 'event-1' }],
      error: null,
    })
    const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit })
    const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder })
    const queuedSelect = vi.fn().mockReturnValue({ eq: queuedEq })

    const offerCleanupMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const offerCleanupSelect = vi.fn().mockReturnValue({ maybeSingle: offerCleanupMaybeSingle })
    const offerCleanupEqStatus = vi.fn().mockReturnValue({ select: offerCleanupSelect })
    const offerCleanupEqId = vi.fn().mockReturnValue({ eq: offerCleanupEqStatus })
    const offerCleanupUpdate = vi.fn().mockReturnValue({ eq: offerCleanupEqId })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'waitlist_entries') {
          return { select: queuedSelect }
        }
        if (table === 'waitlist_offers') {
          return { update: offerCleanupUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-waitlist-offers') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.offersCancelled).toBe(1)
    expect(payload.errors).toBe(1)
  })

  it('fails closed and increments fail-closed counters on post-send persistence failure', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createNextWaitlistOffer as unknown as vi.Mock).mockResolvedValue({
      state: 'offered',
      waitlist_offer_id: 'offer-1',
      waitlist_entry_id: 'entry-1',
      event_id: 'event-1',
      customer_id: 'customer-1',
    })
    ;(sendWaitlistOfferSms as unknown as vi.Mock).mockResolvedValue({
      success: false,
      reason: 'post_send_persistence_failed',
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
    })

    const queuedLimit = vi.fn().mockResolvedValue({
      data: [{ event_id: 'event-1' }],
      error: null,
    })
    const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit })
    const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder })
    const queuedSelect = vi.fn().mockReturnValue({ eq: queuedEq })

    const entryCleanupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'entry-1' },
      error: null,
    })
    const entryCleanupSelect = vi.fn().mockReturnValue({ maybeSingle: entryCleanupMaybeSingle })
    const entryCleanupEqStatus = vi.fn().mockReturnValue({ select: entryCleanupSelect })
    const entryCleanupEqId = vi.fn().mockReturnValue({ eq: entryCleanupEqStatus })
    const entryCleanupUpdate = vi.fn().mockReturnValue({ eq: entryCleanupEqId })

    const offerCleanupMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'offer-1' },
      error: null,
    })
    const offerCleanupSelect = vi.fn().mockReturnValue({ maybeSingle: offerCleanupMaybeSingle })
    const offerCleanupEqStatus = vi.fn().mockReturnValue({ select: offerCleanupSelect })
    const offerCleanupEqId = vi.fn().mockReturnValue({ eq: offerCleanupEqStatus })
    const offerCleanupUpdate = vi.fn().mockReturnValue({ eq: offerCleanupEqId })

    const holdCleanupSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'hold-1' }],
      error: null,
    })
    const holdCleanupEqStatus = vi.fn().mockReturnValue({ select: holdCleanupSelect })
    const holdCleanupEqOffer = vi.fn().mockReturnValue({ eq: holdCleanupEqStatus })
    const holdCleanupUpdate = vi.fn().mockReturnValue({ eq: holdCleanupEqOffer })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'waitlist_entries') {
          return {
            select: queuedSelect,
            update: entryCleanupUpdate,
          }
        }
        if (table === 'waitlist_offers') {
          return { update: offerCleanupUpdate }
        }
        if (table === 'booking_holds') {
          return { update: holdCleanupUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-waitlist-offers') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.offersCancelled).toBe(1)
    expect(payload.offersFailedClosed).toBe(1)
    expect(payload.errors).toBe(0)
  })

  it('aborts remaining sends when sendWaitlistOfferSms reports logging_failed', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })
    ;(createNextWaitlistOffer as unknown as vi.Mock).mockResolvedValue({
      state: 'offered',
      waitlist_offer_id: 'offer-1',
      waitlist_entry_id: 'entry-1',
      event_id: 'event-1',
      customer_id: 'customer-1',
    })
    ;(sendWaitlistOfferSms as unknown as vi.Mock).mockResolvedValue({
      success: true,
      code: 'logging_failed',
      logFailure: true,
      scheduledSendAt: '2026-02-14T12:00:00.000Z',
    })

    const queuedLimit = vi.fn().mockResolvedValue({
      data: [{ event_id: 'event-1' }, { event_id: 'event-2' }],
      error: null,
    })
    const queuedOrder = vi.fn().mockReturnValue({ limit: queuedLimit })
    const queuedEq = vi.fn().mockReturnValue({ order: queuedOrder })
    const queuedSelect = vi.fn().mockReturnValue({ eq: queuedEq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'waitlist_entries') {
          return { select: queuedSelect }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-waitlist-offers') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.eventsChecked).toBe(2)
    expect(payload.offersCreated).toBe(1)
    expect(payload.offersSent).toBe(1)
    expect(payload.safetyAborts).toBe(1)
    expect(payload.aborted).toBe(true)
    expect(payload.abortReason).toBe('logging_failed')
    expect(payload.abortEventId).toBe('event-1')
    expect(payload.abortOfferId).toBe('offer-1')

    expect(createNextWaitlistOffer).toHaveBeenCalledTimes(1)
    expect(sendWaitlistOfferSms).toHaveBeenCalledTimes(1)
  })
})
