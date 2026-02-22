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
      cancelledEventTableBookings: 0,
      expiredPendingTablePaymentBookings: 0,
      expiredTablePaymentHolds: 0,
      failedTableDepositPayments: 0,
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
      const expiredBookingIds = (expiredBookings || []).map((row: any) => row.id).filter(Boolean)
      if (expiredBookingIds.length === 0) {
        continue
      }

      const { data: expiredHolds, error: expireHoldsError } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso
        })
        .eq('hold_type', 'payment_hold')
        .eq('status', 'active')
        .in('event_booking_id', expiredBookingIds)
        .select('id')

      if (expireHoldsError) {
        throw expireHoldsError
      }

      result.expiredPaymentHolds += (expiredHolds || []).length

      const { data: cancelledTables, error: cancelTablesError } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancellation_reason: 'event_booking_payment_hold_expired',
          cancelled_at: nowIso,
          updated_at: nowIso,
          hold_expires_at: null
        })
        .in('event_booking_id', expiredBookingIds)
        .neq('status', 'cancelled')
        .select('id')

      if (cancelTablesError) {
        throw cancelTablesError
      }

      result.cancelledEventTableBookings += (cancelledTables || []).length
    }

    const { data: pendingTablePaymentRows, error: pendingTablePaymentError } = await supabase
      .from('table_bookings')
      .select('id, customer_id, booking_type')
      .eq('status', 'pending_payment')
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', nowIso)
      .limit(1000)

    if (pendingTablePaymentError) {
      throw pendingTablePaymentError
    }

    const pendingTablePaymentIds = (pendingTablePaymentRows || []).map((row: any) => row.id)
    const pendingTablePaymentById = new Map<
      string,
      { customer_id: string | null; booking_type: string | null }
    >()
    for (const row of (pendingTablePaymentRows || []) as any[]) {
      if (row?.id) {
        pendingTablePaymentById.set(row.id, {
          customer_id: row.customer_id ?? null,
          booking_type: row.booking_type ?? null,
        })
      }
    }

    for (const ids of chunkIds(pendingTablePaymentIds)) {
      const { data: expiredTablePayments, error: expireTablePaymentsError } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancellation_reason: 'payment_hold_expired',
          cancelled_at: nowIso,
          updated_at: nowIso,
          hold_expires_at: null,
        })
        .in('id', ids)
        .eq('status', 'pending_payment')
        .select('id, customer_id, booking_type')

      if (expireTablePaymentsError) {
        throw expireTablePaymentsError
      }

      result.expiredPendingTablePaymentBookings += (expiredTablePayments || []).length
      const expiredTablePaymentIds = (expiredTablePayments || []).map((row: any) => row.id).filter(Boolean)
      if (expiredTablePaymentIds.length === 0) {
        continue
      }

      for (const row of (expiredTablePayments || []) as any[]) {
        const bookingId = row?.id
        const customerId = row?.customer_id || pendingTablePaymentById.get(bookingId)?.customer_id || null
        const bookingType = row?.booking_type || pendingTablePaymentById.get(bookingId)?.booking_type || null
        if (!bookingId || !customerId) {
          continue
        }

        try {
          await recordAnalyticsEvent(supabase, {
            customerId,
            tableBookingId: bookingId,
            eventType: 'payment_failed',
            metadata: {
              payment_kind: 'table_deposit',
              booking_type: bookingType || 'table',
              reason: 'hold_expired',
            }
          })
        } catch (analyticsError) {
          logger.warn('Failed recording table-deposit expiry analytics event', {
            metadata: {
              bookingId,
              customerId,
              error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError),
            }
          })
        }
      }

      const { data: expiredTablePaymentHolds, error: expireTablePaymentHoldsError } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso,
        })
        .eq('hold_type', 'payment_hold')
        .eq('status', 'active')
        .in('table_booking_id', expiredTablePaymentIds)
        .select('id')

      if (expireTablePaymentHoldsError) {
        throw expireTablePaymentHoldsError
      }

      result.expiredTablePaymentHolds += (expiredTablePaymentHolds || []).length

      const { data: failedPayments, error: failPaymentsError } = await supabase
        .from('payments')
        .update({
          status: 'failed',
          metadata: {
            payment_kind: 'table_deposit',
            reason: 'hold_expired',
            updated_at: nowIso,
          },
        })
        .in('table_booking_id', expiredTablePaymentIds)
        .eq('charge_type', 'table_deposit')
        .eq('status', 'pending')
        .select('id')

      if (failPaymentsError) {
        throw failPaymentsError
      }

      result.failedTableDepositPayments += (failedPayments || []).length
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
    const offerById = new Map<
      string,
      {
        id: string
        customer_id: string | null
        event_id: string | null
        waitlist_entry_id: string | null
      }
    >()
    for (const offer of (expiredOffers || []) as any[]) {
      if (offer?.id) {
        offerById.set(offer.id, {
          id: offer.id,
          customer_id: offer.customer_id ?? null,
          event_id: offer.event_id ?? null,
          waitlist_entry_id: offer.waitlist_entry_id ?? null
        })
      }
    }
    const expiredWaitlistEntryIds: string[] = []

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
      const expiredOfferIds = (data || []).map((row: any) => row.id).filter(Boolean)
      if (expiredOfferIds.length === 0) {
        continue
      }

      for (const row of (data || []) as Array<{ id: string }>) {
        const offer = offerById.get(row.id)
        if (offer?.waitlist_entry_id) {
          expiredWaitlistEntryIds.push(offer.waitlist_entry_id)
        }
        if (offer?.customer_id) {
          try {
            await recordAnalyticsEvent(supabase, {
              customerId: offer.customer_id,
              eventType: 'waitlist_offer_expired',
              metadata: {
                waitlist_offer_id: offer.id,
                event_id: offer.event_id,
                reason: 'offer_expired_timeout'
              }
            })
          } catch (analyticsError) {
            logger.warn('Failed recording waitlist offer expiry analytics event', {
              metadata: {
                waitlistOfferId: offer.id,
                customerId: offer.customer_id,
                error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
              }
            })
          }
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
        .in('waitlist_offer_id', expiredOfferIds)
        .select('id')

      if (expireHoldsError) {
        throw expireHoldsError
      }

      result.expiredWaitlistHolds += (expiredHolds || []).length
    }

    const waitlistEntryIds = [...new Set(expiredWaitlistEntryIds)]
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
      const expiredTableBookingIds = (expiredTableBookings || []).map((row: any) => row.id).filter(Boolean)
      if (expiredTableBookingIds.length === 0) {
        continue
      }

      for (const row of (expiredTableBookings || []) as any[]) {
        const bookingId = row?.id
        const customerId = row?.customer_id || pendingCardCaptureById.get(bookingId)?.customer_id || null
        const bookingType = row?.booking_type || pendingCardCaptureById.get(bookingId)?.booking_type || null

        if (!bookingId || !customerId) {
          continue
        }

        try {
          await recordAnalyticsEvent(supabase, {
            customerId,
            tableBookingId: bookingId,
            eventType: 'card_capture_expired',
            metadata: {
              booking_type: bookingType || 'table',
              reason: 'hold_expired'
            }
          })
        } catch (analyticsError) {
          logger.warn('Failed recording card capture expiry analytics event', {
            metadata: {
              bookingId,
              customerId,
              error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
            }
          })
        }
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
        .in('table_booking_id', expiredTableBookingIds)
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
        .in('table_booking_id', expiredTableBookingIds)
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
        error: 'Failed to process hold expiry'
      },
      { status: 500 }
    )
  }
}
