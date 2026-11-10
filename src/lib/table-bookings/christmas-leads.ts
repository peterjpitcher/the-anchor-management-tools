import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { formatPhoneForStorage } from '@/lib/utils'
import { generateGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { getAppUrl } from '@/lib/env'
import { endOfLondonDayUtc, getTodayIsoDate, londonVisitAtIso } from '@/lib/dateUtils'
import { normaliseContactEmail } from '@/lib/bookings/contact-email'

/**
 * Unfinished Christmas dinner bookings, "leads" (Christmas funnel spec, owner decisions 5 to 7 of
 * 10 November 2026). One row per lead in public.table_booking_leads, service role only.
 *
 *  - The website saves a lead when the guest presses Continue on the details step
 *    (POST /api/table-bookings/leads). Nothing is held. Posting the same lead_ref again updates it.
 *  - When the guest books, POST /api/table-bookings carries the lead_ref and the lead is linked to
 *    the booking, so no follow-up goes.
 *  - A Christmas booking whose unpaid deposit hold lapses becomes a lead too (source
 *    'lapsed_hold'), so its cancellation email can carry a "Finish my booking" link and staff can
 *    see it. The follow-up cron never emails those.
 *  - The "finish my booking" link is the website's `/book-table?christmas=1#resume=<token>`. The
 *    token is 32 random bytes in base64url and only its SHA-256 is stored; it rides in the fragment,
 *    which no server ever receives, and the website swaps it server side with its API key
 *    (POST /api/table-bookings/leads/resume). It lasts until the end of the chosen date, London time.
 *
 * Never personal data in a URL, and never a raw token in a log.
 */

// `any` matches the untyped admin client the routes and crons pass around.
type Db = SupabaseClient<any, 'public', any>

export const LEAD_SOURCE_WEBSITE = 'website'
export const LEAD_SOURCE_LAPSED_HOLD = 'lapsed_hold'

/** The website's Christmas page, linked from the follow-up email (owner decision 9). */
export const CHRISTMAS_PAGE_URL = `${GUEST_CONTACT.website}/christmas-parties`

/** generateGuestToken: 32 random bytes in base64url, 43 characters. */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** What the leads table's mobile CHECK accepts. */
const E164_PATTERN = /^\+[0-9]{7,15}$/

const UNIQUE_VIOLATION = '23505'

/** A database error, field by field: `JSON.stringify(error)` hides them. */
export function describeDbError(error: unknown): { message: string; code: string | null; details: string | null; hint: string | null } {
  const err = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null
  return {
    message: typeof err?.message === 'string' ? err.message : String(error),
    code: typeof err?.code === 'string' ? err.code : null,
    details: typeof err?.details === 'string' ? err.details : null,
    hint: typeof err?.hint === 'string' ? err.hint : null,
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(describeDbError(error).message)
}

/** The website's "finish my booking" address for a raw resume token. */
export function buildResumeUrl(rawToken: string): string {
  return `${GUEST_CONTACT.website}/book-table?christmas=1#resume=${encodeURIComponent(rawToken)}`
}

/** The end of the chosen date, London time, as an ISO instant; null for a date that is not real. */
export function resumeLinkExpiresAt(bookingDate: string): string | null {
  return endOfLondonDayUtc(bookingDate)?.toISOString() ?? null
}

/** 'HH:MM' from a stored time ('12:00:00') or a typed one ('12:00'). */
function toClockTime(value: string): string {
  return value.slice(0, 5)
}

// ─── The Christmas period a date falls in ───────────────────────────────────────────────────────

export type ChristmasPeriodRow = {
  id: string
  starts_on: string
  ends_on: string
  min_party_size: number | null
  max_party_size: number | null
  min_notice_hours: number | null
  deposit_basis: string | null
  deposit_amount: number | string | null
}

export const CHRISTMAS_PERIOD_COLUMNS =
  'id, starts_on, ends_on, min_party_size, max_party_size, min_notice_hours, deposit_basis, deposit_amount'

/** The live (active, unarchived) Christmas period covering `date`, or null. Throws on a failed read. */
export async function loadActiveChristmasPeriod(db: Db, date: string): Promise<ChristmasPeriodRow | null> {
  const { data, error } = await db
    .from('booking_periods')
    .select(CHRISTMAS_PERIOD_COLUMNS)
    .eq('period_kind', 'christmas')
    .eq('is_active', true)
    .is('archived_at', null)
    .lte('starts_on', date)
    .gte('ends_on', date)
    .maybeSingle()
  if (error) throw error
  return (data as ChristmasPeriodRow | null) ?? null
}

/**
 * Whether a date and time can still be booked online now: at least the period's minimum notice
 * ahead (192 hours, 8 days, for Christmas 2026). False for a time that cannot be read.
 */
export function isStillBookableOnline(
  bookingDate: string,
  bookingTime: string,
  minNoticeHours: number | null | undefined,
  now: Date,
): boolean {
  const startIso = londonVisitAtIso(bookingDate, bookingTime)
  if (!startIso) return false
  const notice = typeof minNoticeHours === 'number' && minNoticeHours > 0 ? minNoticeHours : 0
  return Date.parse(startIso) - now.getTime() >= notice * 60 * 60 * 1000
}

// ─── Saving a website lead ──────────────────────────────────────────────────────────────────────

export const WebsiteLeadSchema = z.object({
  lead_ref: z.string().uuid(),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(32),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  party_size: z.number().int().min(1).max(100),
  follow_up_opt_out: z.boolean().optional().default(false),
  purpose: z.literal('christmas'),
})

export type WebsiteLeadInput = z.infer<typeof WebsiteLeadSchema>

export type SaveLeadResult =
  | { ok: true; leadRef: string }
  | { ok: false; code: 'VALIDATION_ERROR'; message: string }

/**
 * An existing customer with this mobile or email, for the unsubscribe link and the staff list.
 * Never creates one: a lead is not a customer. Best effort: null when it cannot be read.
 */
async function findExistingCustomerId(db: Db, mobileE164: string, email: string): Promise<string | null> {
  try {
    for (const [column, value] of [['mobile_e164', mobileE164], ['email', email]] as const) {
      const { data, error } = await db
        .from('customers')
        .select('id')
        .eq(column, value)
        .is('merged_into_customer_id', null)
        .limit(1)
      if (error) throw error
      const id = (data as Array<{ id?: string }> | null)?.[0]?.id
      if (typeof id === 'string') return id
    }
    return null
  } catch (error) {
    // logger.warn is silent in production, and that is right here: the lead still saves, it only
    // goes without the customer link.
    logger.warn('Christmas lead: could not look for a matching customer', { metadata: describeDbError(error) })
    return null
  }
}

/**
 * Saves (or updates, by lead_ref) a lead from the website's details step. Refuses a date outside
 * a live Christmas period, a date in the past, a party outside the period's limits and a phone
 * number that cannot be read. Throws when the database cannot be read or written, so the route
 * fails closed.
 */
export async function saveWebsiteLead(db: Db, input: WebsiteLeadInput, today: string = getTodayIsoDate()): Promise<SaveLeadResult> {
  let mobileE164: string
  try {
    mobileE164 = formatPhoneForStorage(input.phone, { defaultCountryCode: input.default_country_code })
  } catch {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That phone number does not look right.' }
  }
  if (!E164_PATTERN.test(mobileE164)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That phone number does not look right.' }
  }

  if (input.booking_date < today) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That date has passed.' }
  }

  const period = await loadActiveChristmasPeriod(db, input.booking_date)
  if (!period) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That date is not in the Christmas booking period.' }
  }
  if (
    (typeof period.min_party_size === 'number' && input.party_size < period.min_party_size) ||
    (typeof period.max_party_size === 'number' && input.party_size > period.max_party_size)
  ) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That party size cannot be booked for Christmas dinner.' }
  }

  const email = normaliseContactEmail(input.email)
  if (!email) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'That email address does not look right.' }
  }

  const customerId = await findExistingCustomerId(db, mobileE164, email)
  const lastName = input.last_name?.trim() || null

  const { data, error } = await db
    .from('table_booking_leads')
    .upsert(
      {
        lead_ref: input.lead_ref,
        source: LEAD_SOURCE_WEBSITE,
        booking_period_id: period.id,
        first_name: input.first_name.trim(),
        last_name: lastName,
        email,
        mobile_e164: mobileE164,
        booking_date: input.booking_date,
        booking_time: toClockTime(input.booking_time),
        party_size: input.party_size,
        follow_up_opt_out: input.follow_up_opt_out === true,
        // Only set when found, so an update never clears a match made earlier.
        ...(customerId ? { customer_id: customerId } : {}),
      },
      { onConflict: 'lead_ref' },
    )
    .select('lead_ref')
    .single()
  if (error) throw error
  return { ok: true, leadRef: (data as { lead_ref: string }).lead_ref }
}

// ─── The resume link ────────────────────────────────────────────────────────────────────────────

export type ResumeLinkDetails = {
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  booking_date: string
  booking_time: string
  party_size: number
  purpose: 'christmas'
}

export type ResumeLinkResult = { state: 'ok'; data: ResumeLinkDetails } | { state: 'invalid' }

/**
 * The details behind a resume token, or invalid when the token is unknown or has expired. Throws
 * when the database cannot be read. The token is never consumed, so a reload reads it again.
 */
export async function readResumeLink(db: Db, rawToken: string, now: Date = new Date()): Promise<ResumeLinkResult> {
  if (typeof rawToken !== 'string' || !RAW_TOKEN_PATTERN.test(rawToken)) return { state: 'invalid' }

  const { data, error } = await db
    .from('table_booking_leads')
    .select('first_name, last_name, email, mobile_e164, booking_date, booking_time, party_size, resume_token_expires_at')
    .eq('resume_token_hash', hashGuestToken(rawToken))
    .maybeSingle()
  if (error) throw error
  if (!data) return { state: 'invalid' }

  const row = data as {
    first_name: string
    last_name: string | null
    email: string | null
    mobile_e164: string | null
    booking_date: string
    booking_time: string
    party_size: number
    resume_token_expires_at: string | null
  }
  const expiresMs = Date.parse(row.resume_token_expires_at ?? '')
  if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) return { state: 'invalid' }

  return {
    state: 'ok',
    data: {
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.mobile_e164,
      booking_date: row.booking_date,
      booking_time: toClockTime(row.booking_time),
      party_size: row.party_size,
      purpose: 'christmas',
    },
  }
}

// ─── Linking a lead to the booking it became ────────────────────────────────────────────────────

/**
 * Marks a website lead as booked. Never throws and never slows the booking beyond one update: a
 * failure is logged and the booking carries on (spec: a failed link never fails the booking).
 */
export async function linkLeadToBooking(
  db: Db,
  input: { leadRef: string; tableBookingId: string },
): Promise<'linked' | 'not_found' | 'failed'> {
  try {
    const { data, error } = await db
      .from('table_booking_leads')
      .update({ table_booking_id: input.tableBookingId })
      .eq('lead_ref', input.leadRef)
      .eq('source', LEAD_SOURCE_WEBSITE)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      logger.info('Christmas lead: no website lead to link to the new booking', {
        metadata: { tableBookingId: input.tableBookingId },
      })
      return 'not_found'
    }
    return 'linked'
  } catch (error) {
    logger.error('Christmas lead could not be linked to its booking; the booking is unaffected', {
      error: asError(error),
      metadata: { tableBookingId: input.tableBookingId, ...describeDbError(error) },
    })
    return 'failed'
  }
}

// ─── A lapsed Christmas deposit hold ────────────────────────────────────────────────────────────

export type LapsedHoldLeadResult = {
  /** The website link for the cancellation email, or null when none should go. */
  finishUrl: string | null
  /** The raw token, so the caller can keep it out of the email log. Null with no link. */
  rawToken: string | null
  outcome: 'issued' | 'not_christmas' | 'no_period' | 'not_bookable_online' | 'failed'
}

type LapsedBookingRow = {
  id: string
  booking_type: string | null
  booking_date: string
  booking_time: string
  party_size: number
  customer_id: string | null
  contact_email: string | null
  booking_period_id: string | null
}

type LapsedCustomerRow = {
  first_name: string | null
  last_name: string | null
  email: string | null
  mobile_e164: string | null
}

async function loadPeriodForLapsedBooking(
  db: Db,
  booking: LapsedBookingRow,
): Promise<{ id: string; min_notice_hours: number | null } | null> {
  const query = db.from('booking_periods').select('id, min_notice_hours, period_kind')
  const { data, error } = booking.booking_period_id
    ? await query.eq('id', booking.booking_period_id).maybeSingle()
    : await query
        .eq('period_kind', 'christmas')
        .is('archived_at', null)
        .lte('starts_on', booking.booking_date)
        .gte('ends_on', booking.booking_date)
        .maybeSingle()
  if (error) throw error
  const row = data as { id: string; min_notice_hours: number | null; period_kind: string } | null
  return row && row.period_kind === 'christmas' ? { id: row.id, min_notice_hours: row.min_notice_hours } : null
}

/**
 * Saves a lapsed Christmas deposit hold as a lead with a fresh resume token, and returns the
 * "Finish my booking" link for the cancellation email it already gets (owner decision 6). The
 * lead is saved for every Christmas hold so staff see it; the link goes only while the date can
 * still be booked online, because a link to a form that must refuse the date helps nobody.
 *
 * Christmas bookings only. Never throws: any fault leaves the cancellation email exactly as it was,
 * and is logged.
 */
export async function issueLapsedHoldLead(
  db: Db,
  input: { tableBookingId: string; now?: Date },
): Promise<LapsedHoldLeadResult> {
  const now = input.now ?? new Date()
  try {
    const { data: bookingData, error: bookingError } = await db
      .from('table_bookings')
      .select('id, booking_type, booking_date, booking_time, party_size, customer_id, contact_email, booking_period_id')
      .eq('id', input.tableBookingId)
      .maybeSingle()
    if (bookingError) throw bookingError
    const booking = bookingData as LapsedBookingRow | null
    if (!booking || booking.booking_type !== 'christmas') {
      return { finishUrl: null, rawToken: null, outcome: 'not_christmas' }
    }

    const period = await loadPeriodForLapsedBooking(db, booking)
    if (!period) return { finishUrl: null, rawToken: null, outcome: 'no_period' }

    let customer: LapsedCustomerRow | null = null
    if (booking.customer_id) {
      const { data: customerData, error: customerError } = await db
        .from('customers')
        .select('first_name, last_name, email, mobile_e164')
        .eq('id', booking.customer_id)
        .maybeSingle()
      if (customerError) throw customerError
      customer = customerData as LapsedCustomerRow | null
    }

    const expiresAt = resumeLinkExpiresAt(booking.booking_date)
    if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) {
      return { finishUrl: null, rawToken: null, outcome: 'not_bookable_online' }
    }
    const rawToken = generateGuestToken()
    const tokenColumns = { resume_token_hash: hashGuestToken(rawToken), resume_token_expires_at: expiresAt }
    const mobile = customer?.mobile_e164?.trim() || null

    const { error: insertError } = await db.from('table_booking_leads').insert({
      lead_ref: randomUUID(),
      source: LEAD_SOURCE_LAPSED_HOLD,
      booking_period_id: period.id,
      customer_id: booking.customer_id,
      table_booking_id: booking.id,
      first_name: (customer?.first_name ?? '').trim().slice(0, 100),
      last_name: customer?.last_name?.trim().slice(0, 100) || null,
      email: normaliseContactEmail(booking.contact_email) ?? normaliseContactEmail(customer?.email),
      mobile_e164: mobile && E164_PATTERN.test(mobile) ? mobile : null,
      booking_date: booking.booking_date,
      booking_time: toClockTime(booking.booking_time),
      party_size: booking.party_size,
      ...tokenColumns,
    })
    if (insertError) {
      if ((insertError as { code?: string }).code !== UNIQUE_VIOLATION) throw insertError
      // Already saved for this booking (cancelled, reinstated and lapsed again): a fresh token.
      const { error: updateError } = await db
        .from('table_booking_leads')
        .update(tokenColumns)
        .eq('table_booking_id', booking.id)
        .eq('source', LEAD_SOURCE_LAPSED_HOLD)
      if (updateError) throw updateError
    }

    if (!isStillBookableOnline(booking.booking_date, booking.booking_time, period.min_notice_hours, now)) {
      return { finishUrl: null, rawToken: null, outcome: 'not_bookable_online' }
    }
    return { finishUrl: buildResumeUrl(rawToken), rawToken, outcome: 'issued' }
  } catch (error) {
    logger.error('Lapsed Christmas hold could not be saved as a lead; the cancellation email goes without the link', {
      error: asError(error),
      metadata: { tableBookingId: input.tableBookingId, ...describeDbError(error) },
    })
    return { finishUrl: null, rawToken: null, outcome: 'failed' }
  }
}

// ─── Who already holds a Christmas booking ──────────────────────────────────────────────────────

export type ContactKeys = { email: string | null; mobile: string | null }

/**
 * Which of these emails and mobiles already hold a Christmas table booking that is not cancelled,
 * dated inside the window (a Christmas period). Matched through the customer record (email or
 * mobile) and through the email typed for a booking. Throws on a failed read.
 */
export async function findChristmasBookingHolders(
  db: Db,
  contacts: ContactKeys[],
  window: { startsOn: string; endsOn: string },
): Promise<{ emails: Set<string>; mobiles: Set<string> }> {
  const emails = Array.from(new Set(contacts.map((c) => c.email).filter((v): v is string => Boolean(v))))
  const mobiles = Array.from(new Set(contacts.map((c) => c.mobile).filter((v): v is string => Boolean(v))))
  const booked = { emails: new Set<string>(), mobiles: new Set<string>() }
  if (emails.length === 0 && mobiles.length === 0) return booked

  const customers = new Map<string, { email: string | null; mobile_e164: string | null }>()
  for (const [column, values] of [['email', emails], ['mobile_e164', mobiles]] as const) {
    if (values.length === 0) continue
    const { data, error } = await db.from('customers').select('id, email, mobile_e164').in(column, values)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: string; email: string | null; mobile_e164: string | null }>) {
      customers.set(row.id, { email: normaliseContactEmail(row.email), mobile_e164: row.mobile_e164 })
    }
  }

  const bookingsFor = (column: 'customer_id' | 'contact_email', values: string[]) =>
    db
      .from('table_bookings')
      .select('customer_id, contact_email')
      .eq('booking_type', 'christmas')
      .neq('status', 'cancelled')
      .gte('booking_date', window.startsOn)
      .lte('booking_date', window.endsOn)
      .in(column, values)

  const customerIds = Array.from(customers.keys())
  const [byCustomer, byContactEmail] = await Promise.all([
    customerIds.length > 0 ? bookingsFor('customer_id', customerIds) : Promise.resolve({ data: [], error: null }),
    emails.length > 0 ? bookingsFor('contact_email', emails) : Promise.resolve({ data: [], error: null }),
  ])
  if (byCustomer.error) throw byCustomer.error
  if (byContactEmail.error) throw byContactEmail.error

  for (const row of [...(byCustomer.data ?? []), ...(byContactEmail.data ?? [])] as Array<{
    customer_id: string | null
    contact_email: string | null
  }>) {
    const customer = row.customer_id ? customers.get(row.customer_id) : undefined
    if (customer?.email) booked.emails.add(customer.email)
    if (customer?.mobile_e164) booked.mobiles.add(customer.mobile_e164)
    const typed = normaliseContactEmail(row.contact_email)
    if (typed) booked.emails.add(typed)
  }
  return booked
}

// ─── Opting out of the follow-up (a lead with no matching customer) ────────────────────────────

/** The management app's opt-out address for one follow-up email. Token only, no personal data. */
export function buildLeadOptOutUrl(rawToken: string): string {
  return `${getAppUrl().replace(/\/+$/, '')}/api/table-bookings/leads/opt-out?t=${encodeURIComponent(rawToken)}`
}

/**
 * Opts out the lead behind an opt-out token, and every other website lead with the same email, so
 * nothing more goes to that address from this feature. Idempotent. Throws on a failed write.
 */
export async function optOutLeadByToken(db: Db, rawToken: string): Promise<'opted_out' | 'not_found'> {
  if (typeof rawToken !== 'string' || !RAW_TOKEN_PATTERN.test(rawToken)) return 'not_found'

  const { data, error } = await db
    .from('table_booking_leads')
    .update({ follow_up_opt_out: true })
    .eq('opt_out_token_hash', hashGuestToken(rawToken))
    .select('email')
  if (error) throw error
  const email = (data as Array<{ email: string | null }> | null)?.[0]?.email ?? null
  if (!data || data.length === 0) return 'not_found'

  if (email) {
    const { error: othersError } = await db
      .from('table_booking_leads')
      .update({ follow_up_opt_out: true })
      .eq('email', email)
      .eq('source', LEAD_SOURCE_WEBSITE)
      .select('id')
    if (othersError) throw othersError
  }
  return 'opted_out'
}
