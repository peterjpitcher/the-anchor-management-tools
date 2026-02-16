import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { createNextWaitlistOffer, sendWaitlistOfferSms } from '@/lib/events/waitlist-offers'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    const result = {
      eventsChecked: 0,
      offersCreated: 0,
      offersSent: 0,
      offersCancelled: 0,
      offersFailedClosed: 0,
      safetyAborts: 0,
      skipped: 0,
      errors: 0,
      aborted: false,
      abortReason: null as string | null,
      abortEventId: null as string | null,
      abortOfferId: null as string | null,
    }

    const { data: queuedRows, error: queuedError } = await supabase
      .from('waitlist_entries')
      .select('event_id')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(500)

    if (queuedError) {
      throw queuedError
    }

    const uniqueEventIds = [...new Set((queuedRows || []).map((row: any) => row.event_id).filter(Boolean))]
    result.eventsChecked = uniqueEventIds.length

    for (const eventId of uniqueEventIds) {
      try {
        const offerResult = await createNextWaitlistOffer(supabase, eventId)

        if (offerResult.state !== 'offered') {
          result.skipped += 1
          continue
        }

        result.offersCreated += 1

        const smsResult = await sendWaitlistOfferSms(supabase, offerResult, appBaseUrl)

        if (smsResult.success) {
          result.offersSent += 1

          if (smsResult.logFailure === true || smsResult.code === 'logging_failed') {
            result.safetyAborts += 1
            result.aborted = true
            result.abortReason = smsResult.code || 'sms_safety_abort'
            result.abortEventId = eventId
            result.abortOfferId = offerResult.waitlist_offer_id || null

            logger.error('Aborting waitlist offer cron due to fatal SMS safety signal', {
              error: new Error(result.abortReason),
              metadata: {
                eventId,
                offerId: offerResult.waitlist_offer_id || null,
                code: smsResult.code || null,
                logFailure: smsResult.logFailure === true
              }
            })

            break
          }

          continue
        }

        result.offersCancelled += 1

        if (!offerResult.waitlist_offer_id || !offerResult.waitlist_entry_id) {
          throw new Error('Offered waitlist payload missing required IDs for cleanup')
        }

        const nowIso = new Date().toISOString()
        const shouldExpireOffer = smsResult.reason === 'offer_window_unavailable'
        if (!shouldExpireOffer) {
          // Fail closed to avoid repeated SMS attempts on ambiguous or persistent delivery failures.
          result.offersFailedClosed += 1
        }

        const { data: cleanedOffer, error: offerCleanupError } = await supabase
          .from('waitlist_offers')
          .update({
            status: shouldExpireOffer ? 'expired' : 'cancelled',
            expired_at: nowIso
          })
          .eq('id', offerResult.waitlist_offer_id)
          .eq('status', 'sent')
          .select('id')
          .maybeSingle()

        if (offerCleanupError) {
          throw offerCleanupError
        }
        if (!cleanedOffer) {
          throw new Error(`Waitlist offer cleanup affected no rows: ${offerResult.waitlist_offer_id}`)
        }

        const { data: cleanedHolds, error: holdCleanupError } = await supabase
          .from('booking_holds')
          .update({
            status: shouldExpireOffer ? 'expired' : 'released',
            released_at: nowIso,
            updated_at: nowIso
          })
          .eq('waitlist_offer_id', offerResult.waitlist_offer_id)
          .eq('status', 'active')
          .select('id')

        if (holdCleanupError) {
          throw holdCleanupError
        }
        if (!cleanedHolds || cleanedHolds.length === 0) {
          throw new Error(`Waitlist hold cleanup affected no rows: ${offerResult.waitlist_offer_id}`)
        }

        const { data: cleanedWaitlistEntry, error: waitlistEntryCleanupError } = await supabase
          .from('waitlist_entries')
          .update({
            status: shouldExpireOffer ? 'expired' : 'cancelled',
            expired_at: shouldExpireOffer ? nowIso : null,
            cancelled_at: shouldExpireOffer ? null : nowIso,
            updated_at: nowIso
          })
          .eq('id', offerResult.waitlist_entry_id)
          .eq('status', 'offered')
          .select('id')
          .maybeSingle()

        if (waitlistEntryCleanupError) {
          throw waitlistEntryCleanupError
        }
        if (!cleanedWaitlistEntry) {
          throw new Error(`Waitlist entry cleanup affected no rows: ${offerResult.waitlist_entry_id}`)
        }

        if (shouldExpireOffer && offerResult.customer_id) {
          try {
            await recordAnalyticsEvent(supabase, {
              customerId: offerResult.customer_id,
              eventType: 'waitlist_offer_expired',
              metadata: {
                waitlist_offer_id: offerResult.waitlist_offer_id,
                event_id: offerResult.event_id,
                reason: 'offer_window_unavailable'
              }
            })
          } catch (analyticsError) {
            logger.warn('Failed recording waitlist offer expiration analytics', {
              metadata: {
                offerId: offerResult.waitlist_offer_id,
                customerId: offerResult.customer_id,
                error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
              }
            })
          }
        }
      } catch (eventError) {
        result.errors += 1
        logger.error('Failed processing waitlist offer for event', {
          error: eventError instanceof Error ? eventError : new Error(String(eventError)),
          metadata: { eventId }
        })
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Failed to process waitlist offer cron', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process waitlist offers'
      },
      { status: 500 }
    )
  }
}
