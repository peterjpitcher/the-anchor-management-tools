import type { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

type AdminClient = ReturnType<typeof createAdminClient>

// Quick-add find-or-create for voucher assignment (spec 5.1, F16), shared by the
// FOH page and back-office Hand-out mode so both behave identically.
//
// Consent: a customer added this way has been signed up in person, so NEWLY
// CREATED customers get all-communications consent (SMS, marketing SMS,
// marketing email). WhatsApp is deliberately excluded: it has its own controlled
// opt-in flow. Customers that already exist are never re-consented; the only
// additive change is filling in a missing email address.

export interface QuickAddCustomerInput {
  name: string
  mobile: string
  email?: string | null
}

export interface QuickAddCustomerResult {
  id: string
  name: string
  existing: boolean
}

interface CustomerHit {
  id: string
  first_name: string | null
  last_name: string | null
  email?: string | null
}

export class QuickAddCustomerError extends Error {}

function buildName(firstName: string | null, lastName: string | null): string {
  const name = [firstName ?? '', lastName ?? ''].map((part) => part.trim()).filter(Boolean).join(' ')
  return name || 'Unknown customer'
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}

async function findByPhone(supabase: AdminClient, variants: string[]): Promise<CustomerHit | null> {
  const quoted = variants.map((variant) => `"${variant}"`).join(',')
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email')
    .or(`mobile_e164.in.(${quoted}),mobile_number.in.(${quoted})`)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    throw error
  }

  return ((data ?? []) as CustomerHit[])[0] ?? null
}

async function backfillMissingEmail(
  supabase: AdminClient,
  existing: CustomerHit,
  email: string | null
): Promise<void> {
  if (!email || existing.email?.trim()) {
    return
  }

  const { error } = await supabase.from('customers').update({ email }).eq('id', existing.id).is('email', null)

  if (error) {
    logger.warn('Voucher quick-add could not backfill the customer email', {
      metadata: { customerId: existing.id, error: error.message }
    })
  }
}

export async function quickAddVoucherCustomer(
  supabase: AdminClient,
  input: QuickAddCustomerInput
): Promise<QuickAddCustomerResult> {
  const email = input.email?.trim().toLowerCase() || null

  let normalisedPhone: string
  try {
    normalisedPhone = formatPhoneForStorage(input.mobile)
  } catch {
    throw new QuickAddCustomerError('Please enter a valid mobile number')
  }

  let variants: string[]
  try {
    variants = generatePhoneVariants(input.mobile)
  } catch {
    variants = []
  }
  const searchNumbers = Array.from(new Set([normalisedPhone, ...variants]))

  let existing: CustomerHit | null
  try {
    existing = await findByPhone(supabase, searchNumbers)
  } catch {
    throw new QuickAddCustomerError('Failed to check for an existing customer')
  }

  if (existing) {
    await backfillMissingEmail(supabase, existing, email)
    return { id: existing.id, name: buildName(existing.first_name, existing.last_name), existing: true }
  }

  const { firstName, lastName } = splitName(input.name)
  const consentedAt = new Date().toISOString()

  const insertCustomer = (withEmail: string | null) =>
    supabase
      .from('customers')
      .insert({
        first_name: firstName,
        last_name: lastName,
        mobile_number: normalisedPhone,
        mobile_e164: normalisedPhone,
        email: withEmail,
        sms_opt_in: true,
        sms_opt_in_at: consentedAt,
        sms_opt_in_source: 'voucher_handout',
        marketing_sms_opt_in: true,
        marketing_sms_opt_in_at: consentedAt,
        marketing_email_opt_in: true,
        marketing_email_opt_in_at: consentedAt
      })
      .select('id, first_name, last_name, email')
      .maybeSingle()

  const first = await insertCustomer(email)
  if (!first.error && first.data) {
    const row = first.data as CustomerHit
    return { id: row.id, name: buildName(row.first_name, row.last_name), existing: false }
  }

  if ((first.error as { code?: string } | null)?.code === '23505') {
    // Race-safe: someone created this customer between the check and the insert.
    try {
      const raced = await findByPhone(supabase, searchNumbers)
      if (raced) {
        await backfillMissingEmail(supabase, raced, email)
        return { id: raced.id, name: buildName(raced.first_name, raced.last_name), existing: true }
      }
    } catch {
      throw new QuickAddCustomerError('Failed to add the customer')
    }

    // No phone match, so the clash was the email: customers has a unique index on
    // lower(email). A different person already holds that address, so create this
    // customer without it rather than failing the hand-out. Their reminder goes by
    // text instead.
    if (email) {
      logger.warn('Voucher quick-add dropped a duplicate email', {
        metadata: { reason: 'another customer already holds this address' }
      })
      const retry = await insertCustomer(null)
      if (!retry.error && retry.data) {
        const row = retry.data as CustomerHit
        return { id: row.id, name: buildName(row.first_name, row.last_name), existing: false }
      }
    }
  }

  throw new QuickAddCustomerError('Failed to add the customer')
}
