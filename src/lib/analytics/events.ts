import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

export type AnalyticsEventInput = {
  customerId: string
  eventType: string
  eventBookingId?: string | null
  tableBookingId?: string | null
  privateBookingId?: string | null
  metadata?: Record<string, unknown>
}

export async function recordAnalyticsEvent(
  supabase: SupabaseClient<any, 'public', any>,
  input: AnalyticsEventInput
): Promise<void> {
  try {
    const { error } = await supabase
      .from('analytics_events')
      .insert({
        customer_id: input.customerId,
        event_booking_id: input.eventBookingId ?? null,
        table_booking_id: input.tableBookingId ?? null,
        private_booking_id: input.privateBookingId ?? null,
        event_type: input.eventType,
        metadata: input.metadata ?? {}
      })

    if (error) {
      throw error
    }
  } catch (error) {
    logger.warn('Failed to record analytics event', {
      metadata: {
        customerId: input.customerId,
        eventType: input.eventType,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
}
