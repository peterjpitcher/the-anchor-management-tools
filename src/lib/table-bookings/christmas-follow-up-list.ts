import type { SupabaseClient } from '@supabase/supabase-js'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  LEAD_SOURCE_LAPSED_HOLD,
  LEAD_SOURCE_WEBSITE,
  findChristmasBookingHolders,
} from '@/lib/table-bookings/christmas-leads'

/**
 * The staff call list behind the "Christmas follow-ups" tab (Christmas funnel spec, owner decision
 * 7): unfinished Christmas dinner bookings dated today onward. Website leads with no booking linked,
 * and Christmas bookings whose unpaid deposit hold lapsed. Same permissions as the awaiting-
 * confirmation call list: table_bookings view to see it, edit to mark a guest called.
 *
 * Read with the service role after the page's permission check (the leads table is service role
 * only).
 */

// `any` matches the untyped admin client the pages and actions pass around.
type Db = SupabaseClient<any, 'public', any>

/** A row cap well inside PostgREST's 1,000; a Christmas season has nowhere near this many. */
export const CHRISTMAS_FOLLOW_UP_LIST_LIMIT = 500

export type ChristmasFollowUpEmailState = 'not_sent' | 'sending' | 'sent' | 'refused' | 'uncertain'

export type ChristmasFollowUpItem = {
  leadId: string
  source: 'website' | 'lapsed_hold'
  guestName: string | null
  phone: string | null
  email: string | null
  bookingDate: string
  /** 'HH:MM', London wall clock. */
  bookingTime: string
  partySize: number
  /** When the guest started (the lead was saved). */
  startedAt: string
  followUpEmail: ChristmasFollowUpEmailState
  followUpSentAt: string | null
  optedOut: boolean
  calledAt: string | null
  callNote: string | null
  /** True when this email or mobile now holds a Christmas booking that is not cancelled. */
  bookedSince: boolean
}

type LeadListRow = {
  id: string
  source: string
  booking_period_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile_e164: string | null
  booking_date: string
  booking_time: string
  party_size: number
  created_at: string
  follow_up_opt_out: boolean | null
  follow_up_claimed_at: string | null
  follow_up_sent_at: string | null
  follow_up_outcome: string | null
  called_at: string | null
  call_note: string | null
}

function emailState(row: LeadListRow): ChristmasFollowUpEmailState {
  if (row.follow_up_outcome === 'sent' || row.follow_up_outcome === 'refused' || row.follow_up_outcome === 'uncertain') {
    return row.follow_up_outcome
  }
  return row.follow_up_claimed_at ? 'sending' : 'not_sent'
}

/** Soonest date first. Throws on a failed read. */
export async function listChristmasFollowUps(db: Db, options: { today?: string } = {}): Promise<ChristmasFollowUpItem[]> {
  const today = options.today ?? getTodayIsoDate()

  const { data, error } = await db
    .from('table_booking_leads')
    .select(
      'id, source, booking_period_id, first_name, last_name, email, mobile_e164, booking_date, booking_time, party_size, created_at, follow_up_opt_out, follow_up_claimed_at, follow_up_sent_at, follow_up_outcome, called_at, call_note',
    )
    .gte('booking_date', today)
    // Website leads that never became a booking, and every lapsed hold.
    .or(`table_booking_id.is.null,source.eq.${LEAD_SOURCE_LAPSED_HOLD}`)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(CHRISTMAS_FOLLOW_UP_LIST_LIMIT)
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as LeadListRow[]).filter(
    (row) => row.source === LEAD_SOURCE_WEBSITE || row.source === LEAD_SOURCE_LAPSED_HOLD,
  )
  if (rows.length === 0) return []

  // Somebody who has booked since (by phone, or online with a new form) is shown as booked.
  const periodIds = Array.from(new Set(rows.map((row) => row.booking_period_id)))
  const { data: periodRows, error: periodsError } = await db
    .from('booking_periods')
    .select('id, starts_on, ends_on')
    .in('id', periodIds)
  if (periodsError) throw new Error(periodsError.message)

  const holders = new Map<string, { emails: Set<string>; mobiles: Set<string> }>()
  for (const period of (periodRows ?? []) as Array<{ id: string; starts_on: string; ends_on: string }>) {
    const contacts = rows
      .filter((row) => row.booking_period_id === period.id)
      .map((row) => ({ email: row.email, mobile: row.mobile_e164 }))
    holders.set(period.id, await findChristmasBookingHolders(db, contacts, { startsOn: period.starts_on, endsOn: period.ends_on }))
  }

  return rows.map((row): ChristmasFollowUpItem => {
    const booked = holders.get(row.booking_period_id)
    const name = [row.first_name, row.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ')
    return {
      leadId: row.id,
      source: row.source === LEAD_SOURCE_LAPSED_HOLD ? 'lapsed_hold' : 'website',
      guestName: name || null,
      phone: row.mobile_e164,
      email: row.email,
      bookingDate: row.booking_date,
      bookingTime: String(row.booking_time).slice(0, 5),
      partySize: row.party_size,
      startedAt: row.created_at,
      followUpEmail: emailState(row),
      followUpSentAt: row.follow_up_sent_at,
      optedOut: row.follow_up_opt_out === true,
      calledAt: row.called_at,
      callNote: row.call_note,
      bookedSince: Boolean(
        (row.email && booked?.emails.has(row.email)) || (row.mobile_e164 && booked?.mobiles.has(row.mobile_e164)),
      ),
    }
  })
}

/**
 * Records that a member of staff rang the guest, with an optional note. Returns false when there
 * is no such lead. Throws on a failed write.
 */
export async function recordChristmasLeadCalled(
  db: Db,
  input: { leadId: string; userId: string; note: string | null; now?: Date },
): Promise<boolean> {
  const { data, error } = await db
    .from('table_booking_leads')
    .update({
      called_at: (input.now ?? new Date()).toISOString(),
      called_by: input.userId,
      call_note: input.note,
    })
    .eq('id', input.leadId)
    .select('id')
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}
