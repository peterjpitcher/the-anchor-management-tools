import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import type { PayPalPayerPrefill } from '@/lib/paypal'

/**
 * Reads the guest behind a booking so PayPal's pay screen can be filled in for them
 * (buildPayPalPrefillPaymentSource in src/lib/paypal.ts).
 *
 * The booking's own contact email wins over the customer record's email: it is the address the
 * guest typed for this booking. Placeholder customers (walk-in and staff stand-ins) give nothing,
 * so PayPal is never shown a made-up name.
 *
 * Never throws. Prefill is a convenience, so a failed read returns null and the order is made
 * without it, exactly as before.
 */
export async function loadPayPalPayerPrefill(
  // `any` matches the untyped admin client the booking code passes around (event-payments.ts).
  supabase: SupabaseClient<any, 'public', any>,
  input: { customerId: string | null | undefined; contactEmail?: string | null },
): Promise<PayPalPayerPrefill | null> {
  const contactEmail = typeof input.contactEmail === 'string' && input.contactEmail.trim()
    ? input.contactEmail.trim()
    : null

  if (!input.customerId) {
    return contactEmail ? { email: contactEmail } : null
  }

  try {
    const { data, error } = await supabase
      .from('customers')
      .select('first_name, last_name, email, mobile_e164, is_placeholder')
      .eq('id', input.customerId)
      .maybeSingle()

    if (error) throw error
    if (!data) return contactEmail ? { email: contactEmail } : null
    if (data.is_placeholder === true) return null

    return {
      firstName: data.first_name ?? null,
      lastName: data.last_name ?? null,
      email: contactEmail ?? data.email ?? null,
      mobileE164: data.mobile_e164 ?? null,
    }
  } catch (error) {
    const err = error as { message?: string; code?: string; details?: string; hint?: string } | null
    logger.warn('PayPal prefill: could not read the customer; the order goes without prefill', {
      metadata: {
        customerId: input.customerId,
        message: err?.message ?? String(error),
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
      },
    })
    return null
  }
}
