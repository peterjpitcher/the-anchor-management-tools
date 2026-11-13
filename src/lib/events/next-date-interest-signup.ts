import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import {
  NEXT_DATE_INTEREST_ENTITY_TYPE,
  NEXT_DATE_INTEREST_KIND,
  NEXT_DATE_INTEREST_SOURCE,
} from '@/lib/events/next-date-interest'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { ConsentService } from '@/services/consent'
import type { Database } from '@/types/database.generated'

/**
 * The sign-up half of "Tell me when the next one is on": finds or makes the customer and writes
 * the marketing consent that registers them. What the rows are, why they need no migration and who
 * then hears is in next-date-interest.ts, which also holds the read the event invite uses. Kept
 * apart so the invite does not load the customer and consent services.
 */

type AdminClient = SupabaseClient<Database, 'public'>

export type InterestChannel = 'sms' | 'email'

export type InterestCategory = { id: string; slug: string; name: string }

export type RegisterNextDateInterestInput = {
  category: InterestCategory
  firstName: string
  /** Already normalised to E.164, or null when the visitor gave none. */
  phone: string | null
  /** Already trimmed and lower-cased, or null when the visitor gave none. */
  email: string | null
  /** The visitor ticked the marketing text wording. Only ever true alongside a phone. */
  smsOptIn: boolean
  /** The visitor ticked the marketing email wording. Only ever true alongside an email. */
  emailOptIn: boolean
  consentTextVersion?: string | null
  sourceUrl?: string | null
  userAgent?: string | null
}

export type RegisterNextDateInterestResult =
  | { ok: true; channels: InterestChannel[]; alreadyRegistered: boolean }
  /** `opted_out`: every channel offered has said no to marketing, and a web form never reverses that. */
  | { ok: false; reason: 'customer_unavailable' | 'opted_out' | 'record_failed' }

type InterestCustomer = {
  id: string
  email: string | null
  sms_opt_in: boolean | null
  sms_status: string | null
  marketing_sms_opt_in: boolean | null
  marketing_sms_opted_out_at: string | null
  marketing_email_opt_in: boolean | null
  marketing_email_opted_out_at: string | null
}

const INTEREST_CUSTOMER_COLUMNS =
  'id, email, sms_opt_in, sms_status, marketing_sms_opt_in, marketing_sms_opted_out_at, marketing_email_opt_in, marketing_email_opted_out_at'

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

/**
 * The customer for an email address when the visitor gave no mobile. Matches the address as
 * stored (addresses are saved lower-cased), creates a customer with no phone when nobody has it,
 * and never touches a matched customer's details.
 */
async function ensureCustomerForEmail(supabase: AdminClient, email: string, firstName: string): Promise<string | null> {
  const find = async (): Promise<{ id: string | null; failed: boolean }> => {
    // Exact match, never a pattern: an underscore in an address is a wildcard to ILIKE and could
    // match somebody else. An address stored in another letter case is caught by the unique index
    // on insert, and the sign-up then fails closed rather than guessing.
    const { data, error } = await supabase.from('customers').select('id').eq('email', email).limit(1)
    if (error) return { id: null, failed: true }
    return { id: (data ?? [])[0]?.id ?? null, failed: false }
  }

  const existing = await find()
  if (existing.failed) return null
  if (existing.id) return existing.id

  const { data: inserted, error: insertError } = await supabase
    .from('customers')
    .insert({
      first_name: firstName,
      last_name: '',
      email,
      // No number, so nothing can be texted or sent by WhatsApp. Marketing email is switched on by
      // the consent record, not here.
      sms_opt_in: false,
      marketing_sms_opt_in: false,
      whatsapp_opt_in: false,
      marketing_whatsapp_opt_in: false,
      marketing_email_opt_in: false,
    })
    .select('id')
    .single()

  if (!insertError) return inserted?.id ?? null
  if (isUniqueViolation(insertError)) {
    // Another request created this address's customer a moment ago.
    const raced = await find()
    return raced.failed ? null : raced.id
  }
  logger.error('Next-date sign-up could not create a customer for an email address', {
    error: new Error(insertError.message),
    metadata: { code: insertError.code ?? null },
  })
  return null
}

/** Texts are off for this customer, or they have said no to marketing texts (as ConsentService judges it). */
function hasRefusedMarketingSms(customer: InterestCustomer): boolean {
  return (
    Boolean(customer.marketing_sms_opted_out_at) ||
    customer.sms_opt_in === false ||
    (customer.sms_status !== null && customer.sms_status !== 'active')
  )
}

async function alreadySignedUp(
  supabase: AdminClient,
  customerId: string,
  channel: InterestChannel,
  categoryId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('customer_consents')
    .select('id')
    .eq('customer_id', customerId)
    .eq('channel', channel)
    .eq('purpose', 'marketing')
    .eq('status', 'opted_in')
    .eq('source', NEXT_DATE_INTEREST_SOURCE)
    .eq('related_entity_type', NEXT_DATE_INTEREST_ENTITY_TYPE)
    .eq('related_entity_id', categoryId)
    .limit(1)
  if (error) throw new Error(`Could not read earlier sign-ups: ${error.message}`)
  return (data ?? []).length > 0
}

/**
 * Registers a visitor's wish to hear about the next date of an event category.
 *
 * Fails closed: if the customer cannot be found or made, or a consent cannot be written, the
 * caller gets a failure to show, even when another channel was already written (the repeat check
 * makes the visitor's retry safe). A repeat sign-up writes nothing and reports
 * `alreadyRegistered`. Nothing is sent.
 */
export async function registerNextDateInterest(
  supabase: AdminClient,
  input: RegisterNextDateInterestInput,
): Promise<RegisterNextDateInterestResult> {
  let customerId: string | null
  if (input.phone) {
    const resolution = await ensureCustomerForPhone(supabase, input.phone, { firstName: input.firstName, email: input.email })
    customerId = resolution.customerId
  } else if (input.email) {
    customerId = await ensureCustomerForEmail(supabase, input.email, input.firstName)
  } else {
    customerId = null
  }
  if (!customerId) return { ok: false, reason: 'customer_unavailable' }

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select(INTEREST_CUSTOMER_COLUMNS)
    .eq('id', customerId)
    .maybeSingle()
  if (customerError || !customerRow) {
    logger.error('Next-date sign-up could not read the customer', {
      error: new Error(customerError?.message ?? 'customer_not_found'),
      metadata: { customerId },
    })
    return { ok: false, reason: 'customer_unavailable' }
  }
  const customer = customerRow as InterestCustomer

  // Which channels can be registered. A typed email counts only when it is the address on the
  // customer's record: a matched customer's email is never overwritten from a public form (BK-077),
  // so an address that is not on the record could not be reached by a campaign anyway.
  const channels: InterestChannel[] = []
  if (input.phone && input.smsOptIn && !hasRefusedMarketingSms(customer)) channels.push('sms')
  const emailOnRecord = Boolean(input.email) && (customer.email ?? '').trim().toLowerCase() === input.email
  if (emailOnRecord && input.emailOptIn && !customer.marketing_email_opted_out_at) channels.push('email')
  if (channels.length === 0) return { ok: false, reason: 'opted_out' }

  let wroteSomething = false
  try {
    for (const channel of channels) {
      const switchedOn = channel === 'sms' ? customer.marketing_sms_opt_in === true : customer.marketing_email_opt_in === true
      if (switchedOn && (await alreadySignedUp(supabase, customerId, channel, input.category.id))) continue

      await ConsentService.recordConsent({
        customerId,
        channel,
        purpose: 'marketing',
        status: 'opted_in',
        legalBasis: 'consent',
        source: NEXT_DATE_INTEREST_SOURCE,
        captureMethod: 'checkbox',
        consentTextVersion: input.consentTextVersion ?? null,
        sourceUrl: input.sourceUrl ?? null,
        userAgent: input.userAgent ?? null,
        relatedEntityType: NEXT_DATE_INTEREST_ENTITY_TYPE,
        relatedEntityId: input.category.id,
        metadata: {
          kind: NEXT_DATE_INTEREST_KIND,
          event_category_id: input.category.id,
          event_category_slug: input.category.slug,
        },
      })
      wroteSomething = true
    }
  } catch (error) {
    logger.error('Next-date sign-up could not be recorded', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId, categoryId: input.category.id },
    })
    return { ok: false, reason: 'record_failed' }
  }

  return { ok: true, channels, alreadyRegistered: !wroteSomething }
}
