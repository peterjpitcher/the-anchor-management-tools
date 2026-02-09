import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

function chunkIds(ids: string[], size = 200): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  try {
    const result = {
      expiredPendingBookings: 0,
      expiredPaymentHolds: 0,
      expiredWaitlistOffers: 0,
      expiredWaitlistEntries: 0,
      expiredWaitlistHolds: 0,
      expiredPendingCardCaptureBookings: 0,
      expiredCardCaptureHolds: 0,
      expiredCardCaptures: 0
    }

    const { data: pendingRows, error: pendingError } = await supabase
      .from('bookings')
      .select('id')
      .eq('status', 'pending_payment')
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', nowIso)
      .limit(1000)

    if (pendingError) {
      throw pendingError
    }

    const pendingIds = (pendingRows || []).map((row: any) => row.id)

    for (const ids of chunkIds(pendingIds)) {
      const { data: expiredBookings, error: expireBookingsError } = await supabase
        .from('bookings')
        .update({
          status: 'expired',
          expired_at: nowIso,
          updated_at: nowIso
        })
        .in('id', ids)
        .eq('status', 'pending_payment')
        .select('id')

      if (expireBookingsError) {
        throw expireBookingsError
      }

      result.expiredPendingBookings += (expiredBookings || []).length

      const { data: expiredHolds, error: expireHoldsError } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('hold_type', 'payment_hold')
        .eq('status', 'active')
        .in('event_booking_id', ids)
        .select('id')

      if (expireHoldsError) {
        throw expireHoldsError
      }

      result.expiredPaymentHolds += (expiredHolds || []).length
    }

    const { data: expiredOffers, error: expiredOffersError } = await supabase
      .from('waitlist_offers')
      .select('id, waitlist_entry_id, customer_id, event_id')
      .in('status', ['sent'])
      .lte('expires_at', nowIso)
      .limit(1000)

    if (expiredOffersError) {
      throw expiredOffersError
    }

    const offerIds = (expiredOffers || []).map((row: any) => row.id)
    const offerById = new Map<string, { id: string; customer_id: string | null; event_id: string | null }>()
    for (const offer of (expiredOffers || []) as any[]) {
      if (offer?.id) {
        offerById.set(offer.id, {
          id: offer.id,
          customer_id: offer.customer_id ?? null,
          event_id: offer.event_id ?? null
        })
      }
    }
    const waitlistEntryIds = (expiredOffers || [])
      .map((row: any) => row.waitlist_entry_id)
      .filter(Boolean)

    for (const ids of chunkIds(offerIds)) {
      const { data, error } = await supabase
        .from('waitlist_offers')
        .update({
          status: 'expired',
          expired_at: nowIso
        })
        .in('id', ids)
        .eq('status', 'sent')
        .select('id')

      if (error) {
        throw error
      }

      result.expiredWaitlistOffers += (data || []).length

      for (const row of (data || []) as Array<{ id: string }>) {
        const offer = offerById.get(row.id)
        if (offer?.customer_id) {
          await recordAnalyticsEvent(supabase, {
            customerId: offer.customer_id,
            eventType: 'waitlist_offer_expired',
            metadata: {
              waitlist_offer_id: offer.id,
              event_id: offer.event_id,
              reason: 'offer_expired_timeout'
            }
          })
        }
      }

      const { data: expiredHolds, error: expireHoldsError } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('hold_type', 'waitlist_hold')
        .eq('status', 'active')
        .in('waitlist_offer_id', ids)
        .select('id')

      if (expireHoldsError) {
        throw expireHoldsError
      }

      result.expiredWaitlistHolds += (expiredHolds || []).length
    }

    for (const ids of chunkIds(waitlistEntryIds)) {
      const { data, error } = await supabase
        .from('waitlist_entries')
        .update({
          status: 'expired',
          expired_at: nowIso,
          updated_at: nowIso
        })
        .in('id', ids)
        .eq('status', 'offered')
        .select('id')

      if (error) {
        throw error
      }

      result.expiredWaitlistEntries += (data || []).length
    }

    const { data: pendingCardCaptureRows, error: pendingCardCaptureError } = await supabase
      .from('table_bookings')
      .select('id, customer_id, booking_type')
      .eq('status', 'pending_card_capture')
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', nowIso)
      .limit(1000)

    if (pendingCardCaptureError) {
      throw pendingCardCaptureError
    }

    const pendingCardCaptureIds = (pendingCardCaptureRows || []).map((row: any) => row.id)
    const pendingCardCaptureById = new Map<
      string,
      { customer_id: string | null; booking_type: string | null }
    >()
    for (const row of (pendingCardCaptureRows || []) as any[]) {
      if (row?.id) {
        pendingCardCaptureById.set(row.id, {
          customer_id: row.customer_id ?? null,
          booking_type: row.booking_type ?? null
        })
      }
    }

    for (const ids of chunkIds(pendingCardCaptureIds)) {
      const { data: expiredTableBookings, error: expireTableBookingsError } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancellation_reason: 'card_capture_expired',
          cancelled_at: nowIso,
          updated_at: nowIso
        })
        .in('id', ids)
        .eq('status', 'pending_card_capture')
        .select('id, customer_id, booking_type')

      if (expireTableBookingsError) {
        throw expireTableBookingsError
      }

      result.expiredPendingCardCaptureBookings += (expiredTableBookings || []).length

      for (const row of (expiredTableBookings || []) as any[]) {
        const bookingId = row?.id
        const customerId = row?.customer_id || pendingCardCaptureById.get(bookingId)?.customer_id || null
        const bookingType = row?.booking_type || pendingCardCaptureById.get(bookingId)?.booking_type || null

        if (!bookingId || !customerId) {
          continue
        }

        await recordAnalyticsEvent(supabase, {
          customerId,
          tableBookingId: bookingId,
          eventType: 'card_capture_expired',
          metadata: {
            booking_type: bookingType || 'table',
            reason: 'hold_expired'
          }
        })
      }

      const { data: expiredCardCaptureHolds, error: expireCardCaptureHoldsError } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('hold_type', 'card_capture_hold')
        .eq('status', 'active')
        .in('table_booking_id', ids)
        .select('id')

      if (expireCardCaptureHoldsError) {
        throw expireCardCaptureHoldsError
      }

      result.expiredCardCaptureHolds += (expiredCardCaptureHolds || []).length

      const { data: expiredCardCaptures, error: expireCardCapturesError } = await supabase
        .from('card_captures')
        .update({
          status: 'expired',
          updated_at: nowIso
        })
        .eq('status', 'pending')
        .in('table_booking_id', ids)
        .select('id')

      if (expireCardCapturesError) {
        throw expireCardCapturesError
      }

      result.expiredCardCaptures += (expiredCardCaptures || []).length
    }

    return NextResponse.json({
      success: true,
      ...result,
      processedAt: nowIso
    })
  } catch (error) {
    logger.error('Failed to process event booking hold expiry job', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process hold expiry'
      },
      { status: 500 }
    )
  }
}
