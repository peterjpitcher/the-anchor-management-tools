import type { createAdminClient } from '@/lib/supabase/admin'
import { ConsentService } from '@/services/consent'
import { logger } from '@/lib/logger'

type AdminClient = ReturnType<typeof createAdminClient>

/** Twilio's "this number has opted out of messages": it replied STOP to our number. */
export const TWILIO_OPTED_OUT_ERROR_CODE = '21610'

/**
 * Records the opt-out Twilio enforces when it refuses a send with 21610 (BK-080).
 *
 * Twilio keeps its own STOP list, so a number that replied STOP is refused on every later send.
 * When the STOP never reached a customer record (an unmatched inbound sits in the holding queue
 * until staff link it), the record stayed SMS-active: the app kept choosing texts for that guest,
 * every one was refused, and a new booking switched nothing off. 9 sends to one customer failed
 * this way. This writes the opt-out the guest already gave, as a provider event.
 *
 * Does nothing for any other error, or when the record already says opted out. Never throws: the
 * send has already failed and its caller reports that.
 */
export async function recordProviderSmsOptOut(
  db: AdminClient,
  customerId: string,
  errorCode: string | number
): Promise<void> {
  if (String(errorCode) !== TWILIO_OPTED_OUT_ERROR_CODE) return

  try {
    const { data, error } = await db
      .from('customers')
      .select('id, sms_status')
      .eq('id', customerId)
      .maybeSingle()

    if (error || !data) {
      logger.error('Could not read a customer Twilio says has opted out', {
        metadata: { customerId, code: error?.code ?? null, message: error?.message ?? null },
      })
      return
    }

    if (data.sms_status === 'opted_out') return

    await ConsentService.recordOptOut(customerId, 'sms', 'direct_message', {
      captureMethod: 'provider_event',
      metadata: { provider: 'twilio', error_code: TWILIO_OPTED_OUT_ERROR_CODE },
    })

    // logger.warn is silent in production, and this is a line someone needs to be able to find.
    console.warn('Recorded an SMS opt-out Twilio enforces', JSON.stringify({ customerId }))
  } catch (error) {
    logger.error('Failed to record an SMS opt-out Twilio enforces', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
  }
}
