import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { sendEventPaymentExpiredEmail } from '@/lib/email/event-ticket-emails'
import { findEventBookingsAwaitingPaymentDecision } from '@/lib/events/payment-awaiting-decision'
import { withCronRun } from '@/lib/cron/run-recorder'

// The 15-second project default is too tight for a run that expires a backlog (BK-212).
export const maxDuration = 60

function formatLondonDateTime(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12',
    }).format(new Date(dateStr))
  } catch {
    return 'the scheduled date'
  }
}

function chunkIds(ids: string[], size = 200): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

async function expireEventBookingHolds(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const paymentRaceCutoffIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  try {
    const result = {
      expiredPendingBookings: 0,
      keptAwaitingPaymentDecision: 0,
      keptCheckedIn: 0,
      expiredPaymentHolds: 0,
      cancelledEventTableBookings: 0,
      expiredWaitlistOffers: 0,
      expiredWaitlistEntries: 0,
      expiredWaitlistHolds: 0,
    }

    const { data: pendingRows, error: pendingError } = await supabase
      .from('bookings')
      .select('id, event_id, source')
      .eq('status', 'pending_payment')
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', paymentRaceCutoffIso)
      .limit(1000)

    if (pendingError) {
      throw pendingError
    }

    // BK-032: a guest already checked in at the door is in the room. Their hold is not lapsed,
    // whatever the clock says: staff settle the money at the bar (owner decision D12).
    const candidateIds = (pendingRows || []).map((row: any) => row.id)
    const checkedInIds = new Set<string>()
    for (const ids of chunkIds(candidateIds)) {
      const { data: checkIns, error: checkInsError } = await supabase
        .from('event_check_ins')
        .select('booking_id')
        .in('booking_id', ids)
      if (checkInsError) {
        throw checkInsError
      }
      for (const row of checkIns || []) {
        if ((row as any).booking_id) checkedInIds.add((row as any).booking_id)
      }
    }
    result.keptCheckedIn = checkedInIds.size
    // A walk-in's hold may lapse, but they are never sent a "seats released" message: they were
    // never sent a payment link either (BK-032).
    const walkInIds = new Set((pendingRows || []).filter((row: any) => row.source === 'walk-in').map((row: any) => row.id))

    const lapsedIds = candidateIds.filter((id: string) => !checkedInIds.has(id))
    // A booking whose payment PayPal is still deciding is not "unpaid": leave it, and send the
    // guest no expiry message (BK-019).
    const awaitingDecision = await findEventBookingsAwaitingPaymentDecision(supabase, lapsedIds)
    result.keptAwaitingPaymentDecision = awaitingDecision.size
    const pendingIds = lapsedIds.filter((id: string) => !awaitingDecision.has(id))

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
        .select('id, event_id')

      if (expireBookingsError) {
        throw expireBookingsError
      }

      result.expiredPendingBookings += (expiredBookings || []).length
      const expiredBookingIds = (expiredBookings || []).map((row: any) => row.id).filter(Boolean)
      const expiredEventIds = [
        ...new Set((expiredBookings || []).map((row: any) => row.event_id).filter(Boolean)),
      ]
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

      // Send SMS notifications to customers whose booking holds expired
      for (const expiredBookingId of expiredBookingIds) {
        if (walkInIds.has(expiredBookingId)) continue
        try {
          await sendEventPaymentExpiredEmail(supabase, { bookingId: expiredBookingId })

          const { data: bookingDetail } = await supabase
            .from('bookings')
            .select('id, seats, customer_id, event_id, customers!inner(id, first_name, mobile_number, sms_status), events!inner(id, name, date, time, start_datetime, booking_url)')
            .eq('id', expiredBookingId)
            .maybeSingle()

          // Supabase types infer arrays for joined relations; extract first element
          const customerRaw = bookingDetail?.customers
          const eventRaw = bookingDetail?.events
          const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw
          const event = Array.isArray(eventRaw) ? eventRaw[0] : eventRaw

          if (
            customer?.sms_status === 'active' &&
            customer?.mobile_number
          ) {
            const firstName = getSmartFirstName(customer.first_name)
            const eventDate = formatLondonDateTime(
              event?.start_datetime || event?.date || ''
            )
            const bookingUrl = event?.booking_url || ''
            const eventName = event?.name || 'your event'

            const smsBody = `The Anchor: Hi ${firstName}, your held seats for ${eventName} on ${eventDate} have been released as payment wasn't completed in time.${bookingUrl ? ` If you'd still like to attend, please rebook at ${bookingUrl}.` : ''}`

            await sendSMS(customer.mobile_number, smsBody, {
              customerId: customer.id,
              metadata: {
                template_key: 'event_hold_expired',
                event_id: event?.id,
                event_booking_id: expiredBookingId,
              },
            }).catch((err) => {
              // Non-fatal: log and continue
              console.error('Failed to send hold expiry SMS:', err)
            })
          }
        } catch (smsErr) {
          // Non-fatal: log and continue processing other bookings
          console.error('Failed to load booking detail for hold expiry SMS:', smsErr)
        }
      }

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

      if (expiredEventIds.length > 0) {
        await Promise.allSettled(
          expiredEventIds.map((eventId) =>
            syncPubOpsEventCalendarByEventId(supabase, eventId, {
              context: 'event_booking_hold_expired',
            })
          )
        )
      }
    }

    // Plain table bookings whose deposit hold lapsed are NOT cancelled here (BK-113). This cron
    // used to cancel them silently, ahead of api/cron/table-booking-deposit-timeout, which tells
    // the guest, writes the audit row and checks PayPal first. Only a table booking that belongs to
    // an expired event booking is cancelled above, with that event booking.

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
    for (const offer of (expiredOffers || [])) {
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

// Runs every five minutes, so one run record an hour plus one per failed run (BK-116).
export const GET = withCronRun('event-booking-holds', expireEventBookingHolds, { recording: 'hourly' })
