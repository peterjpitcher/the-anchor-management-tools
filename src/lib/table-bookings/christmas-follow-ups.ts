import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/email/emailService'
import { currentEmailSuspensionReason } from '@/lib/email/suspension'
import { getOrCreateUnsubscribeUrl } from '@/lib/email/unsubscribe'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { generateGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { formatTimeInLondon, shiftIsoDate, startOfLondonDayUtc, toLocalIsoDate } from '@/lib/dateUtils'
import {
  CHRISTMAS_PAGE_URL,
  LEAD_SOURCE_WEBSITE,
  buildLeadOptOutUrl,
  buildResumeUrl,
  describeDbError,
  findChristmasBookingHolders,
  isStillBookableOnline,
  resumeLinkExpiresAt,
} from '@/lib/table-bookings/christmas-leads'
import { buildChristmasFollowUpEmail, christmasFollowUpProblem } from '@/lib/table-bookings/christmas-follow-up-email'

/**
 * The one follow-up email to somebody who started a Christmas dinner booking online and did not
 * finish (Christmas funnel spec, owner decisions 5 and 8 of 10 November 2026), run by
 * api/cron/christmas-follow-ups.
 *
 * The cron is scheduled at 09:00 and 10:00 UTC and acts only on the run that falls at 10:00 London,
 * so the email goes at 10:00 London in winter and in summer time.
 *
 * A lead is emailed once, and only when ALL of these hold:
 *  - it came from the website, and was saved before today (London);
 *  - the guest did not tick the opt-out, and it has no linked booking and has never been claimed;
 *  - its date is at least 8 days away and can still be booked online now (the period's notice);
 *    nearer than that it is left for staff on the Christmas follow-ups tab;
 *  - nobody with that email or mobile holds a Christmas booking that is not cancelled in that
 *    period;
 *  - the customer, found by id or by address, has not unsubscribed from our marketing email;
 *  - no follow-up has gone to that email this season: checked on the leads (and enforced by a unique
 *    index on the claim) and in the email log, which outlives a lead deleted after 30 days.
 *
 * Leads are read a page at a time, oldest first, so a run of skipped leads never hides the ones
 * behind them; at most 100 are claimed in a run.
 *
 * THE CLAIM IS THE IDEMPOTENCY. Each lead is claimed with a conditional update that returns the row,
 * before anything is sent, and the claim is never released. A send that was refused, or whose
 * outcome is unknown, is recorded and never retried automatically. The provider idempotency key
 * `christmas-lead-follow-up:<lead id>` stops a retry inside one run sending twice.
 *
 * Email only, never a text. Honours the messaging flag christmas_lead_follow_up and the email kill
 * switches: while SUSPEND_ALL_EMAIL or SUSPEND_ALL_COMMS is on, nothing is claimed, so the leads
 * wait for the next run. The same run deletes leads whose date is more than 30 days past, whatever
 * the flag says. No email to the owner on success.
 */

// `any` matches the untyped admin client the crons pass around.
type Db = SupabaseClient<any, 'public', any>

export const FOLLOW_UP_FLAG = 'christmas_lead_follow_up'
export const FOLLOW_UP_LONDON_HOUR = 10
/** Online Christmas bookings need 8 days' notice (192 hours, christmas-2026). */
export const FOLLOW_UP_MIN_DAYS_AHEAD = 8
export const LEAD_RETENTION_DAYS = 30
/** A ceiling on one run, so a flood of junk leads can never become a flood of email. */
export const FOLLOW_UP_MAX_PER_RUN = 100
/**
 * Leads are read a page at a time, oldest first, so leads that are skipped (booked another way,
 * already followed up) never hide the ones behind them. The scan itself is bounded too.
 */
export const FOLLOW_UP_SCAN_PAGE = 100
export const FOLLOW_UP_MAX_SCANNED = 1000
export const FOLLOW_UP_COMM_TYPE = 'christmas_lead_follow_up'

export function followUpIdempotencyKey(leadId: string): string {
  return `christmas-lead-follow-up:${leadId}`
}

/** True on the run that falls at 10:00 London. */
export function isFollowUpHour(now: Date): boolean {
  return Number(formatTimeInLondon(now).slice(0, 2)) === FOLLOW_UP_LONDON_HOUR
}

type LeadRow = {
  id: string
  booking_period_id: string
  customer_id: string | null
  first_name: string
  email: string | null
  mobile_e164: string | null
  booking_date: string
  booking_time: string
  party_size: number
}

type PeriodRow = {
  id: string
  starts_on: string
  ends_on: string
  min_notice_hours: number | null
  deposit_basis: string | null
  deposit_amount: number | string | null
  is_active: boolean
  archived_at: string | null
}

export type FollowUpSkipReason =
  | 'not_bookable_online'
  | 'period_closed'
  | 'already_booked'
  | 'already_followed_up'
  | 'claimed_elsewhere'
  | 'missing_details'
  | 'customer_unsubscribed'

export type FollowUpRunResult =
  | { state: 'not_due'; londonTime: string }
  | {
      state: 'ran'
      flag: 'on' | 'off'
      held: 'email_suspended' | null
      deleted: number
      considered: number
      sent: number
      refused: number
      uncertain: number
      skipped: Partial<Record<FollowUpSkipReason, number>>
      /** Database faults: a lead not checked, not claimed or not marked. */
      errors: number
    }

export type FollowUpDeps = {
  db: Db
  now?: Date
  /** Defaults to the real sendEmail; tests pass a fake. */
  send?: typeof sendEmail
  flagOn?: () => Promise<boolean>
  suspended?: () => boolean
}

async function deleteOldLeads(db: Db, today: string): Promise<{ deleted: number; failed: boolean }> {
  const cutoff = shiftIsoDate(today, -LEAD_RETENTION_DAYS)
  if (!cutoff) return { deleted: 0, failed: true }
  const { error, count } = await db
    .from('table_booking_leads')
    .delete({ count: 'exact' })
    .lt('booking_date', cutoff)
  if (error) {
    logger.error('Christmas follow-ups: old leads could not be deleted', {
      error: new Error(describeDbError(error).message),
      metadata: describeDbError(error),
    })
    return { deleted: 0, failed: true }
  }
  return { deleted: count ?? 0, failed: false }
}

/**
 * Everyone who has unsubscribed from our marketing email, by customer and by address. Read in full
 * (it is a short list) and compared in code, because customers.email is not stored lower case.
 */
async function readMarketingEmailOptOuts(db: Db): Promise<{ customerIds: Set<string>; emails: Set<string> }> {
  const { data, error } = await db
    .from('customers')
    .select('id, email')
    .not('marketing_email_opted_out_at', 'is', null)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; email: string | null }>
  return {
    customerIds: new Set(rows.map((row) => row.id)),
    emails: new Set(rows.map((row) => row.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email))),
  }
}

/**
 * Whether this address has already had the follow-up for this period. The leads table is the
 * first check (and its unique index the hard guard), but a lead is deleted 30 days after its date,
 * so the email log, which outlives it, is checked as well: deleting an early lead must not let a
 * later lead in the same season have a second email.
 */
async function alreadyFollowedUp(db: Db, lead: LeadRow & { email: string }): Promise<boolean> {
  const { data: earlier, error: earlierError } = await db
    .from('table_booking_leads')
    .select('id')
    .eq('booking_period_id', lead.booking_period_id)
    .eq('email', lead.email)
    .not('follow_up_claimed_at', 'is', null)
    .limit(1)
  if (earlierError) throw earlierError
  if ((earlier ?? []).length > 0) return true

  const { data: logged, error: loggedError } = await db
    .from('email_messages')
    .select('id, metadata')
    .eq('comm_type', FOLLOW_UP_COMM_TYPE)
    .eq('to_address', lead.email)
  if (loggedError) throw loggedError
  return ((logged ?? []) as Array<{ metadata: Record<string, unknown> | null }>).some(
    (row) => row.metadata?.booking_period_id === lead.booking_period_id,
  )
}

function depositPerHead(period: PeriodRow): number {
  if (period.deposit_basis !== 'per_head') return Number.NaN
  return Number(period.deposit_amount)
}

export async function runChristmasLeadFollowUps(deps: FollowUpDeps): Promise<FollowUpRunResult> {
  const now = deps.now ?? new Date()
  if (!isFollowUpHour(now)) return { state: 'not_due', londonTime: formatTimeInLondon(now) }

  const db = deps.db
  const send = deps.send ?? sendEmail
  const today = toLocalIsoDate(now)
  const nowIso = now.toISOString()
  const result: Extract<FollowUpRunResult, { state: 'ran' }> = {
    state: 'ran',
    flag: 'off',
    held: null,
    deleted: 0,
    considered: 0,
    sent: 0,
    refused: 0,
    uncertain: 0,
    skipped: {},
    errors: 0,
  }
  const skip = (reason: FollowUpSkipReason) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
  }

  // Retention first, whatever the flag: personal data goes 30 days after the date.
  const retention = await deleteOldLeads(db, today)
  result.deleted = retention.deleted
  if (retention.failed) result.errors += 1

  const flagOn = deps.flagOn ? await deps.flagOn() : await isMessagingFlagOn(FOLLOW_UP_FLAG)
  if (!flagOn) return result
  result.flag = 'on'

  // A kill switch holds the leads rather than burning their one claim on a refused send.
  if (deps.suspended ? deps.suspended() : currentEmailSuspensionReason() !== null) {
    result.held = 'email_suspended'
    return result
  }

  const earliestDate = shiftIsoDate(today, FOLLOW_UP_MIN_DAYS_AHEAD)
  if (!earliestDate) {
    result.errors += 1
    return result
  }

  const optedOut = await readMarketingEmailOptOuts(db)
  const periods = new Map<string, PeriodRow>()
  const seen = new Set<string>()
  let attempts = 0
  let cursor: string | null = null

  while (attempts < FOLLOW_UP_MAX_PER_RUN && seen.size < FOLLOW_UP_MAX_SCANNED) {
    let query = db
      .from('table_booking_leads')
      .select('id, booking_period_id, customer_id, first_name, email, mobile_e164, booking_date, booking_time, party_size, created_at')
      .eq('source', LEAD_SOURCE_WEBSITE)
      .eq('follow_up_opt_out', false)
      .is('table_booking_id', null)
      .is('follow_up_claimed_at', null)
      .lt('created_at', startOfLondonDayUtc(now).toISOString())
      .gte('booking_date', earliestDate)
    // Keyset paging on created_at. gte, not gt, so leads saved in the same instant are not lost
    // across a page boundary; the ones already read are dropped by id.
    if (cursor) query = query.gte('created_at', cursor)
    const { data: pageRows, error: leadsError } = await query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(FOLLOW_UP_SCAN_PAGE)
    if (leadsError) throw leadsError
    const rawPage = (pageRows ?? []) as Array<LeadRow & { created_at: string }>
    const leads = rawPage.filter((lead) => !seen.has(lead.id))
    if (leads.length === 0) break
    for (const lead of leads) seen.add(lead.id)
    cursor = rawPage[rawPage.length - 1].created_at
    result.considered += leads.length

    const newPeriodIds = Array.from(new Set(leads.map((lead) => lead.booking_period_id))).filter((id) => !periods.has(id))
    if (newPeriodIds.length > 0) {
      const { data: periodRows, error: periodsError } = await db
        .from('booking_periods')
        .select('id, starts_on, ends_on, min_notice_hours, deposit_basis, deposit_amount, is_active, archived_at')
        .in('id', newPeriodIds)
      if (periodsError) throw periodsError
      for (const period of (periodRows ?? []) as PeriodRow[]) periods.set(period.id, period)
    }

    // Who already holds a Christmas booking, per period, read once for each page.
    const holders = new Map<string, { emails: Set<string>; mobiles: Set<string> }>()
    for (const period of periods.values()) {
      const contacts = leads
        .filter((lead) => lead.booking_period_id === period.id)
        .map((lead) => ({ email: lead.email, mobile: lead.mobile_e164 }))
      if (contacts.length === 0) continue
      holders.set(period.id, await findChristmasBookingHolders(db, contacts, { startsOn: period.starts_on, endsOn: period.ends_on }))
    }

    for (const lead of leads) {
      if (attempts >= FOLLOW_UP_MAX_PER_RUN) break
      const period = periods.get(lead.booking_period_id)
      if (!period || !period.is_active || period.archived_at) {
        skip('period_closed')
        continue
      }
      if (!isStillBookableOnline(lead.booking_date, lead.booking_time, period.min_notice_hours, now)) {
        skip('not_bookable_online')
        continue
      }
      const booked = holders.get(period.id)
      if (
        (lead.email && booked?.emails.has(lead.email)) ||
        (lead.mobile_e164 && booked?.mobiles.has(lead.mobile_e164))
      ) {
        skip('already_booked')
        continue
      }
      const deposit = depositPerHead(period)
      if (
        !lead.email ||
        christmasFollowUpProblem({
          firstName: lead.first_name,
          partySize: lead.party_size,
          bookingDate: lead.booking_date,
          depositPerHeadGbp: deposit,
        })
      ) {
        skip('missing_details')
        continue
      }

      if ((lead.customer_id && optedOut.customerIds.has(lead.customer_id)) || optedOut.emails.has(lead.email)) {
        skip('customer_unsubscribed')
        continue
      }

      try {
        // One follow-up per email per season. The unique index on the claim is the real guard;
        // this read keeps the expected case out of the error log and covers deleted leads.
        if (await alreadyFollowedUp(db, { ...lead, email: lead.email })) {
          skip('already_followed_up')
          continue
        }

        const resumeExpiresAt = resumeLinkExpiresAt(lead.booking_date)
        if (!resumeExpiresAt) {
          skip('missing_details')
          continue
        }
        const resumeToken = generateGuestToken()
        const optOutToken = generateGuestToken()

        // The claim: written before anything is sent, never released.
        const { data: claimed, error: claimError } = await db
          .from('table_booking_leads')
          .update({
            follow_up_claimed_at: nowIso,
            resume_token_hash: hashGuestToken(resumeToken),
            resume_token_expires_at: resumeExpiresAt,
            opt_out_token_hash: hashGuestToken(optOutToken),
          })
          .eq('id', lead.id)
          .is('follow_up_claimed_at', null)
          .is('table_booking_id', null)
          .eq('follow_up_opt_out', false)
          .select('id')
          .maybeSingle()
        if (claimError) {
          if ((claimError as { code?: string }).code === '23505') {
            skip('already_followed_up')
            continue
          }
          throw claimError
        }
        if (!claimed) {
          skip('claimed_elsewhere')
          continue
        }
        attempts += 1

        const resumeUrl = buildResumeUrl(resumeToken)
        const optOutUrl = buildLeadOptOutUrl(optOutToken)
        const customerUnsubscribeUrl = lead.customer_id ? await getOrCreateUnsubscribeUrl(db, lead.customer_id) : null
        const unsubscribeUrl = customerUnsubscribeUrl ?? optOutUrl

        const email = buildChristmasFollowUpEmail({
          firstName: lead.first_name,
          partySize: lead.party_size,
          bookingDate: lead.booking_date,
          depositPerHeadGbp: deposit,
          resumeUrl,
          christmasPageUrl: CHRISTMAS_PAGE_URL,
          unsubscribeUrl,
        })

        const sent = await send({
          to: lead.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          commType: FOLLOW_UP_COMM_TYPE,
          customerId: lead.customer_id,
          idempotencyKey: followUpIdempotencyKey(lead.id),
          unsubscribeUrl,
          // The raw tokens never reach the email log.
          logRedactions: [resumeToken, optOutToken],
          metadata: { lead_id: lead.id, booking_period_id: lead.booking_period_id, template_key: FOLLOW_UP_COMM_TYPE },
        })

        const outcome = sent.success ? 'sent' : sent.uncertain ? 'uncertain' : 'refused'
        if (outcome === 'sent') result.sent += 1
        else if (outcome === 'uncertain') result.uncertain += 1
        else result.refused += 1

        if (!sent.success) {
          logger.error('Christmas follow-up email did not go; it will not be retried automatically', {
            error: new Error(sent.error ?? 'Email send failed'),
            metadata: {
              leadId: lead.id,
              code: sent.code ?? null,
              providerStatus: sent.providerStatus ?? null,
              uncertain: sent.uncertain === true,
            },
          })
        }

        const { error: markError } = await db
          .from('table_booking_leads')
          .update({ follow_up_outcome: outcome, ...(sent.success ? { follow_up_sent_at: nowIso } : {}) })
          .eq('id', lead.id)
        if (markError) {
          // The claim stands, so nothing is sent again; only the outcome is missing.
          result.errors += 1
          logger.error('Christmas follow-up outcome could not be recorded', {
            error: new Error(describeDbError(markError).message),
            metadata: { leadId: lead.id, outcome, ...describeDbError(markError) },
          })
        }
      } catch (error) {
        result.errors += 1
        logger.error('Christmas follow-up could not be processed for a lead', {
          error: error instanceof Error ? error : new Error(describeDbError(error).message),
          metadata: { leadId: lead.id, ...describeDbError(error) },
        })
      }
    }

    if (rawPage.length < FOLLOW_UP_SCAN_PAGE) break
  }

  return result
}
