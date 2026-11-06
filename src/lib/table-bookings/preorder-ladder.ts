/**
 * Sends the Christmas food choices reminder ladder (owner decisions D6 and D7, 6 November 2026) for
 * the bookings the pre-order cron hands it: every booking that requires a pre-order and records a
 * course tier per guest. Bookings with no tiers stay on the first release's rule in the cron.
 *
 * WHICH MESSAGE IS DUE IS NOT DECIDED HERE. `decidePreorderChases` owns that, from the clock, the
 * cutoff, when the booking was made, whether the order is complete and what the ledger already
 * holds, so the same answer comes out whichever of the two daily runs (09:00 and 12:00) asks.
 *
 * THE LEDGER IS THE IDEMPOTENCY. Each message is claimed in `booking_preorder_reminders` BEFORE it is
 * sent: one row per booking and kind, and per seat for a guest reminder, enforced by the table's two
 * unique indexes. A duplicate key means another run already has it, so two runs racing, or one run
 * twice, send nothing more.
 *
 * A FAILED SEND DOES NOT KEEP ITS ROW. When nothing reached anyone, the claim is deleted, the failure
 * is logged as an error, written to the audit log and returned to the cron, which reports it, and
 * the next run tries again. Two cases keep the row, because sending again could duplicate a message
 * that did arrive: one channel of an email-and-text rung went and the other did not (counted as
 * partial and reported), and an email whose provider gave no definite answer (`uncertain`).
 *
 * Texts go through `sendSMS`, which applies the suspension switches, the guest's STOP and SMS
 * status, the safety limits, duplicate protection, quiet hours and the GSM-7 clean-up, exactly as
 * every other table booking text does. Nothing here is sent unless the stage has that channel: an
 * organiser with no usable email gets texts only on the two rungs that have one.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { withBookingContactEmail } from '@/lib/bookings/contact-email'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import { logger } from '@/lib/logger'
import { isEmailUsable } from '@/lib/notifications/channel'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { AuditService } from '@/services/audit'
import { GUEST_CHANNEL_COLUMNS, type GuestChannelCustomer } from '@/lib/table-bookings/guest-notify'
import { createTableManageToken } from '@/lib/table-bookings/manage-booking'
import {
  decidePreorderChases,
  describePreorderGaps,
  getPreorderCompleteness,
  getPreorderLadderStages,
  getSeatCourseCount,
  isCoverComplete,
  loadPreorderOrder,
  type PreorderChase,
  type PreorderChaseSeat,
  type PreorderCompleteness,
} from '@/lib/table-bookings/preorder'
import { PREORDER_MANAGER_EMAIL } from '@/lib/table-bookings/preorder-alerts'
import { createPreorderGuestToken } from '@/lib/table-bookings/preorder-guest-token'
import {
  PREORDER_GUEST_REMINDER_TEMPLATE_KEY,
  PREORDER_ORGANISER_TEMPLATE_KEY,
  PREORDER_TEXT_STAGES,
  buildGuestReminderEmail,
  buildManagerCallListEmail,
  buildOrganiserChaseEmail,
  buildOrganiserChaseText,
  describeChoicesDeadline,
  describeMissingGuests,
  guestLabel,
  type ManagerCallListBooking,
} from '@/lib/table-bookings/preorder-reminder-messages'
import type { PreorderOrder, PreorderOrganiserStage, PreorderReminderKind } from '@/types/preorders'

type Db = SupabaseClient<any, 'public', any>

/** A booking as the cron reads it. */
export type LadderBooking = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  customer_id: string | null
  booking_period_id: string | null
  booking_period_name: string | null
  christmas_course_counts: number[] | null
  created_at: string | null
}

/** A ledger row as the cron reads it. */
export type LadderLedgerRow = {
  table_booking_id: string
  kind: string
  cover_id?: string | null
  sent_at?: string | null
}

/** One message that did not go, for the cron's report. Ids and kinds only: no names or addresses. */
export type LadderFailure = {
  bookingId: string
  reference: string
  /** The message, or 'read_order' when the booking's order could not be read at all. */
  kind: PreorderReminderKind | 'read_order'
  coverId?: string
  /** 'failed' sent nothing and released its claim; 'partial' and 'uncertain' kept it. */
  outcome: 'failed' | 'partial' | 'uncertain'
  error: string
}

export type LadderResult = {
  /** Bookings looked at. */
  checked: number
  alreadyComplete: number
  /** Nothing due this run, or already claimed by another run. */
  skipped: number
  organiserEmails: number
  organiserTexts: number
  /** Bookings on the owner's call list this run, and whether that one email went. */
  managerCallListBookings: number
  managerEmails: number
  guestReminders: number
  /** Due, but there was no channel the stage allows (no usable email, and no text on this rung). */
  noChannel: number
  shortLinkFallbacks: number
  failed: number
  partial: number
  failures: LadderFailure[]
}

export function emptyLadderResult(): LadderResult {
  return {
    checked: 0,
    alreadyComplete: 0,
    skipped: 0,
    organiserEmails: 0,
    organiserTexts: 0,
    managerCallListBookings: 0,
    managerEmails: 0,
    guestReminders: 0,
    noChannel: 0,
    shortLinkFallbacks: 0,
    failed: 0,
    partial: 0,
    failures: [],
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * Take the one slot for this message. Returns the row id, or null when another run already holds
 * it. Any other database error is thrown: sending without a ledger row is how a guest gets the same
 * message every run.
 */
async function claim(
  supabase: Db,
  tableBookingId: string,
  kind: PreorderReminderKind,
  coverId: string | null = null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('booking_preorder_reminders')
    .insert({ table_booking_id: tableBookingId, kind, cover_id: coverId })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
  const id = (data as { id?: string } | null)?.id
  if (!id) throw new Error('The reminder ledger row was written without an id')
  return id
}

/** Give a claim back after a send that reached nobody, so the next run tries again. */
async function release(supabase: Db, rowId: string): Promise<void> {
  const { error } = await supabase.from('booking_preorder_reminders').delete().eq('id', rowId)
  if (error) {
    // The message did not go and will not be retried. Loud, because nobody else will notice.
    logger.error('Could not release a pre-order reminder claim after a failed send', {
      error: new Error(error.message),
      metadata: { rowId },
    })
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type Organiser = {
  customer: GuestChannelCustomer
  firstName: string
  fullName: string
  phone: string | null
}

async function loadOrganiser(supabase: Db, booking: LadderBooking): Promise<Organiser | null> {
  if (!booking.customer_id) return null
  const { data, error } = await supabase
    .from('customers')
    .select(GUEST_CHANNEL_COLUMNS)
    .eq('id', booking.customer_id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  // The email the organiser typed for this booking, when it differs from the customer's (BK-078).
  const customer = await withBookingContactEmail(supabase, 'table_bookings', booking.id, data as unknown as GuestChannelCustomer)
  return {
    customer,
    firstName: getSmartFirstName(customer.first_name),
    fullName: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'the organiser',
    phone: customer.mobile_e164 || customer.mobile_number || null,
  }
}

/** The seats the guest rule reads: each cover, whether it is complete, and when its invite went. */
function chaseSeats(order: PreorderOrder): PreorderChaseSeat[] {
  return order.covers.map((cover) => ({
    coverId: cover.id,
    ordinal: cover.ordinal,
    inviteSentAt: cover.inviteSentAt ?? null,
    complete: isCoverComplete({
      selections: cover.selections,
      courseCount: getSeatCourseCount(order, cover.ordinal),
      guestName: cover.guestName,
      hasAllergies: cover.hasAllergies ?? null,
      allergyDetail: cover.allergyDetail ?? null,
    }),
  }))
}

/**
 * The ledger rows for one booking as the ladder reads them. A legacy `booker_reminder` was the
 * first release's 10 day chase, so it stands in for `booker_10d`: a booking chased under the old
 * rule just before this change is not asked the same thing again the next day.
 */
function sentFor(rows: LadderLedgerRow[]): Array<{ kind: string; coverId: string | null }> {
  const sent = rows.map((row) => ({ kind: row.kind, coverId: row.cover_id ?? null }))
  if (sent.some((row) => row.kind === 'booker_reminder' && !row.coverId)) sent.push({ kind: 'booker_10d', coverId: null })
  return sent
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type SendContext = {
  supabase: Db
  now: Date
  appBaseUrl?: string
  result: LadderResult
}

function recordFailure(ctx: SendContext, failure: LadderFailure): void {
  if (failure.outcome === 'partial') ctx.result.partial += 1
  else ctx.result.failed += 1
  ctx.result.failures.push(failure)
  logger.error('Pre-order reminder was not delivered in full', {
    error: new Error(failure.error),
    metadata: { ...failure },
  })
}

async function audit(
  booking: LadderBooking,
  kind: PreorderReminderKind,
  delivered: boolean,
  details: Record<string, unknown>,
  error?: string,
): Promise<void> {
  try {
    await AuditService.logAuditEvent({
      operation_type: delivered ? 'table_booking.notification_sent' : 'table_booking.notification_failed',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: delivered ? 'success' : 'failure',
      error_message: delivered ? undefined : error,
      additional_info: { comm_type: PREORDER_ORGANISER_TEMPLATE_KEY, stage: kind, booking_reference: booking.booking_reference, ...details },
    })
  } catch (auditError) {
    logger.error('Could not write the audit row for a pre-order reminder', {
      error: auditError instanceof Error ? auditError : new Error(String(auditError)),
      metadata: { bookingId: booking.id, kind },
    })
  }
}

async function sendOrganiserChase(
  ctx: SendContext,
  booking: LadderBooking,
  stage: PreorderOrganiserStage,
  organiser: Organiser | null,
  completeness: PreorderCompleteness,
  cutoffAt: Date,
): Promise<void> {
  const { supabase, result } = ctx
  if (!organiser) {
    result.noChannel += 1
    logger.warn('Pre-order reminder due but the booking has no customer', { metadata: { bookingId: booking.id, stage } })
    return
  }

  // Which channels this rung may use and this organiser can receive, decided before the claim so a
  // message that can reach nobody never takes a ledger row.
  const email = organiser.customer.email
  const wantsEmail = isEmailUsable(organiser.customer) && !(await isEmailSuppressed(email as string))
  const wantsText =
    PREORDER_TEXT_STAGES.has(stage) &&
    organiser.phone !== null &&
    (await isCustomerSmsSendAllowed(organiser.customer.id, organiser.phone)).allowed
  if (!wantsEmail && !wantsText) {
    result.noChannel += 1
    logger.warn('Pre-order reminder due but no channel this stage allows can reach the organiser', {
      metadata: { bookingId: booking.id, stage },
    })
    return
  }

  const claimId = await claim(supabase, booking.id, stage)
  if (!claimId) {
    result.skipped += 1
    return
  }

  let emailSent = false
  let emailUncertain = false
  let textSent = false
  const errors: string[] = []

  try {
    const token = await createTableManageToken(supabase, {
      customerId: organiser.customer.id,
      tableBookingId: booking.id,
      // The booking's own start, so the link lives until the sitting.
      bookingStartIso: booking.start_datetime,
      appBaseUrl: ctx.appBaseUrl,
    })
    // Shortened once so the email and the text carry the same link.
    const link = await buildGuestShortLink({
      longUrl: token.url,
      linkKind: 'table_manage',
      customerId: organiser.customer.id,
      tableBookingId: booking.id,
    })
    if (!link.shortened) result.shortLinkFallbacks += 1

    const facts = {
      stage,
      firstName: organiser.firstName,
      bookingReference: booking.booking_reference,
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time,
      startDateTime: booking.start_datetime,
      partySize: booking.party_size,
      missing: describeMissingGuests(completeness),
      deadline: describeChoicesDeadline(cutoffAt, ctx.now),
      foodLink: link.url,
    }

    if (wantsEmail) {
      const message = buildOrganiserChaseEmail(facts)
      const sent = await sendEmail({
        to: email as string,
        subject: message.subject,
        html: message.html,
        text: message.text,
        customerId: organiser.customer.id,
        tableBookingId: booking.id,
        commType: PREORDER_ORGANISER_TEMPLATE_KEY,
        idempotencyKey: `${PREORDER_ORGANISER_TEMPLATE_KEY}:${booking.id}:${stage}`,
        metadata: { table_booking_id: booking.id, template_key: PREORDER_ORGANISER_TEMPLATE_KEY, stage },
      })
      emailSent = sent.success
      emailUncertain = !sent.success && sent.uncertain === true
      if (!sent.success) errors.push(`email: ${sent.error ?? sent.code ?? 'not sent'}`)
    }

    if (wantsText) {
      const sent = await sendSMS(organiser.phone as string, buildOrganiserChaseText(facts), {
        customerId: organiser.customer.id,
        metadata: { table_booking_id: booking.id, template_key: PREORDER_ORGANISER_TEMPLATE_KEY, stage },
      })
      textSent = sent.success === true
      if (!textSent) errors.push(`text: ${sent.error ?? 'not sent'}`)
    }
  } catch (error) {
    errors.push(describeError(error))
  }

  if (emailSent) result.organiserEmails += 1
  if (textSent) result.organiserTexts += 1
  const delivered = emailSent || textSent
  await audit(booking, stage, delivered, { email_sent: emailSent, sms_sent: textSent }, errors.join('; ') || undefined)

  if (delivered && errors.length === 0) return
  if (delivered || emailUncertain) {
    // Something may have arrived, so the row stays and nothing is sent twice.
    recordFailure(ctx, {
      bookingId: booking.id,
      reference: booking.booking_reference,
      kind: stage,
      outcome: delivered ? 'partial' : 'uncertain',
      error: errors.join('; '),
    })
    return
  }
  await release(supabase, claimId)
  recordFailure(ctx, {
    bookingId: booking.id,
    reference: booking.booking_reference,
    kind: stage,
    outcome: 'failed',
    error: errors.join('; ') || 'Nothing was sent',
  })
}

async function sendGuestReminder(
  ctx: SendContext,
  booking: LadderBooking,
  order: PreorderOrder,
  completeness: PreorderCompleteness,
  chase: Extract<PreorderChase, { audience: 'guest' }>,
  organiser: Organiser | null,
  cutoffAt: Date,
): Promise<void> {
  const { supabase, result } = ctx
  const cover = order.covers.find((entry) => entry.id === chase.coverId)
  const address = cover?.inviteEmail?.trim() || null
  // The address is cleared after the booking (A4), and a seat may have had it removed since.
  if (!cover || !address || (await isEmailSuppressed(address))) {
    result.noChannel += 1
    return
  }
  if (!booking.customer_id) {
    recordFailure(ctx, {
      bookingId: booking.id,
      reference: booking.booking_reference,
      kind: 'guest_reminder',
      coverId: cover.id,
      outcome: 'failed',
      error: 'The booking has no customer to own the guest link',
    })
    return
  }

  const claimId = await claim(supabase, booking.id, 'guest_reminder', cover.id)
  if (!claimId) {
    result.skipped += 1
    return
  }

  let error: string | null = null
  let uncertain = false
  try {
    // Only the hash of the invite's token is stored, so it cannot be read back. A fresh link is
    // made for the reminder; the invite's link stays valid until the cutoff as well.
    const token = await createPreorderGuestToken(supabase, {
      customerId: booking.customer_id,
      tableBookingId: booking.id,
      coverId: cover.id,
      expiresAt: cutoffAt.toISOString(),
      appBaseUrl: ctx.appBaseUrl,
    })
    const gap = completeness.seatsIncomplete.find((entry) => entry.ordinal === cover.ordinal)
    const message = buildGuestReminderEmail({
      guestFirstName: cover.guestName?.trim() ? guestLabel(cover.ordinal, cover.guestName) : null,
      organiserFirstName: organiser?.firstName ?? 'there',
      bookingDate: booking.booking_date,
      bookingTime: booking.booking_time,
      startDateTime: booking.start_datetime,
      missing: gap?.missing ?? null,
      deadline: describeChoicesDeadline(cutoffAt, ctx.now),
      link: token.url,
    })
    const sent = await sendEmail({
      to: address,
      subject: message.subject,
      html: message.html,
      text: message.text,
      tableBookingId: booking.id,
      commType: PREORDER_GUEST_REMINDER_TEMPLATE_KEY,
      idempotencyKey: `${PREORDER_GUEST_REMINDER_TEMPLATE_KEY}:${booking.id}:${cover.id}`,
      // The link is the guest's key to their seat: whoever reads the log must not be able to use it.
      logRedactions: [token.url, token.rawToken],
      metadata: { table_booking_id: booking.id, template_key: PREORDER_GUEST_REMINDER_TEMPLATE_KEY, cover_id: cover.id },
    })
    if (!sent.success) {
      error = sent.error ?? sent.code ?? 'not sent'
      uncertain = sent.uncertain === true
    }
  } catch (thrown) {
    error = describeError(thrown)
  }

  if (error === null) {
    result.guestReminders += 1
    const { error: stampError } = await supabase
      .from('booking_preorder_covers')
      .update({ invite_reminded_at: ctx.now.toISOString() })
      .eq('id', cover.id)
    if (stampError) {
      logger.error('Guest reminder sent but invite_reminded_at was not set', {
        error: new Error(stampError.message),
        metadata: { bookingId: booking.id, coverId: cover.id },
      })
    }
    return
  }

  if (!uncertain) await release(supabase, claimId)
  recordFailure(ctx, {
    bookingId: booking.id,
    reference: booking.booking_reference,
    kind: 'guest_reminder',
    coverId: cover.id,
    outcome: uncertain ? 'uncertain' : 'failed',
    error,
  })
}

type ManagerItem = {
  booking: LadderBooking
  organiser: Organiser | null
  completeness: PreorderCompleteness
  cutoffAt: Date
}

/** One email for every booking whose call-list stage is due this run, each claimed once. */
async function sendManagerCallList(ctx: SendContext, items: ManagerItem[]): Promise<void> {
  const { supabase, result } = ctx
  const claimed: Array<ManagerItem & { claimId: string }> = []
  for (const item of items) {
    try {
      const claimId = await claim(supabase, item.booking.id, 'manager_day_before')
      if (claimId) claimed.push({ ...item, claimId })
      else result.skipped += 1
    } catch (error) {
      recordFailure(ctx, {
        bookingId: item.booking.id,
        reference: item.booking.booking_reference,
        kind: 'manager_day_before',
        outcome: 'failed',
        error: describeError(error),
      })
    }
  }
  if (claimed.length === 0) return

  const bookings: ManagerCallListBooking[] = claimed.map((item) => ({
    bookingReference: item.booking.booking_reference,
    bookingDate: item.booking.booking_date,
    bookingTime: item.booking.booking_time,
    partySize: item.booking.party_size,
    organiserName: item.organiser?.fullName ?? 'the organiser',
    organiserPhone: item.organiser?.phone ?? null,
    gaps: describePreorderGaps(item.completeness),
    deadline: describeChoicesDeadline(item.cutoffAt, ctx.now),
  }))

  let error: string | null = null
  let uncertain = false
  try {
    const message = buildManagerCallListEmail(bookings)
    const sent = await sendEmail({ to: PREORDER_MANAGER_EMAIL, subject: message.subject, html: message.html, text: message.text })
    if (!sent.success) {
      error = sent.error ?? sent.code ?? 'not sent'
      uncertain = sent.uncertain === true
    }
  } catch (thrown) {
    error = describeError(thrown)
  }

  if (error === null) {
    result.managerEmails += 1
    result.managerCallListBookings += claimed.length
    return
  }
  for (const item of claimed) {
    if (!uncertain) await release(supabase, item.claimId)
    recordFailure(ctx, {
      bookingId: item.booking.id,
      reference: item.booking.booking_reference,
      kind: 'manager_day_before',
      outcome: uncertain ? 'uncertain' : 'failed',
      error,
    })
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Send whatever the ladder says is due for these bookings at `now`. Never throws for one booking:
 * a booking that cannot be read or sent is recorded in `failures` and the run moves on.
 */
export async function runPreorderLadder(
  supabase: Db,
  input: {
    now: Date
    bookings: LadderBooking[]
    ledger: LadderLedgerRow[]
    /** Each period's `preorder_cutoff_days`. */
    cutoffByPeriod: ReadonlyMap<string, number>
    appBaseUrl?: string
  },
): Promise<LadderResult> {
  const result = emptyLadderResult()
  const ctx: SendContext = { supabase, now: input.now, appBaseUrl: input.appBaseUrl, result }
  const managerItems: ManagerItem[] = []

  const ledgerByBooking = new Map<string, LadderLedgerRow[]>()
  for (const row of input.ledger) {
    const rows = ledgerByBooking.get(row.table_booking_id)
    if (rows) rows.push(row)
    else ledgerByBooking.set(row.table_booking_id, [row])
  }

  for (const booking of input.bookings) {
    result.checked += 1
    const cutoffDays = booking.booking_period_id ? input.cutoffByPeriod.get(booking.booking_period_id) ?? null : null
    const sent = sentFor(ledgerByBooking.get(booking.id) ?? [])
    const base = {
      now: input.now,
      bookingDate: booking.booking_date,
      preorderCutoffDays: cutoffDays,
      bookingCreatedAt: booking.created_at,
      sent,
    }

    // A cheap first look, before the order is read: as if the order were incomplete. Nothing due on
    // that reading means nothing is due at all, unless the guest reminders' rung has been reached.
    const firstLook = decidePreorderChases({ ...base, complete: false })
    const guestRung = getPreorderLadderStages(base).find((stage) => stage.kind === 'booker_day_before')
    const guestRungReached = guestRung !== undefined && guestRung.dueAt.getTime() <= input.now.getTime()
    if (firstLook.locked || !firstLook.cutoffAt || (firstLook.due.length === 0 && !guestRungReached)) {
      result.skipped += 1
      continue
    }

    try {
      const order = await loadPreorderOrder(supabase, booking.id)
      if (!order || !order.requiresPreorder) {
        result.skipped += 1
        continue
      }

      const completeness = getPreorderCompleteness(order)
      const decision = decidePreorderChases({ ...base, complete: completeness.complete, seats: chaseSeats(order) })
      if (decision.due.length === 0 || !decision.cutoffAt) {
        if (completeness.complete) result.alreadyComplete += 1
        else result.skipped += 1
        continue
      }
      const cutoffAt = decision.cutoffAt

      // Every message needs the organiser: their own, the call list's name and number, and the
      // guest reminder's "<organiser> asked us to send you a link".
      const organiser = await loadOrganiser(supabase, booking)

      for (const chase of decision.due) {
        try {
          if (chase.audience === 'organiser') {
            await sendOrganiserChase(ctx, booking, chase.kind, organiser, completeness, cutoffAt)
          } else if (chase.audience === 'manager') {
            managerItems.push({ booking, organiser, completeness, cutoffAt })
          } else {
            await sendGuestReminder(ctx, booking, order, completeness, chase, organiser, cutoffAt)
          }
        } catch (error) {
          // A claim that could not be checked: nothing was sent and nothing is retried blindly.
          recordFailure(ctx, {
            bookingId: booking.id,
            reference: booking.booking_reference,
            kind: chase.kind,
            ...(chase.audience === 'guest' ? { coverId: chase.coverId } : {}),
            outcome: 'failed',
            error: describeError(error),
          })
        }
      }
    } catch (error) {
      recordFailure(ctx, {
        bookingId: booking.id,
        reference: booking.booking_reference,
        kind: 'read_order',
        outcome: 'failed',
        error: `Could not read the booking's order: ${describeError(error)}`,
      })
    }
  }

  if (managerItems.length > 0) await sendManagerCallList(ctx, managerItems)
  return result
}

// ---------------------------------------------------------------------------
// Guest addresses (A4)
// ---------------------------------------------------------------------------

/** A runaway guard: a season's invited seats are a few hundred. */
const PURGE_BATCH = 500

/**
 * Clear the guests' own email addresses from seats whose booking date has passed (A4: used only for
 * their food link and one reminder, and cleared after the booking). Bounded to one batch a run; any
 * left over go on the next run. Returns how many seats were cleared. Throws on a database error.
 */
export async function purgeGuestInviteEmails(supabase: Db, todayIso: string): Promise<number> {
  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select('id, table_booking_id')
    .not('invite_email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(PURGE_BATCH)
  if (coverError) throw coverError

  const covers = (coverRows ?? []) as Array<{ id: string; table_booking_id: string }>
  if (covers.length === 0) return 0

  const { data: bookingRows, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id')
    .in('id', Array.from(new Set(covers.map((cover) => cover.table_booking_id))))
    .lt('booking_date', todayIso)
  if (bookingError) throw bookingError

  const past = new Set(((bookingRows ?? []) as Array<{ id: string }>).map((row) => row.id))
  const ids = covers.filter((cover) => past.has(cover.table_booking_id)).map((cover) => cover.id)
  if (ids.length === 0) return 0

  const { error: updateError } = await supabase.from('booking_preorder_covers').update({ invite_email: null }).in('id', ids)
  if (updateError) throw updateError
  return ids.length
}
