import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * Has this parking reminder already gone? Read from the notification history, used by the
 * parking-notifications cron alongside the booking's own sent flags. Moved out of the cron route
 * so the date-change rule below can be tested.
 */

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function allowParkingDedupeSchemaGaps(): boolean {
  return parseBooleanEnv('PARKING_DEDUPE_ALLOW_SCHEMA_GAPS', process.env.NODE_ENV !== 'production')
}

export async function hasParkingReminderBeenSent(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    eventType: 'payment_reminder' | 'session_start' | 'session_end'
    templateKey: string
    payload?: Record<string, unknown>
  }
): Promise<boolean> {
  let query = supabase.from('parking_booking_notifications')
    .select('id')
    .eq('booking_id', input.bookingId)
    // Either channel: reminders go by email first and by text only without one.
    .eq('event_type', input.eventType)
    .eq('status', 'sent')
    .limit(1)

  const stage = typeof input.payload?.stage === 'string' ? input.payload.stage : null
  if (stage) {
    query = query.contains('payload', { stage })
  } else if (input.templateKey) {
    query = query.contains('payload', { template_key: input.templateKey })
  }

  // A date change that moved the start (or end) far enough away clears the reminder flag so the
  // customer is reminded of the NEW date. The history check would otherwise find the reminder sent
  // for the old date and block it, so only reminders sent after the latest such change count.
  if (input.eventType === 'session_start' || input.eventType === 'session_end') {
    const resetKey = input.eventType === 'session_start' ? 'reset_start_reminder' : 'reset_end_reminder'
    const { data: lastReset, error: resetError } = await supabase
      .from('parking_booking_notifications')
      .select('created_at')
      .eq('booking_id', input.bookingId)
      .eq('event_type', 'booking_changed')
      .contains('payload', { [resetKey]: true })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (resetError) {
      console.error('Failed to read parking date changes for reminder dedupe', input.bookingId, resetError)
      return true
    }
    if (lastReset?.created_at) {
      query = query.gt('created_at', lastReset.created_at)
    }
  }

  const { data, error } = await query
  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (allowParkingDedupeSchemaGaps()) {
        console.warn('Parking reminder dedupe skipped because schema is missing expected columns', pgError.message)
        return false
      }

      console.error('Parking reminder dedupe blocked send because schema is unavailable', input.bookingId, pgError.message)
      return true
    }
    console.error('Failed to evaluate parking reminder dedupe state', input.bookingId, error)
    return true
  }

  return Array.isArray(data) && data.length > 0
}
