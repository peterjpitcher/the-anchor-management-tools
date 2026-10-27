import { ConsentService } from '@/services/consent'
import { logger } from '@/lib/logger'
import { STAFF_MARKETING_READ_OUT_KEY } from '@/lib/consent/constants'
import type { ConsentSource } from '@/lib/consent/types'

type StaffConsentSource = Extract<ConsentSource, 'staff_table_booking' | 'staff_event_booking' | 'staff_private_booking'>
type StaffConsentEntity = 'table_booking' | 'event_booking' | 'private_booking'

/**
 * Records a guest's yes to marketing texts, given to a member of staff who read them the notice
 * (owner decision D32, BK-079). Staff booking paths recorded no consent at all, so guests they
 * booked were texted the regulars promotions with nothing to show for it; those promotions now
 * need a recorded basis (get_cross_promo_audience), and for a staff-booked guest that is this yes.
 *
 * Nothing is recorded when staff did not tick it: no answer is not a yes. Someone who had opted
 * out is never switched back on (ConsentService refuses it). Never throws: the booking stands, and
 * a failure is logged with logger.error so it reaches production logs.
 */
export async function recordStaffReadOutConsent(params: {
  saidYes: boolean | undefined
  customerId: string | null | undefined
  actorUserId: string
  source: StaffConsentSource
  relatedEntityType: StaffConsentEntity
  relatedEntityId: string | null | undefined
}): Promise<void> {
  if (params.saidYes !== true || !params.customerId) return

  try {
    await ConsentService.applyStaffCapturedConsent(
      params.customerId,
      {
        service_contact_notice_shown: true,
        marketing_sms_opt_in: true,
        notice_key: STAFF_MARKETING_READ_OUT_KEY,
      },
      params.actorUserId,
      {
        source: params.source,
        captureMethod: 'staff_verbal',
        relatedEntityType: params.relatedEntityType,
        relatedEntityId: params.relatedEntityId ?? null,
      }
    )
  } catch (error) {
    logger.error('Could not record a guest yes to marketing texts', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        customerId: params.customerId,
        source: params.source,
        relatedEntityId: params.relatedEntityId ?? null,
      },
    })
  }
}
