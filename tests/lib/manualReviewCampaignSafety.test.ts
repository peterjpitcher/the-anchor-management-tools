import { describe, expect, it, vi } from 'vitest'
import {
  buildManualReviewCampaignSmsMetadata,
  assertManualReviewCampaignCompletedWithoutErrors,
  cleanupManualReviewCampaignToken,
  persistManualReviewCampaignSendState
} from '@/lib/manual-review-campaign-safety'

type TableHandlers = {
  bookings?: {
    updateSelectResult?: { data: Array<{ id: string }> | null; error: { message?: string } | null }
  }
  guest_tokens?: {
    updateMaybeSingleResult?: { data: { hashed_token: string } | null; error: { message?: string } | null }
    deleteMaybeSingleResult?: { data: { hashed_token: string } | null; error: { message?: string } | null }
  }
}

function createSupabaseMock(handlers: TableHandlers) {
  const tokenUpdateMaybeSingle = vi.fn().mockResolvedValue(
    handlers.guest_tokens?.updateMaybeSingleResult ?? {
      data: { hashed_token: 'token-1' },
      error: null
    }
  )
  const tokenDeleteMaybeSingle = vi.fn().mockResolvedValue(
    handlers.guest_tokens?.deleteMaybeSingleResult ?? {
      data: { hashed_token: 'token-1' },
      error: null
    }
  )
  const bookingSelect = vi.fn().mockResolvedValue(
    handlers.bookings?.updateSelectResult ?? {
      data: [{ id: 'booking-1' }, { id: 'booking-2' }],
      error: null
    }
  )

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return {
          update: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: bookingSelect
              }))
            }))
          }))
        }
      }

      if (table === 'guest_tokens') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: tokenUpdateMaybeSingle
              }))
            }))
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: tokenDeleteMaybeSingle
              }))
            }))
          }))
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })
  }

  return {
    supabase,
    bookingSelect,
    tokenUpdateMaybeSingle,
    tokenDeleteMaybeSingle
  }
}

describe('manual review campaign safety', () => {
  it('builds stable campaign metadata without volatile dedupe context keys', () => {
    const metadata = buildManualReviewCampaignSmsMetadata({
      templateKey: 'event_review_followup_manual_feb_2026',
      campaignKey: 'manual_feb_4_11_2026_review_campaign',
      source: 'manual_feb_4_11_2026_review_campaign',
      customerId: 'customer-1',
      primaryBookingId: 'booking-1',
      eventIds: ['event-2', 'event-1', 'event-2'],
      reviewRedirectTarget: 'https://vip-club.uk/jls0mu'
    })

    expect(metadata).toMatchObject({
      template_key: 'event_review_followup_manual_feb_2026',
      trigger_type: 'manual_feb_4_11_2026_review_campaign',
      stage: 'manual_feb_4_11_2026_review_campaign:customer-1',
      campaign_customer_id: 'customer-1',
      campaign_primary_booking_id: 'booking-1',
      campaign_event_ids: 'event-1,event-2'
    })
    expect((metadata as Record<string, string>).event_booking_id).toBeUndefined()
    expect((metadata as Record<string, string>).event_id).toBeUndefined()
  })

  it('fails closed when booking persistence affects fewer rows than expected', async () => {
    const { supabase, tokenUpdateMaybeSingle } = createSupabaseMock({
      bookings: {
        updateSelectResult: {
          data: [{ id: 'booking-1' }],
          error: null
        }
      }
    })

    const result = await persistManualReviewCampaignSendState(supabase, {
      bookingIds: ['booking-1', 'booking-2'],
      sentAtIso: '2026-02-14T10:00:00.000Z',
      reviewWindowClosesAtIso: '2026-02-21T10:00:00.000Z',
      hashedToken: 'token-1'
    })

    expect(result.error).toBe('Review SMS booking update affected 1/2 rows')
    expect(tokenUpdateMaybeSingle).not.toHaveBeenCalled()
  })

  it('fails closed when redirect token expiry update affects no rows', async () => {
    const { supabase } = createSupabaseMock({
      guest_tokens: {
        updateMaybeSingleResult: {
          data: null,
          error: null
        }
      }
    })

    const result = await persistManualReviewCampaignSendState(supabase, {
      bookingIds: ['booking-1', 'booking-2'],
      sentAtIso: '2026-02-14T10:00:00.000Z',
      reviewWindowClosesAtIso: '2026-02-21T10:00:00.000Z',
      hashedToken: 'token-1'
    })

    expect(result.error).toBe('Review redirect token expiry update affected no rows')
  })

  it('reports cleanup failure when token delete affects no rows', async () => {
    const { supabase } = createSupabaseMock({
      guest_tokens: {
        deleteMaybeSingleResult: {
          data: null,
          error: null
        }
      }
    })

    const result = await cleanupManualReviewCampaignToken(supabase, 'token-1')
    expect(result.error).toBe('Review redirect token cleanup affected no rows')
  })

  it('throws when campaign run completes with processing errors', () => {
    expect(() =>
      assertManualReviewCampaignCompletedWithoutErrors([
        {
          customerId: 'customer-1',
          bookingIds: ['booking-1'],
          reason: 'SMS send failed'
        }
      ])
    ).toThrow(
      'Manual review campaign completed with 1 error(s): customer-1:SMS send failed'
    )
  })

  it('does not throw when campaign run has no processing errors', () => {
    expect(() => assertManualReviewCampaignCompletedWithoutErrors([])).not.toThrow()
  })
})
