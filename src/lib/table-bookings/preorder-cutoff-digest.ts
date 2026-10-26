import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { escapeHtml } from '@/lib/cron/alerting'
import { formatDateFull, shiftIsoDate } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { logger } from '@/lib/logger'
import { isEmailUsable } from '@/lib/notifications/channel'
import {
  buildTableBookingPreorderChoicesEmail,
  type PreorderChoicesCopySeat,
} from '@/lib/table-bookings/guest-emails'
import {
  describePreorderGaps,
  getCoverAddons,
  getPreorderCompleteness,
  getPreorderCutoff,
  getSeatCourseCount,
  isPreorderCourse,
  loadPreorderDishTotals,
  loadPreorderOrder,
  type PreorderDishTotals,
} from '@/lib/table-bookings/preorder'
import { PREORDER_MANAGER_EMAIL } from '@/lib/table-bookings/preorder-alerts'
import {
  PREORDER_ADDON_GUEST_NOTE,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderOrder,
} from '@/types/preorders'

/**
 * What happens when a date's pre-order form locks (BK-149).
 *
 * 1. The kitchen is emailed the dish and tier totals for that date, plus every booking still
 *    incomplete, so nobody has to remember to open the date a week ahead to order stock.
 * 2. Each booker is emailed a copy of their choices, while the messaging flag
 *    `table_preorder_choices_copy` is on (new guest wording, off until the owner switches it on).
 *
 * Run from the noon pre-order sweep. Each email goes once: the claim lives in `idempotency_keys`,
 * as the PayPal staff alerts do, so a second run the same day sends nothing. A date whose form
 * locked yesterday is looked at too, so one missed run does not lose a kitchen order.
 *
 * Counts and dishes only. Guest names and dietary notes never leave staff screens (spec section 8).
 */

type Db = SupabaseClient<any, 'public', any>

const ONCE_TTL_HOURS = 24 * 45

export type CutoffDigestResult = {
  kitchenEmails: number
  choiceCopies: number
  failed: number
}

type DigestBooking = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  customer_id: string | null
  booking_period_name: string | null
}

type IncompleteBooking = { reference: string; partySize: number; gaps: string }

/**
 * The booking dates whose form locked today or yesterday, for the periods' cutoffs. Yesterday is
 * the one-run catch-up: a cron that missed a day still sends that date's kitchen order once.
 */
export function datesLockedRecently(input: {
  todayIso: string
  cutoffDays: Iterable<number>
  now?: Date
}): string[] {
  const dates = new Set<string>()
  for (const days of input.cutoffDays) {
    if (!Number.isInteger(days) || days < 1) continue
    for (const offset of [days, days - 1]) {
      if (offset < 1) continue
      const date = shiftIsoDate(input.todayIso, offset)
      if (!date) continue
      if (getPreorderCutoff({ bookingDate: date, preorderCutoffDays: days, now: input.now }).closed) dates.add(date)
    }
  }
  return Array.from(dates).sort()
}

function dishLines(totals: PreorderDishTotals): string[] {
  const lines: string[] = []
  for (const course of PREORDER_COURSES) {
    const dishes = totals.byCourse[course]
    lines.push(
      `${PREORDER_COURSE_LABELS[course]}: ${dishes.length === 0 ? 'none chosen' : dishes.map((dish) => `${dish.itemName} x${dish.count}`).join(', ')}`,
    )
  }
  if (totals.addons.length > 0) {
    lines.push(`Add-ons: ${totals.addons.map((addon) => `${addon.itemName} x${addon.count}`).join(', ')}`)
  }
  return lines
}

/** The kitchen's order for one date. Staff only: counts, dishes and booking references. */
export function buildKitchenOrderEmail(input: {
  date: string
  totals: PreorderDishTotals
  incomplete: IncompleteBooking[]
}): { subject: string; html: string; text: string } {
  const { totals } = input
  const tiers = totals.christmasTiers
  const day = formatDateFull(input.date)

  const summary = [
    `Food choices for ${day} have closed. This is what to order for.`,
    `${totals.coverCount} pre-order seat${totals.coverCount === 1 ? '' : 's'} across ${totals.bookingCount} booking${totals.bookingCount === 1 ? '' : 's'}` +
      (totals.pendingPaymentBookingCount
        ? `, including ${totals.pendingPaymentBookingCount} still waiting for a deposit.`
        : '.'),
    ...(tiers.guests > 0
      ? [
          `Christmas guests: ${tiers.guests} (${tiers.threeCourses} on 3 courses, ${tiers.twoCourses} on 2 courses, ` +
            `${tiers.oneCourse} on 1 course choosing on the day${tiers.notRecorded ? `, ${tiers.notRecorded} with no courses recorded` : ''}).`,
        ]
      : []),
  ]
  const dishes = dishLines(totals)
  const withdrawn = totals.withdrawn.map(
    (dish) => `${PREORDER_SELECTION_COURSE_LABELS[dish.course]}: ${dish.itemName} x${dish.count} (off the menu, not counted above)`,
  )
  const incomplete = input.incomplete.map(
    (booking) => `${booking.reference} (party of ${booking.partySize}): ${booking.gaps}`,
  )
  const footer = 'Dietary notes and allergies are on the booking sheet. A manager can still record a late change on the booking; it is marked as late.'

  const list = (items: string[]) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
  const html = [
    ...summary.map((line) => `<p>${escapeHtml(line)}</p>`),
    '<h3>Dishes</h3>',
    list(dishes),
    ...(withdrawn.length ? ['<h3>Off the menu: ring these guests</h3>', list(withdrawn)] : []),
    ...(incomplete.length ? ['<h3>Still incomplete</h3>', list(incomplete)] : []),
    `<p>${escapeHtml(footer)}</p>`,
  ].join('')

  const text = [
    ...summary,
    '',
    'Dishes',
    ...dishes,
    ...(withdrawn.length ? ['', 'Off the menu: ring these guests', ...withdrawn] : []),
    ...(incomplete.length ? ['', 'Still incomplete', ...incomplete] : []),
    '',
    footer,
  ].join('\n')

  return { subject: `Kitchen order: food choices for ${day}`, html, text }
}

/** The seats of an order as the booker's copy shows them. Seat numbers only. */
export function toChoicesCopySeats(order: PreorderOrder): PreorderChoicesCopySeat[] {
  const byOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
  return Array.from({ length: Math.max(0, order.partySize) }, (_, index) => {
    const ordinal = index + 1
    const cover = byOrdinal.get(ordinal)
    return {
      ordinal,
      courseCount: getSeatCourseCount(order, ordinal),
      courses: (cover?.selections ?? [])
        .filter((selection) => isPreorderCourse(selection.course))
        .map((selection) => ({
          courseLabel: PREORDER_SELECTION_COURSE_LABELS[selection.course],
          itemName: selection.itemName,
          ...(selection.itemWithdrawn ? { withdrawn: true } : {}),
        })),
      addons: cover ? getCoverAddons(cover).map((addon) => addon.itemName) : [],
    }
  })
}

/** Take the one slot for this email. `unknown` means the claim could not be checked. */
async function claimOnce(supabase: Db, key: string): Promise<'claimed' | 'taken' | 'unknown'> {
  try {
    const claim = await claimIdempotencyKey(supabase, key, computeIdempotencyRequestHash({ key }), ONCE_TTL_HOURS)
    return claim.state === 'claimed' ? 'claimed' : 'taken'
  } catch (error) {
    logger.error('Could not claim a pre-order cutoff email', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { key },
    })
    return 'unknown'
  }
}

async function settleOnce(supabase: Db, key: string, sent: boolean): Promise<void> {
  const hash = computeIdempotencyRequestHash({ key })
  try {
    if (sent) await persistIdempotencyResponse(supabase, key, hash, { state: 'sent' }, ONCE_TTL_HOURS)
    else await releaseIdempotencyClaim(supabase, key, hash)
  } catch (error) {
    logger.error('Could not settle a pre-order cutoff email claim', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { key },
    })
  }
}

async function loadDigestBookings(supabase: Db, date: string): Promise<DigestBooking[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(
      'id, booking_reference, booking_date, booking_time, start_datetime, party_size, customer_id, booking_period_name',
    )
    .eq('booking_date', date)
    .eq('booking_period_requires_preorder', true)
    .eq('booking_period_answer', true)
    .not('status', 'in', '(cancelled,no_show)')
    .order('booking_time', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as DigestBooking[]
}

async function sendKitchenOrder(
  supabase: Db,
  date: string,
  orders: Array<{ booking: DigestBooking; order: PreorderOrder }>,
): Promise<'sent' | 'skipped' | 'failed'> {
  const totals = await loadPreorderDishTotals(supabase, date)
  if (totals.coverCount === 0 && totals.christmasTiers.guests === 0) return 'skipped'

  const key = `preorder:kitchen-order:${date}`
  // A failed claim still sends: a duplicate kitchen email costs less than no order at all.
  const claim = await claimOnce(supabase, key)
  if (claim === 'taken') return 'skipped'

  const incomplete: IncompleteBooking[] = []
  for (const { booking, order } of orders) {
    const completeness = getPreorderCompleteness(order)
    if (completeness.complete) continue
    incomplete.push({
      reference: booking.booking_reference || booking.id,
      partySize: order.partySize,
      gaps: describePreorderGaps(completeness),
    })
  }

  const email = buildKitchenOrderEmail({ date, totals, incomplete })
  const result = await sendEmail({ to: PREORDER_MANAGER_EMAIL, subject: email.subject, html: email.html, text: email.text })
  if (claim === 'claimed') await settleOnce(supabase, key, result.success)
  if (!result.success) {
    logger.error('Kitchen order email for a locked pre-order date was not sent', {
      error: new Error(result.error || 'Email not sent'),
      metadata: { date },
    })
    return 'failed'
  }
  return 'sent'
}

async function sendChoicesCopy(
  supabase: Db,
  booking: DigestBooking,
  order: PreorderOrder,
): Promise<'sent' | 'skipped' | 'failed'> {
  if (!booking.customer_id) return 'skipped'

  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, first_name, email, email_status, email_deactivated_at')
    .eq('id', booking.customer_id)
    .maybeSingle()
  if (error) throw error
  const guest = customer as {
    id: string
    first_name: string | null
    email: string | null
    email_status: string | null
    email_deactivated_at: string | null
  } | null
  if (!guest || !isEmailUsable(guest)) return 'skipped'

  const key = `preorder:choices-copy:${booking.id}`
  // Unlike the kitchen order, a guest email is never sent unclaimed: one copy too few is better
  // than the same email twice.
  if ((await claimOnce(supabase, key)) !== 'claimed') return 'skipped'

  const seats = toChoicesCopySeats(order)
  const email = buildTableBookingPreorderChoicesEmail({
    firstName: getSmartFirstName(guest.first_name),
    bookingReference: booking.booking_reference,
    bookingDate: booking.booking_date,
    bookingTime: booking.booking_time,
    startDateTime: booking.start_datetime,
    partySize: booking.party_size,
    periodName: booking.booking_period_name,
    seats,
    complete: getPreorderCompleteness(order).complete,
    addonNote: PREORDER_ADDON_GUEST_NOTE,
  })

  const result = await sendEmail({
    to: guest.email as string,
    subject: email.subject,
    html: email.html,
    text: email.text,
    customerId: guest.id,
    tableBookingId: booking.id,
    commType: 'table_booking_preorder_copy',
    idempotencyKey: key,
  })
  await settleOnce(supabase, key, result.success)
  if (!result.success) {
    logger.error('Pre-order choices copy was not sent', {
      error: new Error(result.error || 'Email not sent'),
      metadata: { tableBookingId: booking.id },
    })
    return 'failed'
  }
  return 'sent'
}

export async function sendPreorderCutoffDigests(
  supabase: Db,
  input: { todayIso: string; cutoffDays: Iterable<number>; choicesCopyEnabled: boolean; now?: Date },
): Promise<CutoffDigestResult> {
  const result: CutoffDigestResult = { kitchenEmails: 0, choiceCopies: 0, failed: 0 }

  for (const date of datesLockedRecently(input)) {
    try {
      const bookings = await loadDigestBookings(supabase, date)
      const orders: Array<{ booking: DigestBooking; order: PreorderOrder }> = []
      for (const booking of bookings) {
        const order = await loadPreorderOrder(supabase, booking.id)
        if (order?.requiresPreorder) orders.push({ booking, order })
      }

      const kitchen = await sendKitchenOrder(supabase, date, orders)
      if (kitchen === 'sent') result.kitchenEmails += 1
      if (kitchen === 'failed') result.failed += 1

      if (!input.choicesCopyEnabled) continue
      for (const { booking, order } of orders) {
        try {
          const copy = await sendChoicesCopy(supabase, booking, order)
          if (copy === 'sent') result.choiceCopies += 1
          if (copy === 'failed') result.failed += 1
        } catch (error) {
          result.failed += 1
          logger.error('Pre-order choices copy failed', {
            error: error instanceof Error ? error : new Error(String(error)),
            metadata: { tableBookingId: booking.id },
          })
        }
      }
    } catch (error) {
      result.failed += 1
      logger.error('Pre-order cutoff digest failed for a date', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { date },
      })
    }
  }

  return result
}
