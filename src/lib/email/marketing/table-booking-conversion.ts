import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/lib/logger'

/**
 * Records a table booking made from a marketing email as a `marketing_conversions` row
 * (spec tasks/spec-2026-11-02-table-booking-return-visits.md, Phase 2).
 *
 * The renderer stamps `utm_content=<recipient id>` on every campaign link and the website
 * carries the UTM labels through to the booking API, so a booking whose `utm_source` is
 * `marketing_email` names the exact email that drove it. The existing attribution report reads
 * `marketing_conversions`, so this is what makes these bookings show up there.
 *
 * Never fails the booking. The guest's table is already made by the time this runs; a lost
 * attribution row costs a number on a report, so it is logged loudly and the booking goes on.
 * Idempotent on the booking id through the unique index `marketing_conversions_table_booking_key`.
 */

// `any` because the admin client and the test fakes share no exported type (as day-hours.ts).
type Db = SupabaseClient<any, 'public', any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TableBookingConversionInput {
  tableBookingId: string
  customerId: string | null
  partySize: number
  attribution: Partial<Record<'booking_source' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'short_code', string>> | null
}

export type TableBookingConversionOutcome = 'recorded' | 'duplicate' | 'not_marketing' | 'unknown_recipient' | 'failed'

export async function recordTableBookingMarketingConversion(
  db: Db,
  input: TableBookingConversionInput,
): Promise<TableBookingConversionOutcome> {
  const attribution = input.attribution
  const recipientId = attribution?.utm_content?.trim() ?? ''
  if (attribution?.utm_source !== 'marketing_email' || !UUID.test(recipientId)) return 'not_marketing'

  try {
    const { data: recipient, error: lookupError } = await db
      .from('marketing_campaign_recipients')
      .select('id, campaign_id, customer_id')
      .eq('id', recipientId)
      .maybeSingle()
    if (lookupError) throw new Error(`Recipient lookup failed: ${lookupError.message}`)
    // A forged or stale id: nothing to attribute to, and not worth an alert.
    if (!recipient) return 'unknown_recipient'

    const row = recipient as { id: string; campaign_id: string; customer_id: string | null }
    const { error: insertError } = await db.from('marketing_conversions').insert({
      conversion_type: 'table_booking',
      campaign_id: row.campaign_id,
      recipient_id: row.id,
      party_size: input.partySize,
      landing_path: '/book-table',
      short_code: attribution.short_code ?? null,
      utm_source: attribution.utm_source ?? null,
      utm_medium: attribution.utm_medium ?? null,
      utm_campaign: attribution.utm_campaign ?? null,
      utm_content: recipientId,
      metadata: {
        table_booking_id: input.tableBookingId,
        customer_id: input.customerId,
        booking_source: attribution.booking_source ?? null,
        // A forwarded email books under someone else's name; worth seeing, not worth refusing.
        same_customer: input.customerId !== null && input.customerId === row.customer_id,
      },
    })

    if (insertError) {
      if (insertError.code === '23505') return 'duplicate'
      throw new Error(`Insert failed: ${insertError.message}`)
    }
    return 'recorded'
  } catch (error) {
    logger.error('Could not record a table booking against its marketing email', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: input.tableBookingId, recipientId },
    })
    return 'failed'
  }
}
