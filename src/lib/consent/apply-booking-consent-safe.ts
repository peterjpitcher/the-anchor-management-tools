import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { alertMoneyNeedsAPerson, type MoneyAlertDomain } from '@/lib/money-alerts'
import { ConsentService } from '@/services/consent'
import type { CommunicationConsentPayload, ConsentContext } from '@/lib/consent/types'

export type BookingConsentOutcome = 'recorded' | 'failed'

/**
 * Record a guest's contact choices on a booking that has ALREADY been saved (BK-039, customer
 * bookings review of 24 October 2026).
 *
 * The public table, private hire, event, waitlist and parking routes save the booking first and
 * the consent second. The consent call threw on any database error, so a hiccup after the booking
 * was saved told the guest their booking had failed: no confirmation, no deposit link, no manager
 * email, while the booking sat in their name. They booked again or turned up unexpected.
 *
 * The consent is a must-log side effect, not a reason to fail the booking. A failure is logged at
 * error level with the booking id and raised with the manager (once per booking), and the route
 * carries on to the confirmation and the success answer. Never throws.
 *
 * Staff only: the alert names the booking, never the guest.
 */
export async function applyBookingContactConsentSafe(input: {
  customerId: string
  consent: CommunicationConsentPayload | undefined
  context: ConsentContext
  alert: {
    domain: MoneyAlertDomain
    bookingId: string
    /** A page for the manager, when the domain's default is wrong (or null for none). */
    path?: string | null
  }
}): Promise<BookingConsentOutcome> {
  try {
    await ConsentService.applyBookingContactConsent(input.customerId, input.consent, input.context)
    return 'recorded'
  } catch (error) {
    logger.error('Booking saved but the guest contact choices did not record', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        domain: input.alert.domain,
        bookingId: input.alert.bookingId,
        customerId: input.customerId,
        source: input.context.source,
      },
    })

    try {
      await alertMoneyNeedsAPerson(createAdminClient(), {
        domain: input.alert.domain,
        bookingId: input.alert.bookingId,
        kind: 'consent_not_recorded',
        subjectTag: 'BOOKING ACTION NEEDED',
        title: 'A booking was saved but the guest contact choices did not record',
        summary:
          'A guest booked online and the booking went through, but their choices about texts and emails did not save. ' +
          'Open the customer record and check their contact preferences before sending them any marketing. ' +
          'No message has been sent to the guest about this.',
        context: { Source: input.context.source },
        ...(input.alert.path !== undefined ? { path: input.alert.path } : {}),
      })
    } catch (alertError) {
      // alertMoneyNeedsAPerson does not throw, but createAdminClient can on a missing env.
      logger.error('Could not raise the consent alert', {
        error: alertError instanceof Error ? alertError : new Error(String(alertError)),
        metadata: { bookingId: input.alert.bookingId },
      })
    }

    return 'failed'
  }
}
