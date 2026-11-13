import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import type { Database } from '@/types/database.generated'

/**
 * "Tell me when the next one is on" (growth review of 13 November 2026, owner approved).
 *
 * When an event type (quiz night, cash bingo, music bingo, karaoke) has no date on sale, the
 * website page showed only a phone number. A visitor can now leave a first name and a mobile or an
 * email, tick the marketing wording already in use, and hear about the next date.
 *
 * Nothing new is stored and nothing is sent at sign-up. The sign-up IS a marketing consent, so it
 * is written to the consent history (customer_consents) through ConsentService, tied to the event
 * category it was given for (registerNextDateInterest in next-date-interest-signup.ts). That one
 * row does three jobs:
 *
 *   - Email: recording an email marketing opt-in sets customers.marketing_email_opt_in, which is
 *     what puts a customer in every guest email campaign (promote_due_marketing_campaigns).
 *   - Text: the week-ahead event invite reads these rows for the event's category and adds those
 *     customers to its audience (loadCategoryInterestAudience below, used by
 *     sendCrossPromoForEvent), under the same caps and exclusions as everyone else.
 *   - Evidence: the wording shown, the page and the category are on the consent row.
 *
 * The rows use the source and entity type the removed event waiting list had ('public_event_
 * waitlist', 'event_waitlist'): both are already allowed by the table's CHECK constraints and no
 * code has written them since the waiting list was removed on 28 October 2026, so no migration is
 * needed. `metadata.kind` says which they are. The related entity id is the event CATEGORY id.
 *
 * The consent history is history, not state: an opt-out later adds a row and leaves the sign-up
 * row as it was. Every read here therefore checks the customer's current columns too.
 */

type AdminClient = SupabaseClient<Database, 'public'>

export const NEXT_DATE_INTEREST_SOURCE = 'public_event_waitlist' as const
export const NEXT_DATE_INTEREST_ENTITY_TYPE = 'event_waitlist' as const
export const NEXT_DATE_INTEREST_KIND = 'next_date_interest' as const

export type InterestAudienceRow = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  phone_number: string
}

const INTEREST_READ_LIMIT = 1000
const INTEREST_CHUNK_SIZE = 200

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

/**
 * Customers who asked to hear about the next date of this event category and can be texted about
 * this event now. The promotion audience function (get_cross_promo_audience) only knows guests
 * who have been before, so these are read here and joined to its answer.
 *
 * The same tests that function applies: texts on, no marketing opt-out, a mobile on record, not
 * already booked for this event, and not already texted about it. The marketing flag must still be
 * on, because the sign-up row outlives a later opt-out. `excludeCustomerIds` are the customers the
 * function already returned.
 *
 * Returns null when it cannot be read; the caller then carries on with the audience it has, so a
 * fault here never stops the invites that were going out before.
 */
export async function loadCategoryInterestAudience(
  supabase: AdminClient,
  options: { categoryId: string; eventId: string; excludeCustomerIds?: Iterable<string> },
): Promise<InterestAudienceRow[] | null> {
  try {
    const { data: consentRows, error: consentError } = await supabase
      .from('customer_consents')
      .select('customer_id')
      .eq('source', NEXT_DATE_INTEREST_SOURCE)
      .eq('related_entity_type', NEXT_DATE_INTEREST_ENTITY_TYPE)
      .eq('related_entity_id', options.categoryId)
      .eq('channel', 'sms')
      .eq('purpose', 'marketing')
      .eq('status', 'opted_in')
      .order('captured_at', { ascending: true })
      .limit(INTEREST_READ_LIMIT)
    if (consentError) throw new Error(consentError.message)

    const excluded = new Set(options.excludeCustomerIds ?? [])
    const ids = Array.from(
      new Set(((consentRows ?? []) as Array<{ customer_id: string }>).map((row) => row.customer_id)),
    ).filter((id) => id && !excluded.has(id))
    if (ids.length === 0) return []

    const rows: InterestAudienceRow[] = []
    for (const batch of chunk(ids, INTEREST_CHUNK_SIZE)) {
      const [customers, booked, promoted] = await Promise.all([
        supabase
          .from('customers')
          .select('id, first_name, last_name, mobile_e164, sms_opt_in, sms_status, marketing_sms_opt_in, marketing_sms_opted_out_at')
          .in('id', batch),
        supabase
          .from('bookings')
          .select('customer_id')
          .eq('event_id', options.eventId)
          .in('customer_id', batch)
          .in('status', ['pending_payment', 'confirmed'])
          .eq('is_reminder_only', false),
        supabase.from('sms_promo_context').select('customer_id').eq('event_id', options.eventId).in('customer_id', batch),
      ])
      for (const result of [customers, booked, promoted]) {
        if (result.error) throw new Error(result.error.message)
      }

      const leftOut = new Set(
        [...(booked.data ?? []), ...(promoted.data ?? [])].map((row) => (row as { customer_id: string | null }).customer_id),
      )
      const byId = new Map((customers.data ?? []).map((row) => [row.id, row]))
      // In sign-up order, so the answer is the same on every run.
      for (const id of batch) {
        const customer = byId.get(id)
        if (!customer || leftOut.has(id)) continue
        if (customer.sms_opt_in !== true || customer.marketing_sms_opt_in !== true) continue
        if (customer.marketing_sms_opted_out_at) continue
        if (customer.sms_status !== null && customer.sms_status !== 'active') continue
        if (!customer.mobile_e164) continue
        rows.push({
          customer_id: id,
          first_name: customer.first_name ?? null,
          last_name: customer.last_name ?? null,
          phone_number: customer.mobile_e164,
        })
      }
    }
    return rows
  } catch (error) {
    logger.error('Could not read the next-date sign-ups for an event invite; sending to past guests only', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { eventId: options.eventId, categoryId: options.categoryId },
    })
    return null
  }
}
