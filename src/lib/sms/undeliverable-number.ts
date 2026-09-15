import type { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatErrorMessage } from '@/lib/sms-status'

type AdminClient = ReturnType<typeof createAdminClient>

export type UndeliverableNumberReason = 'invalid_number' | 'unreachable_number'

/**
 * Twilio refusals that come back from the send request itself and will refuse every later send
 * to the same number:
 *
 *  - 21211: the number is not a valid phone number;
 *  - 21614: the number is not a mobile number;
 *  - 21612: the number cannot receive text messages (a landline, or a network Twilio cannot reach).
 *
 * No delivery status callback ever reports these, so the status webhook's failure count never
 * moves and, until this existed, the customer row never learnt. On 15 September 2026, 23
 * customers whose numbers Twilio had refused were still marked active, two of them after 15 or
 * more failed event texts each.
 *
 * 21610 (the number has replied STOP to our Twilio number) is deliberately not here. That is an
 * opt-out, recorded by the inbound webhook, not a dead number.
 */
const UNDELIVERABLE_NUMBER_REASONS: Record<string, UndeliverableNumberReason> = {
  '21211': 'invalid_number',
  '21614': 'invalid_number',
  '21612': 'unreachable_number',
}

/** Why a number can never be texted, from a Twilio error code, or null for any other failure. */
export function undeliverableNumberReason(errorCode: unknown): UndeliverableNumberReason | null {
  if (errorCode === null || errorCode === undefined) return null
  return UNDELIVERABLE_NUMBER_REASONS[String(errorCode)] ?? null
}

/**
 * Stops texting a customer whose number Twilio refused outright, the way the delivery webhook stops
 * a number after repeated delivery failures: `sms_status` deactivated and `sms_opt_in` off, with the
 * reason recorded. Staff turn texts back on from the customer record once the number is corrected.
 *
 * Does nothing for any other error. Never throws: the send has already failed and its caller
 * reports that, so a failure here is logged rather than raised.
 */
export async function markCustomerNumberUndeliverable(
  db: AdminClient,
  customerId: string,
  errorCode: string | number
): Promise<void> {
  const reason = undeliverableNumberReason(errorCode)
  if (!reason) return

  try {
    const { error } = await db
      .from('customers')
      .update({
        sms_status: 'sms_deactivated',
        sms_opt_in: false,
        sms_deactivated_at: new Date().toISOString(),
        sms_deactivation_reason: reason,
        last_sms_failure_reason: formatErrorMessage(errorCode),
      })
      .eq('id', customerId)

    if (error) {
      logger.error('Failed to stop texting a number Twilio refused', {
        metadata: {
          customerId,
          errorCode: String(errorCode),
          code: error.code ?? null,
          message: error.message ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
      })
      return
    }

    // logger.warn is silent in production, and this is a line someone needs to be able to find.
    console.warn('Stopped texting a number Twilio refused', JSON.stringify({ customerId, errorCode: String(errorCode), reason }))
  } catch (error) {
    logger.error('Failed to stop texting a number Twilio refused', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId, errorCode: String(errorCode) },
    })
  }
}
